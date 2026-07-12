import { beforeEach, describe, expect, it } from "bun:test";
import {
  ApiV2ErrorResponseSchema,
  DeviceResponseSchema,
  ErrorResponseSchema,
  ExtractionActiveConflictResponseSchema,
  ExtractionStateSchema,
  HeaterSettingsResponseSchema,
  HealthResponseSchema,
  MachineStateSchema,
  MachineStateV2Schema,
  ModeResponseSchema,
  ProfileSetSchema,
  RunningExtractionStateSchema,
  STEAM_TIMEOUT_MS,
  TemperatureSettingsResponseSchema,
  type ExtractionSelection,
  type ProfileSet,
} from "@philcoino/protocol";

import {
  createSimulator,
  DEFAULT_SIMULATOR_TOKEN,
  type SimulatorApplication,
} from "../src/app.ts";

const authorization = { Authorization: `Bearer ${DEFAULT_SIMULATOR_TOKEN}` };
let simulator: SimulatorApplication;

beforeEach(() => {
  simulator = createSimulator();
});

describe("public endpoints", () => {
  it("returns contract-valid health", async () => {
    const response = await simulator.app.request("/healthz");
    expect(response.status).toBe(200);
    expect(HealthResponseSchema.parse(await response.json())).toEqual({
      status: "ok",
      uptimeMs: 0,
    });
  });

  it("returns contract-valid device identity without authentication", async () => {
    const response = await simulator.app.request("/api/v1/device");
    expect(response.status).toBe(200);
    expect(DeviceResponseSchema.parse(await response.json()).apiVersion).toBe("1");
  });
});

describe("bearer authentication", () => {
  it.each([
    ["GET", "/api/v1/state"],
    ["PATCH", "/api/v1/settings/temperatures"],
    ["PUT", "/api/v1/mode"],
    ["PUT", "/api/v1/heater"],
    ["POST", "/api/v1/faults/over-temperature/dismiss"],
    ["GET", "/api/v2/state"],
    ["GET", "/api/v2/profiles"],
    ["PUT", "/api/v2/profiles"],
    ["POST", "/api/v2/extractions/start"],
    ["POST", "/api/v2/extractions/stop"],
  ])("rejects a missing token for %s %s", async (method, path) => {
    const response = await simulator.app.request(path, { method });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    const payload = await response.json();
    const error = path.startsWith("/api/v2/")
      ? ApiV2ErrorResponseSchema.parse(payload)
      : ErrorResponseSchema.parse(payload);
    expect(error.error.code).toBe("unauthorized");
  });

  it("rejects an invalid token with the contract error shape", async () => {
    const response = await simulator.app.request("/api/v1/state", {
      headers: { Authorization: "Bearer incorrect" },
    });
    expect(response.status).toBe(401);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "unauthorized",
    );
  });
});

