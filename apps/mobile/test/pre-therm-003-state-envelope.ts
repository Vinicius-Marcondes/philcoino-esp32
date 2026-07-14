import type { FetchImplementation } from "../src/networking/device-api-client";

/**
 * Keeps prior mobile-to-simulator extraction tests runnable at the THERM-002
 * gate without implementing THERM-003 early. Remove this adapter when the
 * simulator serves its authoritative compensation/cooldown state.
 */
export function withPreTherm003IdleStateEnvelope(
  fetch: FetchImplementation,
  readState?: () => unknown,
): FetchImplementation {
  return async (url, init) => {
    if (new URL(url).pathname === "/api/v2/state" && readState !== undefined) {
      return responseFromBody(200, withThermalWorkflowDefaults(readState()));
    }

    const response = await fetch(url, init);
    if (!response.ok || new URL(url).pathname !== "/api/v2/state") {
      return response;
    }

    const body = await response.json();
    if (!isObject(body) || "compensation" in body || "cooldown" in body) {
      return responseFromBody(response.status, body);
    }

    return responseFromBody(response.status, withThermalWorkflowDefaults(body));
  };
}

function withThermalWorkflowDefaults(body: unknown) {
  if (!isObject(body)) {
    return body;
  }

  return {
    ...body,
    compensation: { status: "inactive", phase: null },
    cooldown: {
      status: "idle",
      cooldownId: null,
      brewTargetC: null,
      elapsedMs: 0,
      remainingMs: null,
      pumpCommand: "off",
      heaterInhibited: false,
      outcome: null,
    },
  };
}

function responseFromBody(status: number, body: unknown) {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
