import { describe, expect, it } from "bun:test";
import {
  ApiErrorResponseSchema,
  MachineStateV3Schema,
  PairingClientBindingSchema,
  PairingCompleteResponseSchema,
  PairingDeviceBindingSchema,
  PairingSessionProofResponseSchema,
  PairingSessionStartResponseSchema,
} from "@philcoino/protocol";

import {
  createSimulator,
  DEFAULT_SIMULATOR_PAIRING_CODE,
  type SimulatorApplication,
} from "../src/app.ts";
import { SrpClientSession } from "../src/srp.ts";

const clientNonce = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("deterministic v3 simulator", () => {
  it("exposes no v1 or v2 route", async () => {
    const { app } = createSimulator();
    for (const path of ["/api/v1/state", "/api/v2/state", "/api/v2/scale/trace"]) {
      expect((await app.request(path)).status).toBe(404);
    }
  });

  it("pairs through SRP and protects state", async () => {
    const simulator = createSimulator();
    expect((await simulator.app.request("/api/v3/state")).status).toBe(401);
    const token = await pair(simulator, 1);
    const response = await authenticated(simulator, token, "/api/v3/state");
    expect(response.status).toBe(200);
    expect(MachineStateV3Schema.parse(await response.json()).apiVersion).toBe("3");
  });

  it("returns complete increasing state acknowledgements for mutations", async () => {
    const simulator = createSimulator();
    const token = await pair(simulator, 2);
    const first = MachineStateV3Schema.parse(
      await (await authenticated(simulator, token, "/api/v3/state")).json(),
    );
    const updatedResponse = await authenticated(simulator, token, "/api/v3/settings", {
      method: "PATCH",
      body: JSON.stringify({
        brewTargetC: 94,
        steamTargetC: 121,
        steamControl: { initialCompensationC: 10 },
      }),
    });
    const updated = MachineStateV3Schema.parse(await updatedResponse.json());
    expect(updated.revision).toBeGreaterThan(first.revision);
    expect(updated.machine.brewTargetC).toBe(94);
    expect(updated.machine.steamTargetC).toBe(121);
    expect(updated.machine.steamControl.settings.initialCompensationC).toBe(10);
  });

  it("allows a wrong-code retry without rate limiting", async () => {
    const simulator = createSimulator();
    const wrong = await beginPairing(simulator, "00000000", 20);
    const proof = await wrong.client.processChallenge(
      decodeBase64Url(wrong.start.salt),
      decodeBase64Url(wrong.start.serverPublicKey),
    );
    const rejected = await simulator.app.request(
      `/api/v3/pairing/sessions/${wrong.start.sessionId}/proof`,
      jsonRequest({ clientProof: encodeBase64Url(proof) }),
    );
    expect(rejected.status).toBe(401);
    expect(ApiErrorResponseSchema.parse(await rejected.json()).error.code).toBe(
      "invalid_pairing_code",
    );
    expect(await pair(simulator, 21)).toHaveLength(43);
  });

  it("bounds active SRP sessions and frees a failed session immediately", async () => {
    const simulator = createSimulator();
    await beginPairing(simulator, DEFAULT_SIMULATOR_PAIRING_CODE, 30);
    const second = await beginPairing(simulator, DEFAULT_SIMULATOR_PAIRING_CODE, 31);
    const busy = await startSession(simulator, new SrpClientSession("12345678"));
    expect(busy.status).toBe(409);
    expect(ApiErrorResponseSchema.parse(await busy.json()).error.code).toBe("pairing_busy");

    const malformed = await simulator.app.request(
      `/api/v3/pairing/sessions/${second.start.sessionId}/proof`,
      jsonRequest({ clientProof: "***" }),
    );
    expect(malformed.status).toBe(400);
    expect((await startSession(simulator, new SrpClientSession("12345678"))).status).toBe(200);
  });

  it("expires sessions and rejects replayed completion", async () => {
    const simulator = createSimulator();
    const expiring = await beginPairing(simulator, DEFAULT_SIMULATOR_PAIRING_CODE, 40);
    simulator.machine.advance(90_000);
    const expired = await simulator.app.request(
      `/api/v3/pairing/sessions/${expiring.start.sessionId}/proof`,
      jsonRequest({ clientProof: encodeBase64Url(new Uint8Array(64)) }),
    );
    expect(expired.status).toBe(409);
    expect(ApiErrorResponseSchema.parse(await expired.json()).error.code).toBe(
      "pairing_session_expired",
    );

    const completed = await completePairing(simulator, 41);
    const replay = await simulator.app.request(
      `/api/v3/pairing/sessions/${completed.sessionId}/complete`,
      jsonRequest(completed.completeRequest),
    );
    expect(replay.status).toBe(409);
    expect(ApiErrorResponseSchema.parse(await replay.json()).error.code).toBe(
      "pairing_session_replayed",
    );
  });

  it("rejects malformed, unknown, and wrong-stage SRP requests", async () => {
    const simulator = createSimulator();
    const malformed = await simulator.app.request(
      "/api/v3/pairing/sessions",
      jsonRequest({
        clientName: "test",
        clientNonce,
        clientPublicKey: "not*base64url",
      }),
    );
    expect(malformed.status).toBe(400);

    const unknown = await simulator.app.request(
      "/api/v3/pairing/sessions",
      jsonRequest({
        clientName: "test",
        clientNonce,
        clientPublicKey: encodeBase64Url(new Uint8Array(384).fill(1)),
        unexpected: true,
      }),
    );
    expect(unknown.status).toBe(400);

    const active = await beginPairing(simulator, DEFAULT_SIMULATOR_PAIRING_CODE, 50);
    const wrongStage = await simulator.app.request(
      `/api/v3/pairing/sessions/${active.start.sessionId}/complete`,
      jsonRequest({
        clientId: clientId(50),
        encryptedClientBinding: encodeBase64Url(new Uint8Array(32)),
      }),
    );
    expect(wrongStage.status).toBe(409);
    expect(ApiErrorResponseSchema.parse(await wrongStage.json()).error.code).toBe(
      "pairing_stage_mismatch",
    );
  });

  it("detects a forged server proof and altered encrypted binding", async () => {
    const forged = createSimulator({ pairingFailure: "forged-server-proof" });
    const forgedExchange = await provePairing(forged, 60);
    expect(
      forgedExchange.client.verifyServer(
        decodeBase64Url(forgedExchange.proof.serverProof),
        decodeBase64Url(forgedExchange.proof.deviceNonce),
      ),
    ).toBe(false);

    const altered = createSimulator({ pairingFailure: "altered-binding" });
    const alteredExchange = await provePairing(altered, 61);
    expect(
      alteredExchange.client.verifyServer(
        decodeBase64Url(alteredExchange.proof.serverProof),
        decodeBase64Url(alteredExchange.proof.deviceNonce),
      ),
    ).toBe(true);
    await expect(
      alteredExchange.client.decrypt(
        decodeBase64Url(alteredExchange.proof.encryptedDeviceBinding),
      ),
    ).rejects.toThrow();
  });

  it("evicts the oldest credential on the fifth successful pairing", async () => {
    const simulator = createSimulator();
    const tokens: string[] = [];
    for (let client = 0; client < 5; client += 1) {
      tokens.push(await pair(simulator, client + 70));
    }
    expect((await authenticated(simulator, tokens[0], "/api/v3/state")).status).toBe(401);
    for (const token of tokens.slice(1)) {
      expect((await authenticated(simulator, token, "/api/v3/state")).status).toBe(200);
    }
  });

  it("preserves clients for the same code and revokes them when the code changes", async () => {
    const simulator = createSimulator();
    const token = await pair(simulator, 80);
    simulator.rotatePairingCode(DEFAULT_SIMULATOR_PAIRING_CODE);
    expect((await authenticated(simulator, token, "/api/v3/state")).status).toBe(200);
    simulator.rotatePairingCode("87654321");
    expect((await authenticated(simulator, token, "/api/v3/state")).status).toBe(401);
    expect(await pair(simulator, 81, "87654321")).toHaveLength(43);
    expect(() => simulator.rotatePairingCode("1234567x")).toThrow();
  });

  it("streams the retained telemetry source and refuses a second subscriber", async () => {
    const simulator = createSimulator();
    const token = await pair(simulator, 90);
    await authenticated(simulator, token, "/api/v3/extractions", {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: "manual-extraction-0001",
        selection: { kind: "manual" },
      }),
    });
    simulator.machine.advance(250);
    const first = await authenticated(
      simulator,
      token,
      "/api/v3/extractions/current/stream",
    );
    expect(first.status).toBe(200);
    const second = await authenticated(
      simulator,
      token,
      "/api/v3/extractions/current/stream",
    );
    expect(second.status).toBe(409);
    expect(ApiErrorResponseSchema.parse(await second.json()).error.code).toBe("stream_busy");
    await first.body?.cancel();
  });
});

