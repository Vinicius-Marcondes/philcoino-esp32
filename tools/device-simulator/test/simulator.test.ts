import { beforeEach, describe, expect, it } from "bun:test";
import {
  DeviceResponseSchema,
  ErrorResponseSchema,
  HeaterSettingsResponseSchema,
  HealthResponseSchema,
  MachineStateSchema,
  ModeResponseSchema,
  STEAM_TIMEOUT_MS,
  TemperatureSettingsResponseSchema,
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
  ])("rejects a missing token for %s %s", async (method, path) => {
    const response = await simulator.app.request(path, { method });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "unauthorized",
    );
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
