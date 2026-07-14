import { describe, expect, test } from "bun:test";
import type { MachineState } from "@philcoino/protocol";

import { ApiClientError } from "../src/networking/api-client-error";
import { connectionStateFromError } from "../src/networking/connection-state";
import { DEFAULT_MOBILE_PROFILE_SET } from "../src/profiles/profile-set";
import {
  DeviceApiClient,
  type FetchImplementation,
} from "../src/networking/device-api-client";
import {
  createSimulator,
  DEFAULT_SIMULATOR_TOKEN,
} from "../../../tools/device-simulator/src/app.ts";

const validState: MachineState = {
  activeMode: "brew",
  brewTargetC: 93,
  brewTemperatureC: 87.4,
  fault: null,
  heaterEnabled: true,
  heaterActive: true,
  status: "heating",
  steamTargetC: 115,
  steamTemperatureC: 103.8,
  steamTimeoutRemainingMs: null,
  uptimeMs: 184_220,
};

describe("DeviceApiClient", () => {
  test("validates state before returning it and sends the bearer token", async () => {
    let authorization: string | null = null;
    const client = new DeviceApiClient({
      address: "192.168.1.20",
      token: "secret-token",
      fetch: async (_url, init) => {
        authorization = new Headers(init?.headers).get("Authorization");
        return Response.json(validState);
      },
    });

    await expect(client.getState()).resolves.toEqual(validState);
    expect(authorization as string | null).toBe("Bearer secret-token");
  });

  test("rejects malformed successful responses as protocol errors", async () => {
    const client = clientWithResponse(Response.json({ ...validState, extra: true }));

    const error = await captureError(client.getState());
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).kind).toBe("protocol");
    expect(connectionStateFromError(error)).toEqual({ status: "protocol-error" });
  });

  test("maps a validated 401 response to unauthorized", async () => {
    const client = clientWithResponse(
      Response.json(
        {
          error: {
            code: "unauthorized",
            message: "A valid bearer token is required.",
          },
        },
        { status: 401 },
      ),
    );

    const error = await captureError(client.getState());
    expect((error as ApiClientError).kind).toBe("unauthorized");
    expect(connectionStateFromError(error)).toEqual({ status: "unauthorized" });
  });

  test("rejects malformed error payloads as protocol errors", async () => {
    const client = clientWithResponse(
      Response.json({ error: "unauthorized" }, { status: 401 }),
    );

    const error = await captureError(client.getState());
    expect((error as ApiClientError).kind).toBe("protocol");
  });

  test("maps a 404 address to not found", async () => {
    const client = clientWithResponse(new Response("Not found", { status: 404 }));

    const error = await captureError(client.getDevice());
    expect((error as ApiClientError).kind).toBe("not-found");
    expect(connectionStateFromError(error)).toEqual({ status: "not-found" });
  });

  test("maps network failures to offline", async () => {
    const client = new DeviceApiClient({
      address: "philcoino.local",
      fetch: async () => {
        throw new Error("socket closed");
      },
    });

    const error = await captureError(client.getDevice());
    expect((error as ApiClientError).kind).toBe("offline");
    expect(connectionStateFromError(error)).toEqual({ status: "offline" });
  });

  test("times out and aborts a hanging request", async () => {
    let wasAborted = false;
    const client = new DeviceApiClient({
      address: "philcoino.local",
      fetch: hangingFetch(() => {
        wasAborted = true;
      }),
      timeoutMs: 5,
    });

    const error = await captureError(client.getDevice());
    expect((error as ApiClientError).kind).toBe("timeout");
    expect(wasAborted).toBe(true);
  });

  test("external cancellation aborts cleanly without changing connection state", async () => {
    const controller = new AbortController();
    const client = new DeviceApiClient({
      address: "philcoino.local",
      fetch: hangingFetch(),
    });

    const request = client.getDevice({ signal: controller.signal });
    controller.abort();

    const error = await captureError(request);
    expect((error as ApiClientError).kind).toBe("cancelled");
    expect(connectionStateFromError(error)).toBeNull();
  });

  test("does not start a request when the caller signal is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    let fetchCalled = false;
    const client = new DeviceApiClient({
      address: "philcoino.local",
      fetch: async () => {
        fetchCalled = true;
        return Response.json({});
      },
    });

    const error = await captureError(
      client.getDevice({ signal: controller.signal }),
    );
    expect((error as ApiClientError).kind).toBe("cancelled");
    expect(fetchCalled).toBe(false);
  });

  test("validates mutation input and acknowledged response", async () => {
    const client = clientWithResponse(Response.json({ mode: "steam" }));
    await expect(client.setMode({ mode: "steam" })).resolves.toEqual({
      mode: "steam",
    });

    const invalid = client.setMode({ mode: "cleaning" } as never);
    const error = await captureError(invalid);
    expect((error as ApiClientError).kind).toBe("invalid-request");
  });

  test("requests heater permission changes and validates acknowledgement", async () => {
    let sentBody: string | undefined;
    let sentMethod: string | undefined;
    let sentUrl: string | undefined;
    const client = new DeviceApiClient({
      address: "philcoino.local",
      fetch: async (url, init) => {
        sentBody = init.body;
        sentMethod = init.method;
        sentUrl = url;
        return Response.json({ heaterEnabled: false });
      },
      token: "secret-token",
    });

    await expect(
      client.setHeaterEnabled({ heaterEnabled: false }),
    ).resolves.toEqual({ heaterEnabled: false });
    expect(sentMethod).toBe("PUT");
    expect(sentUrl).toBe("http://philcoino.local/api/v1/heater");
    expect(sentBody).toBe(JSON.stringify({ heaterEnabled: false }));

    const invalid = client.setHeaterEnabled({ heaterEnabled: "off" } as never);
    const error = await captureError(invalid);
    expect((error as ApiClientError).kind).toBe("invalid-request");
  });

  test("requests over-temperature dismissal and validates the acknowledged snapshot", async () => {
    let sentMethod: string | undefined;
    let sentUrl: string | undefined;
    const dismissedState: MachineState = {
      ...validState,
      brewTemperatureC: 93,
      fault: null,
      heaterActive: false,
      status: "heating",
    };
    const client = new DeviceApiClient({
      address: "philcoino.local",
      fetch: async (url, init) => {
        sentMethod = init.method;
        sentUrl = url;
        return Response.json(dismissedState);
      },
      token: "secret-token",
    });

    await expect(client.dismissOverTemperature()).resolves.toEqual(dismissedState);
    expect(sentMethod).toBe("POST");
    expect(sentUrl).toBe(
      "http://philcoino.local/api/v1/faults/over-temperature/dismiss",
    );
  });

  test("rejects malformed over-temperature dismissal acknowledgement", async () => {
    const client = clientWithResponse(Response.json({ ok: true }));

    const error = await captureError(client.dismissOverTemperature());
    expect((error as ApiClientError).kind).toBe("protocol");
  });

  test("blocks out-of-range temperature settings before sending and validates acknowledgement", async () => {
    let fetchCalls = 0;
    let sentBody: string | undefined;
    let sentMethod: string | undefined;
    const client = new DeviceApiClient({
      address: "philcoino.local",
      fetch: async (_url, init) => {
        fetchCalls += 1;
        sentBody = init.body;
        sentMethod = init.method;
        return Response.json({ brewTargetC: 94, steamTargetC: 116 });
      },
      token: "secret-token",
    });

    const invalid = client.updateTemperatureSettings({
      brewTargetC: 84,
    } as never);
    const error = await captureError(invalid);
    expect((error as ApiClientError).kind).toBe("invalid-request");
    expect(fetchCalls).toBe(0);

    await expect(
      client.updateTemperatureSettings({
        brewTargetC: 94,
        steamTargetC: 116,
      }),
    ).resolves.toEqual({ brewTargetC: 94, steamTargetC: 116 });
    expect(fetchCalls).toBe(1);
    expect(sentMethod).toBe("PATCH");
    expect(sentBody).toBe(
      JSON.stringify({ brewTargetC: 94, steamTargetC: 116 }),
    );
  });

  test("enforces a finite timeout bound", () => {
    expect(
      () =>
        new DeviceApiClient({
          address: "philcoino.local",
          fetch: async () => Response.json({}),
          timeoutMs: 0,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new DeviceApiClient({
          address: "philcoino.local",
          fetch: async () => Response.json({}),
          timeoutMs: 30_001,
        }),
    ).toThrow(RangeError);
  });

  test("validates API v2 profile and acknowledged extraction operations against the simulator", async () => {
    const simulator = createSimulator();
    const request = simulator.app.request.bind(simulator.app);
    const client = new DeviceApiClient({
      address: "http://127.0.0.1:3000",
      fetch: (url, init) =>
        Promise.resolve(
          request(url, {
            body: init.body,
            headers: init.headers,
            method: init.method,
            signal: init.signal,
          }),
        ),
      token: DEFAULT_SIMULATOR_TOKEN,
    });

    await expect(client.getProfiles()).resolves.toEqual(
      DEFAULT_MOBILE_PROFILE_SET,
    );
    await expect(
      client.replaceProfiles(DEFAULT_MOBILE_PROFILE_SET),
    ).resolves.toEqual(DEFAULT_MOBILE_PROFILE_SET);

    const started = await client.startExtraction({
      idempotencyKey: "mobile-integration-01",
      selection: { kind: "profile", profileId: "profile-2" },
    });
    expect(started).toMatchObject({
      status: "running",
      phase: "pre-infusion",
      pumpCommand: "running",
    });
    await simulator.app.request("/_simulator/advance", {
      body: JSON.stringify({ milliseconds: 5_000 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await expect(client.getStateV2()).resolves.toMatchObject({
      extraction: {
        extractionId: started.extractionId,
        elapsedMs: 5_000,
        phase: "soak",
        pumpCommand: "off",
      },
    });
    await simulator.app.request("/_simulator/fault", {
      body: JSON.stringify({ code: "sensor_failure" }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    await simulator.app.request("/_simulator/advance", {
      body: JSON.stringify({ milliseconds: 5_000 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await expect(client.startExtraction({
      idempotencyKey: "mobile-integration-01",
      selection: { kind: "manual" },
    })).resolves.toMatchObject({
      extractionId: started.extractionId,
      elapsedMs: 10_000,
      phase: "main-extraction",
      pumpCommand: "running",
      selection: { kind: "profile", profileId: "profile-2" },
    });
    await expect(client.getStateV2()).resolves.toMatchObject({
      extraction: { extractionId: started.extractionId, status: "running" },
      machine: { status: "fault" },
    });
    await expect(client.stopExtraction()).resolves.toMatchObject({
      status: "idle",
      pumpCommand: "off",
    });
  });

  test("parses API v2 active conflicts without treating them as protocol failures", async () => {
    const client = clientWithResponse(
      Response.json(
        {
          error: {
            code: "extraction_active",
            message: "A different extraction is already active.",
          },
          activeExtraction: {
            status: "running",
            extractionId: "run-1",
            selection: { kind: "manual" },
            phase: "manual",
            elapsedMs: 1_000,
            remainingMs: 59_000,
            pumpCommand: "running",
          },
        },
        { status: 409 },
      ),
    );

    const error = await captureError(
      client.startExtraction({
        idempotencyKey: "mobile-conflict-001",
        selection: { kind: "manual" },
      }),
    );
    expect((error as ApiClientError).kind).toBe("http");
    expect((error as ApiClientError).response).toMatchObject({
      activeExtraction: { elapsedMs: 1_000 },
      error: { code: "extraction_active" },
    });
  });
});

function clientWithResponse(response: Response): DeviceApiClient {
  return new DeviceApiClient({
    address: "http://philcoino.local",
    fetch: async () => response,
    token: "secret-token",
  });
}

function hangingFetch(onAbort?: () => void): FetchImplementation {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => {
          onAbort?.();
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}
