import { describe, expect, it } from "bun:test";
import type { MachineStateV4 } from "@philcoino/protocol";

import { ApiClientError } from "../src/networking/api-client-error";
import {
  DeviceApiClient,
  type DeviceFetchRequestInit,
  type DeviceFetchResponse,
  type FetchImplementation,
} from "../src/networking/device-api-client";
import {
  createDebugDeviceApiClient,
  debugSelectedDevice,
} from "../src/networking/debug-device-api-client";

describe("mobile API v4 client", () => {
  it("uses only pinned HTTPS, bearer authentication, and complete state acknowledgements", async () => {
    const initial = await createDebugDeviceApiClient().getState();
    const requests: Array<{ init: DeviceFetchRequestInit; url: string }> = [];
    const fetch: FetchImplementation = async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ ...initial, revision: initial.revision + requests.length });
    };
    const client = apiClient(fetch);
    const state = await client.updateTemperatureSettings({ brewTargetC: 94 });
    expect(state.apiVersion).toBe("4");
    expect(requests[0].url).toBe("https://machine.local/api/v4/settings");
    expect(requests[0].init.headers.Authorization).toBe(
      `Bearer ${debugSelectedDevice.accessToken}`,
    );
    expect(requests[0].init.headers["X-Philcoino-SPKI-SHA256"]).toBe(
      debugSelectedDevice.certificateSpkiSha256,
    );
    expect(() => new DeviceApiClient({
      accessToken: debugSelectedDevice.accessToken,
      certificateSpkiSha256: debugSelectedDevice.certificateSpkiSha256,
      fetch,
      origin: "http://machine.local",
    })).toThrow();
  });

  it("accepts duplicate revisions but rejects stale revisions within one boot", async () => {
    const initial = await createDebugDeviceApiClient().getState();
    const states: MachineStateV4[] = [
      { ...initial, revision: 5 },
      { ...initial, revision: 5 },
      { ...initial, revision: 4 },
    ];
    const client = apiClient(async () => jsonResponse(states.shift()!));
    await expect(client.getState()).resolves.toMatchObject({ revision: 5 });
    await expect(client.getState()).resolves.toMatchObject({ revision: 5 });
    await expect(client.getState()).rejects.toMatchObject({ kind: "protocol" });
  });

  it("accepts a lower revision only after boot identity changes", async () => {
    const initial = await createDebugDeviceApiClient().getState();
    const states: MachineStateV4[] = [
      { ...initial, revision: 20 },
      {
        ...initial,
        bootId: "00000000000000000000000000000002",
        revision: 1,
      },
    ];
    const client = apiClient(async () => jsonResponse(states.shift()!));
    await client.getState();
    await expect(client.getState()).resolves.toMatchObject({ revision: 1 });
  });

  it("preserves cancellation as the first abort cause", async () => {
    const fetch: FetchImplementation = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    const client = apiClient(fetch, 50);
    const controller = new AbortController();
    const request = client.getState({ signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toEqual(
      expect.objectContaining({ kind: "cancelled" }),
    );
  });

  it("does not apply the connection timeout to an established SSE session", async () => {
    const fetch: FetchImplementation = async () => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          setTimeout(() => controller.close(), 20);
        },
      }),
      json: async () => ({}),
      ok: true,
      status: 200,
    });
    const client = apiClient(fetch, 5);
    await expect(client.streamExtractionTelemetry(undefined, {
      onPage: () => undefined,
    })).resolves.toBeUndefined();
  });
});

function apiClient(fetch: FetchImplementation, timeoutMs = 5_000) {
  return new DeviceApiClient({
    accessToken: debugSelectedDevice.accessToken,
    certificateSpkiSha256: debugSelectedDevice.certificateSpkiSha256,
    fetch,
    origin: "https://machine.local",
    timeoutMs,
  });
}

function jsonResponse(value: unknown, status = 200): DeviceFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; },
  };
}