async function pair(
  simulator: SimulatorApplication,
  clientNumber: number,
  pairingCode = DEFAULT_SIMULATOR_PAIRING_CODE,
): Promise<string> {
  return (await completePairing(simulator, clientNumber, pairingCode)).accessToken;
}

async function beginPairing(
  simulator: SimulatorApplication,
  pairingCode: string,
  clientNumber: number,
) {
  const client = new SrpClientSession(pairingCode, deterministicRandom(clientNumber));
  const response = await startSession(simulator, client);
  expect(response.status).toBe(200);
  return {
    client,
    start: PairingSessionStartResponseSchema.parse(await response.json()),
  };
}

function startSession(simulator: SimulatorApplication, client: SrpClientSession) {
  return simulator.app.request(
    "/api/v3/pairing/sessions",
    jsonRequest({
      clientName: "Simulator test",
      clientNonce,
      clientPublicKey: encodeBase64Url(client.publicKey),
    }),
  );
}

async function provePairing(
  simulator: SimulatorApplication,
  clientNumber: number,
  pairingCode = DEFAULT_SIMULATOR_PAIRING_CODE,
) {
  const begun = await beginPairing(simulator, pairingCode, clientNumber);
  const clientProof = await begun.client.processChallenge(
    decodeBase64Url(begun.start.salt),
    decodeBase64Url(begun.start.serverPublicKey),
  );
  const response = await simulator.app.request(
    `/api/v3/pairing/sessions/${begun.start.sessionId}/proof`,
    jsonRequest({ clientProof: encodeBase64Url(clientProof) }),
  );
  expect(response.status).toBe(200);
  return {
    ...begun,
    proof: PairingSessionProofResponseSchema.parse(await response.json()),
  };
}