describe("API v2 profiles", () => {
  it("returns the seeded complete four-slot profile set", async () => {
    const profiles = await getProfiles();
    expect(profiles.profiles.map((slot) => slot.id)).toEqual([
      "profile-1",
      "profile-2",
      "profile-3",
      "profile-4",
    ]);
    expect(profiles.profiles.map((slot) => slot.profile?.name ?? null)).toEqual([
      "Classic30",
      "Pre5Soak5",
      null,
      null,
    ]);
  });

  it("atomically replaces the complete set and preserves it across power cycle", async () => {
    const replacement = editedProfiles("Short20", 20);
    const response = await simulator.app.request(
      "/api/v2/profiles",
      jsonRequest("PUT", replacement, authorization),
    );
    expect(response.status).toBe(200);
    expect(ProfileSetSchema.parse(await response.json())).toEqual(replacement);

    await simulator.app.request("/_simulator/power-cycle", { method: "POST" });
    expect(await getProfiles()).toEqual(replacement);
    expect((await getStateV2()).extraction.status).toBe("idle");
  });

  it("preserves the previous complete set after injected persistence failure", async () => {
    const previous = await getProfiles();
    await simulator.app.request("/_simulator/fail-next-profile-save", {
      method: "POST",
    });
    let response = await simulator.app.request(
      "/api/v2/profiles",
      jsonRequest("PUT", editedProfiles("Short20", 20), authorization),
    );
    expect(response.status).toBe(500);
    expect(ApiV2ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "persistence_failure",
    );
    expect(await getProfiles()).toEqual(previous);

    response = await simulator.app.request(
      "/api/v2/profiles",
      jsonRequest("PUT", editedProfiles("Short20", 20), authorization),
    );
    expect(response.status).toBe(200);
  });

  it("rejects invalid complete sets without changing persisted profiles", async () => {
    const previous = await getProfiles();
    const invalid = editedProfiles("Bad Profile", 20);
    const response = await simulator.app.request(
      "/api/v2/profiles",
      jsonRequest("PUT", invalid, authorization),
    );
    expect(response.status).toBe(400);
    expect(ApiV2ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "malformed_request",
    );
    expect(await getProfiles()).toEqual(previous);
  });

  it("rejects replacement while active and preserves the previous set", async () => {
    const previous = await getProfiles();
    await startExtraction("profile-active-0001", {
      kind: "profile",
      profileId: "profile-1",
    });
    const response = await simulator.app.request(
      "/api/v2/profiles",
      jsonRequest("PUT", editedProfiles("Short20", 20), authorization),
    );
    expect(response.status).toBe(409);
    const conflict = ExtractionActiveConflictResponseSchema.parse(
      await response.json(),
    );
    expect(conflict.error.code).toBe("extraction_active");
    expect(conflict.activeExtraction.status).toBe("running");
    expect(await getProfiles()).toEqual(previous);
  });

  it("full reset restores seeded profiles", async () => {
    await simulator.app.request(
      "/api/v2/profiles",
      jsonRequest("PUT", editedProfiles("Short20", 20), authorization),
    );
    await simulator.app.request("/_simulator/reset", { method: "POST" });
    expect((await getProfiles()).profiles[0].profile?.name).toBe("Classic30");
  });
});

