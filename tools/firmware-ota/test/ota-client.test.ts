import { describe, expect, it } from "bun:test";

import {
  createSimulator,
  DEFAULT_SIMULATOR_CERTIFICATE_PIN,
  DEFAULT_SIMULATOR_PAIRING_CODE,
} from "../../device-simulator/src/app.ts";
import {
  completeHttpResponseByteLength,
  normalizeOtaOrigin,
  pairForFirmwareUpdate,
  parseHttpResponse,
  uploadFirmwareImage,
  type OtaRequest,
  type OtaTransport,
} from "../src/ota-client.ts";

describe("Mac firmware OTA client", () => {
  it("normalizes only path-free HTTPS origins", () => {
    expect(normalizeOtaOrigin("philcoino-9EA3E4.local")).toBe(
      "https://philcoino-9ea3e4.local",
    );
    expect(() => normalizeOtaOrigin("http://machine.local")).toThrow();
    expect(() => normalizeOtaOrigin("https://machine.local/api")).toThrow();
  });

  it("pairs, pins the certificate, and uploads the image", async () => {
    const simulator = createSimulator();
    const transport = simulatorTransport(simulator.app);
    const stages: string[] = [];
    const credential = await pairForFirmwareUpdate(
      "https://machine.local",
      DEFAULT_SIMULATOR_PAIRING_CODE,
      transport,
      (stage) => stages.push(stage),
    );
    expect(credential.certificatePin).toBe(DEFAULT_SIMULATOR_CERTIFICATE_PIN);
    expect(stages).toEqual([
      "connection",
      "srp-start",
      "client-proof",
      "server-proof",
      "certificate-binding",
      "token-issue",
    ]);

    simulator.machine.setHeaterEnabled(true);
    const image = new Uint8Array([0xe9, 1, 2, 3, 4, 5]);
    const progress: number[] = [];
    const accepted = await uploadFirmwareImage(
      "https://machine.local",
      image,
      credential,
      transport,
      (sent) => progress.push(sent),
    );
    expect(accepted).toEqual({
      bytesWritten: image.length,
      rebooting: true,
      status: "accepted",
    });
    expect(simulator.machine.getStateV4().machine.heaterEnabled).toBe(false);
    expect(progress).toEqual([image.length]);
  });

  it("stops before upload when the pinned certificate changes", async () => {
    const simulator = createSimulator();
    const validTransport = simulatorTransport(simulator.app);
    const credential = await pairForFirmwareUpdate(
      "https://machine.local",
      DEFAULT_SIMULATOR_PAIRING_CODE,
      validTransport,
    );
    const substitutedTransport = simulatorTransport(
      simulator.app,
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    await expect(uploadFirmwareImage(
      "https://machine.local",
      new Uint8Array([0xe9, 1]),
      credential,
      substitutedTransport,
    )).rejects.toThrow("certificate pin");
  });

  it("rejects a non-ESP image before making a network request", async () => {
    let requests = 0;
    const transport: OtaTransport = {
      request() {
        requests += 1;
        throw new Error("unexpected request");
      },
    };
    await expect(uploadFirmwareImage(
      "https://machine.local",
      new Uint8Array([1, 2, 3]),
      {
        accessToken: "token",
        certificatePin: DEFAULT_SIMULATOR_CERTIFICATE_PIN,
        clientId: "0".repeat(32),
        deviceId: "machine",
      },
      transport,
    )).rejects.toThrow("not an ESP-IDF application image");
    expect(requests).toBe(0);
  });

  it("parses content-length and chunked HTTP responses", () => {
    const direct = parseHttpResponse(Buffer.from(
      "HTTP/1.1 202 Accepted\r\nContent-Length: 2\r\n\r\n{}",
    ));
    expect(direct.status).toBe(202);
    expect(new TextDecoder().decode(direct.body)).toBe("{}");

    const chunked = parseHttpResponse(Buffer.from(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n",
    ));
    expect(new TextDecoder().decode(chunked.body)).toBe("{}");
  });

  it("recognizes complete responses without waiting for the server to close", () => {
    const direct = Buffer.from(
      "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}",
    );
    expect(completeHttpResponseByteLength(direct.subarray(0, -1))).toBeNull();
    expect(completeHttpResponseByteLength(direct)).toBe(direct.length);

    const chunked = Buffer.from(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n",
    );
    expect(completeHttpResponseByteLength(chunked.subarray(0, -1))).toBeNull();
    expect(completeHttpResponseByteLength(chunked)).toBe(chunked.length);
  });
});

function simulatorTransport(
  app: ReturnType<typeof createSimulator>["app"],
  presentedPin = DEFAULT_SIMULATOR_CERTIFICATE_PIN,
): OtaTransport {
  return {
    async request(request: OtaRequest) {
      if (
        request.expectedPin !== undefined &&
        request.expectedPin !== presentedPin
      ) {
        throw new Error("The ESP32 certificate pin does not match the paired device.");
      }
      const response = await app.request(request.path, {
        body: request.body.slice().buffer,
        headers: request.headers,
        method: request.method,
      });
      request.onProgress?.(request.body.length, request.body.length);
      return {
        body: new Uint8Array(await response.arrayBuffer()),
        presentedPin,
        status: response.status,
      };
    },
  };
}
