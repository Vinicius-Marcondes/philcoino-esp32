import { describe, expect, test } from "bun:test";
import type { MachineState } from "@philcoino/protocol";

import { ApiClientError } from "../src/networking/api-client-error";
import { connectionStateFromError } from "../src/networking/connection-state";
import {
  DeviceApiClient,
  type FetchImplementation,
} from "../src/networking/device-api-client";

const validState: MachineState = {
  activeMode: "brew",
  brewTargetC: 93,
  brewTemperatureC: 87.4,
  fault: null,
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