describe("API v2 deterministic extraction", () => {
  it("runs a no-pre-infusion profile to its exact completion deadline", async () => {
    let extraction = await startExtraction("classic-start-0001", {
      kind: "profile",
      profileId: "profile-1",
    });
    expect(extraction).toMatchObject({
      phase: "main-extraction",
      elapsedMs: 0,
      remainingMs: 30_000,
      pumpCommand: "running",
    });

    await advance(29_999);
    extraction = (await getStateV2()).extraction as typeof extraction;
    expect(extraction).toMatchObject({
      status: "running",
      elapsedMs: 29_999,
      remainingMs: 1,
      pumpCommand: "running",
    });
    await advance(1);
    expect((await getStateV2()).extraction).toMatchObject({
      status: "idle",
      pumpCommand: "off",
    });
  });

  it("transitions pre-infusion, soak, and main extraction at exact deadlines", async () => {
    await startExtraction("pre-soak-start-1", {
      kind: "profile",
      profileId: "profile-2",
    });
    await advance(4_999);
    expect((await getStateV2()).extraction).toMatchObject({
      phase: "pre-infusion",
      pumpCommand: "running",
      remainingMs: 30_001,
    });
    await advance(1);
    expect((await getStateV2()).extraction).toMatchObject({
      phase: "soak",
      pumpCommand: "off",
      remainingMs: 30_000,
    });
    await advance(5_000);
    expect((await getStateV2()).extraction).toMatchObject({
      phase: "main-extraction",
      pumpCommand: "running",
      remainingMs: 25_000,
    });
    await advance(25_000);
    expect((await getStateV2()).extraction).toMatchObject({
      status: "idle",
      pumpCommand: "off",
    });
  });

  it("cuts Manual off at exactly 60 seconds", async () => {
    await startExtraction("manual-start-0001", { kind: "manual" });
    await advance(59_999);
    expect((await getStateV2()).extraction).toMatchObject({
      status: "running",
      elapsedMs: 59_999,
      remainingMs: 1,
      pumpCommand: "running",
    });
    await advance(1);
    expect((await getStateV2()).extraction).toMatchObject({
      status: "idle",
      pumpCommand: "off",
    });
  });

  it("replays the same key without resetting time and rejects a competing key", async () => {
    const first = await startExtraction("same-key-start-01", { kind: "manual" });
    await advance(12_345);
    const replay = await startExtraction("same-key-start-01", {
      kind: "profile",
      profileId: "profile-1",
    });
    expect(replay.extractionId).toBe(first.extractionId);
    expect(replay.selection).toEqual({ kind: "manual" });
    expect(replay.elapsedMs).toBe(12_345);

    const response = await simulator.app.request(
      "/api/v2/extractions/start",
      jsonRequest(
        "POST",
        {
          idempotencyKey: "competing-key-001",
          selection: { kind: "manual" },
        },
        authorization,
      ),
    );
    expect(response.status).toBe(409);
    const conflict = ExtractionActiveConflictResponseSchema.parse(
      await response.json(),
    );
    expect(conflict.activeExtraction.extractionId).toBe(first.extractionId);
    expect(conflict.activeExtraction.elapsedMs).toBe(12_345);
  });

  it("makes Stop idempotent and acknowledges idle", async () => {
    await startExtraction("stop-start-00001", { kind: "manual" });
    for (let index = 0; index < 2; index += 1) {
      const response = await simulator.app.request(
        "/api/v2/extractions/stop",
        { headers: authorization, method: "POST" },
      );
      expect(response.status).toBe(200);
      expect(ExtractionStateSchema.parse(await response.json())).toMatchObject({
        status: "idle",
        pumpCommand: "off",
      });
    }
  });

  it("rejects Start for an empty custom slot", async () => {
    const response = await simulator.app.request(
      "/api/v2/extractions/start",
      jsonRequest(
        "POST",
        {
          idempotencyKey: "empty-profile-001",
          selection: { kind: "profile", profileId: "profile-3" },
        },
        authorization,
      ),
    );
    expect(response.status).toBe(409);
    expect(ApiV2ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "profile_not_configured",
    );
  });

  it("continues independently of temperature faults and resets idle on power cycle", async () => {
    const started = await startExtraction("fault-independent-1", {
      kind: "manual",
    });
    await control("PUT", "/_simulator/fault", { code: "sensor_failure" });
    await advance(10_000);
    let state = await getStateV2();
    expect(state.machine.status).toBe("fault");
    expect(state.extraction).toMatchObject({
      status: "running",
      extractionId: started.extractionId,
      elapsedMs: 10_000,
      pumpCommand: "running",
    });

    await simulator.app.request("/_simulator/power-cycle", { method: "POST" });
    state = await getStateV2();
    expect(state.machine.status).toBe("heating");
    expect(state.extraction).toMatchObject({ status: "idle", pumpCommand: "off" });
  });
});