async function completePairing(
  simulator: SimulatorApplication,
  clientNumber: number,
  pairingCode = DEFAULT_SIMULATOR_PAIRING_CODE,
) {
  const exchange = await provePairing(simulator, clientNumber, pairingCode);
  const deviceNonce = decodeBase64Url(exchange.proof.deviceNonce);
  expect(
    exchange.client.verifyServer(
      decodeBase64Url(exchange.proof.serverProof),
      deviceNonce,
    ),
  ).toBe(true);
  const binding = PairingDeviceBindingSchema.parse(JSON.parse(
    await exchange.client.decrypt(
      decodeBase64Url(exchange.proof.encryptedDeviceBinding),
    ),
  ));
  expect(binding).toEqual(expect.objectContaining({
    sessionId: exchange.start.sessionId,
    clientNonce,
    deviceId: exchange.start.device.deviceId,
  }));

  const completeRequest = {
    clientId: clientId(clientNumber),
    encryptedClientBinding: encodeBase64Url(await exchange.client.encrypt(
      JSON.stringify(PairingClientBindingSchema.parse({
        domain: "philcoino:v3:client-binding",
        sessionId: exchange.start.sessionId,
        clientId: clientId(clientNumber),
        clientNonce,
        deviceId: binding.deviceId,
        certificateSpkiSha256: binding.certificateSpkiSha256,
      })),
    )),
  };
  const response = await simulator.app.request(
    `/api/v3/pairing/sessions/${exchange.start.sessionId}/complete`,
    jsonRequest(completeRequest),
  );
  expect(response.status).toBe(200);
  return {
    ...PairingCompleteResponseSchema.parse(await response.json()),
    completeRequest,
    sessionId: exchange.start.sessionId,
  };
}

function authenticated(
  simulator: SimulatorApplication,
  token: string,
  path: string,
  init: RequestInit = {},
) {
  return simulator.app.request(path, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function clientId(value: number): string {
  return value.toString(16).padStart(32, "0");
}

function deterministicRandom(seed: number) {
  return (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = (seed + index * 17 + 1) & 0xff;
    }
    return bytes;
  };
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