describe("API v1 state and mutations", () => {
  it("returns a contract-valid authenticated state", async () => {
    const state = await getState();
    expect(state.status).toBe("heating");
    expect(state.activeMode).toBe("brew");
    expect(state.heaterEnabled).toBe(true);
    expect(state.heaterActive).toBe(true);
  });

  it("persists valid target updates and returns both targets", async () => {
    const response = await simulator.app.request(
      "/api/v1/settings/temperatures",
      jsonRequest("PATCH", { brewTargetC: 95 }, authorization),
    );
    expect(response.status).toBe(200);
    expect(TemperatureSettingsResponseSchema.parse(await response.json())).toEqual({
      brewTargetC: 95,
      steamTargetC: 115,
    });

    await simulator.app.request("/_simulator/power-cycle", { method: "POST" });
    expect((await getState()).brewTargetC).toBe(95);
  });

  it.each([
    [{ brewTargetC: 84 }, "temperature_out_of_range"],
    [{ steamTargetC: 121 }, "temperature_out_of_range"],
    [{ brewTargetC: 92.5 }, "temperature_out_of_range"],
    [{}, "malformed_request"],
    [{ brewTargetC: 93, unexpected: true }, "malformed_request"],
  ])("rejects invalid temperature mutation %j", async (body, code) => {
    const response = await simulator.app.request(
      "/api/v1/settings/temperatures",
      jsonRequest("PATCH", body, authorization),
    );
    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(code);
  });

  it("rejects malformed JSON without mutating settings", async () => {
    const response = await simulator.app.request(
      "/api/v1/settings/temperatures",
      {
        method: "PATCH",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: "{",
      },
    );
    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "malformed_request",
    );
    expect((await getState()).brewTargetC).toBe(93);
  });

  it("acknowledges idempotent mode changes only after applying them", async () => {
    for (const mode of ["steam", "steam"] as const) {
      const response = await simulator.app.request(
        "/api/v1/mode",
        jsonRequest("PUT", { mode }, authorization),
      );
      expect(response.status).toBe(200);
      expect(ModeResponseSchema.parse(await response.json())).toEqual({ mode });
    }
    expect((await getState()).activeMode).toBe("steam");
  });

  it("rejects an invalid mode", async () => {
    const response = await simulator.app.request(
      "/api/v1/mode",
      jsonRequest("PUT", { mode: "cleaning" }, authorization),
    );
    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "malformed_request",
    );
  });

  it("acknowledges volatile heater permission and cools while disabled", async () => {
    let response = await simulator.app.request(
      "/api/v1/heater",
      jsonRequest("PUT", { heaterEnabled: false }, authorization),
    );
    expect(response.status).toBe(200);
    expect(HeaterSettingsResponseSchema.parse(await response.json())).toEqual({
      heaterEnabled: false,
    });

    let state = await getState();
    expect(state.heaterEnabled).toBe(false);
    expect(state.heaterActive).toBe(false);
    const initialTemperature = state.brewTemperatureC;

    await control("POST", "/_simulator/advance", { milliseconds: 1_000 });
    state = await getState();
    expect(state.brewTemperatureC).toBeLessThanOrEqual(initialTemperature);
    expect(state.heaterActive).toBe(false);

    response = await simulator.app.request(
      "/api/v1/heater",
      jsonRequest("PUT", { heaterEnabled: true }, authorization),
    );
    expect(response.status).toBe(200);
    expect(HeaterSettingsResponseSchema.parse(await response.json())).toEqual({
      heaterEnabled: true,
    });
    expect((await getState()).heaterEnabled).toBe(true);
  });

  it("rejects malformed heater permission requests", async () => {
    const response = await simulator.app.request(
      "/api/v1/heater",
      jsonRequest("PUT", { heaterEnabled: "off" }, authorization),
    );
    expect(response.status).toBe(400);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "malformed_request",
    );
  });
});

describe("deterministic machine controls", () => {
  it("simulates temperature movement and three-second readiness", async () => {
    await control("PUT", "/_simulator/temperatures", {
      brewTemperatureC: 92,
    });

    await control("POST", "/_simulator/advance", { milliseconds: 2_999 });
    expect((await getState()).status).toBe("heating");

    await control("POST", "/_simulator/advance", { milliseconds: 1 });
    const ready = await getState();
    expect(ready.status).toBe("ready");
    expect(ready.brewTemperatureC).toBe(93);
    expect(ready.heaterActive).toBe(false);
  });

  it("starts the steam timer on readiness and returns to brew at expiry", async () => {
    await setMode("steam");
    await control("PUT", "/_simulator/temperatures", {
      steamTemperatureC: 115,
    });
    await control("POST", "/_simulator/advance", { milliseconds: 3_000 });

    let state = await getState();
    expect(state.status).toBe("ready");
    expect(state.steamTimeoutRemainingMs).toBe(STEAM_TIMEOUT_MS);

    await control("POST", "/_simulator/advance", {
      milliseconds: STEAM_TIMEOUT_MS - 1,
    });
    state = await getState();
    expect(state.activeMode).toBe("steam");
    expect(state.steamTimeoutRemainingMs).toBe(1);

    await control("POST", "/_simulator/advance", { milliseconds: 1 });
    state = await getState();
    expect(state.activeMode).toBe("brew");
    expect(state.steamTimeoutRemainingMs).toBeNull();
  });

  it("latches faults, de-energizes heating, and clears on power cycle", async () => {
    await control("PUT", "/_simulator/fault", { code: "sensor_failure" });
    let state = await getState();
    expect(state.status).toBe("fault");
    expect(state.heaterActive).toBe(false);
    expect(state.fault?.code).toBe("sensor_failure");

    const modeResponse = await simulator.app.request(
      "/api/v1/mode",
      jsonRequest("PUT", { mode: "steam" }, authorization),
    );
    expect(modeResponse.status).toBe(409);
    expect(ErrorResponseSchema.parse(await modeResponse.json()).error.code).toBe(
      "sensor_unavailable",
    );

    await simulator.app.request("/_simulator/power-cycle", { method: "POST" });
    state = await getState();
    expect(state.status).toBe("heating");
    expect(state.fault).toBeNull();
    expect(state.activeMode).toBe("brew");
    expect(state.heaterEnabled).toBe(true);
  });

  it("dismisses only cooled over-temperature faults", async () => {
    await control("PUT", "/_simulator/temperatures", {
      brewTemperatureC: 99,
    });
    await control("PUT", "/_simulator/fault", { code: "over_temperature" });

    let response = await simulator.app.request(
      "/api/v1/faults/over-temperature/dismiss",
      { headers: authorization, method: "POST" },
    );
    expect(response.status).toBe(409);
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "sensor_unavailable",
    );

    await control("PUT", "/_simulator/temperatures", {
      brewTemperatureC: 93,
    });
    response = await simulator.app.request(
      "/api/v1/faults/over-temperature/dismiss",
      { headers: authorization, method: "POST" },
    );
    expect(response.status).toBe(200);
    const state = MachineStateSchema.parse(await response.json());
    expect(state.status).toBe("heating");
    expect(state.fault).toBeNull();
    expect(state.heaterActive).toBe(false);
  });

  it("full reset restores default persisted targets", async () => {
    await simulator.app.request(
      "/api/v1/settings/temperatures",
      jsonRequest("PATCH", { brewTargetC: 95, steamTargetC: 120 }, authorization),
    );
    await simulator.app.request(
      "/api/v1/heater",
      jsonRequest("PUT", { heaterEnabled: false }, authorization),
    );
    await simulator.app.request("/_simulator/reset", { method: "POST" });
    const state = await getState();
    expect(state.brewTargetC).toBe(93);
    expect(state.steamTargetC).toBe(115);
    expect(state.heaterEnabled).toBe(true);
  });
});

async function getState() {
  const response = await simulator.app.request("/api/v1/state", {
    headers: authorization,
  });
  expect(response.status).toBe(200);
  return MachineStateSchema.parse(await response.json());
}

async function getStateV2() {
  const response = await simulator.app.request("/api/v2/state", {
    headers: authorization,
  });
  expect(response.status).toBe(200);
  return MachineStateV2Schema.parse(await response.json());
}

async function getProfiles() {
  const response = await simulator.app.request("/api/v2/profiles", {
    headers: authorization,
  });
  expect(response.status).toBe(200);
  return ProfileSetSchema.parse(await response.json());
}

async function startExtraction(
  idempotencyKey: string,
  selection: ExtractionSelection,
) {
  const response = await simulator.app.request(
    "/api/v2/extractions/start",
    jsonRequest("POST", { idempotencyKey, selection }, authorization),
  );
  expect(response.status).toBe(200);
  return RunningExtractionStateSchema.parse(await response.json());
}

async function advance(milliseconds: number) {
  await control("POST", "/_simulator/advance", { milliseconds });
}

function editedProfiles(name: string, mainExtractionSeconds: number): ProfileSet {
  return {
    profiles: [
      {
        id: "profile-1",
        profile: {
          name,
          preInfusionSeconds: 0,
          soakSeconds: 0,
          mainExtractionSeconds,
        },
      },
      {
        id: "profile-2",
        profile: {
          name: "Pre5Soak5",
          preInfusionSeconds: 5,
          soakSeconds: 5,
          mainExtractionSeconds: 25,
        },
      },
      { id: "profile-3", profile: null },
      { id: "profile-4", profile: null },
    ],
  };
}

async function setMode(mode: "brew" | "steam") {
  const response = await simulator.app.request(
    "/api/v1/mode",
    jsonRequest("PUT", { mode }, authorization),
  );
  expect(response.status).toBe(200);
}

async function control(method: "POST" | "PUT", path: string, body: unknown) {
  const response = await simulator.app.request(path, jsonRequest(method, body));
  expect(response.status).toBe(200);
  MachineStateSchema.parse(await response.json());
}

function jsonRequest(
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
