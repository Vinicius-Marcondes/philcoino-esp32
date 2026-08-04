import { beforeEach, describe, expect, it } from "bun:test";
import {
  ApiV2ErrorResponseSchema,
  MachineStateSchema,
  TemperatureCalibrationStateSchema,
  type ActiveTemperatureCalibrationState,
} from "@philcoino/protocol";

import {
  createSimulator,
  DEFAULT_SIMULATOR_TOKEN,
  type SimulatorApplication,
} from "../src/app.ts";

const authorization = {
  Authorization: `Bearer ${DEFAULT_SIMULATOR_TOKEN}`,
};

let simulator: SimulatorApplication;

beforeEach(() => {
  simulator = createSimulator();
});

describe("temperature calibration transaction", () => {
  it("starts at raw 100°C and saves the three required offset examples", async () => {
    for (const [candidateRawTargetC, savedOffsetC] of [
      [108, -8],
      [95, 5],
      [100, 0],
    ] as const) {
      simulator = createSimulator();
      const active = await startCalibration();
      expect(active.candidateRawTargetC).toBe(100);

      const candidate = await calibrationMutation(
        "PUT",
        "candidate",
        {
          calibrationId: active.calibrationId,
          candidateRawTargetC,
        },
      );
      expect(candidate).toMatchObject({
        status: "calibrating",
        candidateRawTargetC,
        offsetPreviewC: savedOffsetC,
      });

      await setRawTemperature(candidateRawTargetC);
      const saved = await calibrationMutation("POST", "save", {
        calibrationId: active.calibrationId,
      });
      expect(saved).toMatchObject({
        status: "calibrated",
        savedOffsetC,
        boilerTemperatureRawC: candidateRawTargetC,
        boilerTemperatureC: 100,
      });
    }
  });

  it("applies one saved offset to Brew, Steam, history, and power-cycle state", async () => {
    const active = await startCalibration();
    await calibrationMutation("PUT", "candidate", {
      calibrationId: active.calibrationId,
      candidateRawTargetC: 108,
    });
    await calibrationMutation("POST", "save", {
      calibrationId: active.calibrationId,
    });
    await simulator.app.request("/_simulator/power-cycle", {
      method: "POST",
    });
    await setRawTemperature(101);

    let state = await machineState();
    expect(state.boilerTemperatureC).toBe(93);
    await setMode("steam");
    state = await machineState();
    expect(state.boilerTemperatureC).toBe(93);

    await advance(1_000);
    const historyResponse = await simulator.app.request("/api/v2/history", {
      headers: authorization,
    });
    const history = await historyResponse.json();
    expect(history.samples[0]).toMatchObject({
      boilerTemperatureC: 103,
      steamControl: {
        controlTemperatureC: 115,
      },
      controllerDiagnostics: {
        temperatureRawC: 111,
        temperatureFilteredC: 103,
      },
    });

    const calibration = await getCalibration();
    expect(calibration).toMatchObject({
      status: "calibrated",
      savedOffsetC: -8,
    });
  });

  it("uses manual time for advisory stability and only inactivity expires the session", async () => {
    const active = await startCalibration();
    await setRawTemperature(100);
    await advance(2_999);
    let status = await getCalibration(active.calibrationId);
    expect(status).toMatchObject({
      status: "calibrating",
      advisoryStableMs: 2_999,
      ready: false,
      sessionLeaseRemainingMs: 15_000,
    });
    await advance(1);
    status = await getCalibration(active.calibrationId);
    expect(status).toMatchObject({
      status: "calibrating",
      advisoryStableMs: 3_000,
      ready: true,
    });

    for (let index = 0; index < 3; index += 1) {
      await advance(14_000);
      status = await getCalibration(active.calibrationId);
      expect(status.status).toBe("calibrating");
    }

    await advance(15_000);
    const expired = await simulator.app.request(
      `/api/v2/temperature-calibration?calibrationId=${active.calibrationId}`,
      { headers: authorization },
    );
    expect(expired.status).toBe(409);
    expect(
      ApiV2ErrorResponseSchema.parse(await expired.json()).error.code,
    ).toBe("temperature_calibration_expired");
  });

  it("keeps the prior offset on failed persistence and discards unsaved cancellation", async () => {
    let active = await startCalibration();
    await calibrationMutation("PUT", "candidate", {
      calibrationId: active.calibrationId,
      candidateRawTargetC: 108,
    });
    await calibrationMutation("POST", "save", {
      calibrationId: active.calibrationId,
    });

    active = await startCalibration();
    await calibrationMutation("PUT", "candidate", {
      calibrationId: active.calibrationId,
      candidateRawTargetC: 95,
    });
    await simulator.app.request(
      "/_simulator/fail-next-temperature-calibration-save",
      { method: "POST" },
    );
    let response = await simulator.app.request(
      "/api/v2/temperature-calibration/save",
      jsonRequest("POST", { calibrationId: active.calibrationId }),
    );
    expect(response.status).toBe(500);
    expect(
      ApiV2ErrorResponseSchema.parse(await response.json()).error.code,
    ).toBe("persistence_failure");
    expect(await getCalibration(active.calibrationId)).toMatchObject({
      status: "calibrating",
      savedOffsetC: -8,
      offsetPreviewC: 5,
    });

    await calibrationMutation("POST", "cancel", {
      calibrationId: active.calibrationId,
    });
    expect(await getCalibration()).toMatchObject({
      status: "calibrated",
      savedOffsetC: -8,
    });
  });

  it("clears the record on reset and fails off after a corrupt load", async () => {
    const active = await startCalibration();
    await calibrationMutation("POST", "save", {
      calibrationId: active.calibrationId,
    });
    await simulator.app.request(
      "/_simulator/corrupt-temperature-calibration",
      { method: "POST" },
    );
    await simulator.app.request("/_simulator/power-cycle", {
      method: "POST",
    });
    expect(await machineState()).toMatchObject({
      status: "fault",
      heaterActive: false,
      fault: { code: "internal_error" },
    });

    await simulator.app.request("/_simulator/reset", { method: "POST" });
    expect(await getCalibration()).toMatchObject({
      status: "uncalibrated",
      savedOffsetC: 0,
    });
  });

  it("rejects unsafe calibration saves and later unsafe target mutations without clamping", async () => {
    let response = await simulator.app.request(
      "/api/v1/settings/temperatures",
      jsonRequest("PATCH", { steamTargetC: 135 }),
    );
    expect(response.status).toBe(200);
    let active = await startCalibration();
    await calibrationMutation("PUT", "candidate", {
      calibrationId: active.calibrationId,
      candidateRawTargetC: 120,
    });
    response = await simulator.app.request(
      "/api/v2/temperature-calibration/save",
      jsonRequest("POST", { calibrationId: active.calibrationId }),
    );
    expect(response.status).toBe(409);
    expect(
      ApiV2ErrorResponseSchema.parse(await response.json()).error.code,
    ).toBe("temperature_target_unsafe");
    await calibrationMutation("POST", "cancel", {
      calibrationId: active.calibrationId,
    });

    simulator = createSimulator();
    active = await startCalibration();
    await calibrationMutation("PUT", "candidate", {
      calibrationId: active.calibrationId,
      candidateRawTargetC: 116,
    });
    const saved = await calibrationMutation("POST", "save", {
      calibrationId: active.calibrationId,
    });
    expect(saved).toMatchObject({
      savedOffsetC: -16,
      safeTargetBounds: { steamMaximumC: 119 },
    });

    response = await simulator.app.request(
      "/api/v1/settings/temperatures",
      jsonRequest("PATCH", { steamTargetC: 120 }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(
      "temperature_target_unsafe",
    );
    expect((await machineState()).steamTargetC).toBe(115);
  });

  it("allows exactly 135°C and faults strictly above each independent cap", async () => {
    let active = await startCalibration();
    await calibrationMutation("PUT", "candidate", {
      calibrationId: active.calibrationId,
      candidateRawTargetC: 95,
    });
    await calibrationMutation("POST", "save", {
      calibrationId: active.calibrationId,
    });
    await simulator.app.request("/_simulator/power-cycle", {
      method: "POST",
    });
    await setMode("steam");
    await setRawTemperature(130);
    expect(await machineState()).toMatchObject({
      status: "heating",
      boilerTemperatureC: 135,
      heaterActive: false,
      fault: null,
    });
    await setRawTemperature(130.25);
    expect(await machineState()).toMatchObject({
      status: "fault",
      boilerTemperatureC: 135.3,
      heaterActive: false,
      fault: { code: "over_temperature" },
    });

    simulator = createSimulator();
    active = await startCalibration();
    await calibrationMutation("PUT", "candidate", {
      calibrationId: active.calibrationId,
      candidateRawTargetC: 108,
    });
    await calibrationMutation("POST", "save", {
      calibrationId: active.calibrationId,
    });
    await simulator.app.request("/_simulator/power-cycle", {
      method: "POST",
    });
    await setMode("steam");
    await setRawTemperature(135);
    expect(await machineState()).toMatchObject({
      status: "heating",
      boilerTemperatureC: 127,
      heaterActive: false,
      fault: null,
    });
    await setRawTemperature(135.25);
    expect(await machineState()).toMatchObject({
      status: "fault",
      boilerTemperatureC: 127.3,
      heaterActive: false,
      fault: { code: "over_temperature" },
    });
  });

  it("rejects conflicting owners and cancels an active candidate before another workflow", async () => {
    await startExtraction();
    let response = await simulator.app.request(
      "/api/v2/temperature-calibration/start",
      { headers: authorization, method: "POST" },
    );
    expect(response.status).toBe(409);
    expect(
      ApiV2ErrorResponseSchema.parse(await response.json()).error.code,
    ).toBe("extraction_active");

    simulator = createSimulator();
    const active = await startCalibration();
    response = await simulator.app.request(
      "/api/v2/extractions/start",
      jsonRequest("POST", {
        idempotencyKey: "after-temperature-calibration",
        selection: { kind: "manual" },
      }),
    );
    expect(response.status).toBe(409);
    expect(
      ApiV2ErrorResponseSchema.parse(await response.json()).error.code,
    ).toBe("temperature_calibration_active");
    expect(await getCalibration()).toMatchObject({
      status: "uncalibrated",
      savedOffsetC: 0,
    });

    response = await simulator.app.request(
      `/api/v2/temperature-calibration?calibrationId=${active.calibrationId}`,
      { headers: authorization },
    );
    expect(response.status).toBe(409);
  });

  it("rejects every guarded start state with its contract error", async () => {
    await setMode("steam");
    expect(await startCalibrationError()).toBe("brew_mode_required");

    simulator = createSimulator();
    await simulator.app.request(
      "/api/v1/heater",
      jsonRequest("PUT", { heaterEnabled: false }),
    );
    expect(await startCalibrationError()).toBe("heater_disabled");

    simulator = createSimulator();
    await simulator.app.request(
      "/_simulator/fault",
      jsonRequest("PUT", { code: "sensor_failure" }),
    );
    expect(await startCalibrationError()).toBe("sensor_unavailable");

    simulator = createSimulator();
    await simulator.app.request("/api/v2/scale/calibration/start", {
      headers: authorization,
      method: "POST",
    });
    expect(await startCalibrationError()).toBe(
      "calibration_in_progress",
    );

    simulator = createSimulator();
    await setMode("steam");
    await setRawTemperature(120);
    await simulator.app.request(
      "/api/v2/cooldowns/start",
      jsonRequest("POST", {
        idempotencyKey: "temperature-calibration-cooldown",
      }),
    );
    expect(await startCalibrationError()).toBe("cooldown_active");

    simulator = createSimulator();
    await startCalibration();
    expect(await startCalibrationError()).toBe(
      "temperature_calibration_active",
    );
  });

  it("strictly rejects malformed queries, candidates, and late session identifiers", async () => {
    for (const query of [
      "?unknown=value",
      "?calibrationId=short",
      "?calibrationId=temp-cal-sim-00000001&calibrationId=temp-cal-sim-00000001",
    ]) {
      const response = await simulator.app.request(
        `/api/v2/temperature-calibration${query}`,
        { headers: authorization },
      );
      expect(response.status).toBe(400);
      expect(
        ApiV2ErrorResponseSchema.parse(await response.json()).error.code,
      ).toBe("malformed_request");
    }

    const active = await startCalibration();
    for (const body of [
      {
        calibrationId: active.calibrationId,
        candidateRawTargetC: 100.5,
      },
      {
        calibrationId: active.calibrationId,
        candidateRawTargetC: 121,
      },
      {
        calibrationId: active.calibrationId,
        candidateRawTargetC: 100,
        unexpected: true,
      },
    ]) {
      const response = await simulator.app.request(
        "/api/v2/temperature-calibration/candidate",
        jsonRequest("PUT", body),
      );
      expect(response.status).toBe(400);
    }

    let response = await simulator.app.request(
      "/api/v2/temperature-calibration/cancel",
      jsonRequest("POST", {
        calibrationId: "temp-cal-wrong-00000000",
      }),
    );
    expect(response.status).toBe(409);
    expect(
      ApiV2ErrorResponseSchema.parse(await response.json()).error.code,
    ).toBe("temperature_calibration_session_mismatch");

    await calibrationMutation("POST", "cancel", {
      calibrationId: active.calibrationId,
    });
    response = await simulator.app.request(
      "/api/v2/temperature-calibration/cancel",
      jsonRequest("POST", {
        calibrationId: active.calibrationId,
      }),
    );
    expect(response.status).toBe(409);
    expect(
      ApiV2ErrorResponseSchema.parse(await response.json()).error.code,
    ).toBe("temperature_calibration_inactive");
  });
});

async function startCalibration(): Promise<ActiveTemperatureCalibrationState> {
  const response = await simulator.app.request(
    "/api/v2/temperature-calibration/start",
    { headers: authorization, method: "POST" },
  );
  expect(response.status).toBe(200);
  const state = TemperatureCalibrationStateSchema.parse(
    await response.json(),
  );
  expect(state.status).toBe("calibrating");
  return state as ActiveTemperatureCalibrationState;
}

async function getCalibration(
  calibrationId?: string,
) {
  const suffix =
    calibrationId === undefined
      ? ""
      : `?calibrationId=${calibrationId}`;
  const response = await simulator.app.request(
    `/api/v2/temperature-calibration${suffix}`,
    { headers: authorization },
  );
  expect(response.status).toBe(200);
  return TemperatureCalibrationStateSchema.parse(await response.json());
}

async function calibrationMutation(
  method: "POST" | "PUT",
  operation: "candidate" | "save" | "cancel",
  body: Record<string, unknown>,
) {
  const response = await simulator.app.request(
    `/api/v2/temperature-calibration/${operation}`,
    jsonRequest(method, body),
  );
  expect(response.status).toBe(200);
  return TemperatureCalibrationStateSchema.parse(await response.json());
}

async function setRawTemperature(boilerTemperatureRawC: number) {
  const response = await simulator.app.request(
    "/_simulator/raw-temperature",
    jsonRequest("PUT", { boilerTemperatureRawC }),
  );
  expect(response.status).toBe(200);
}

async function machineState() {
  const response = await simulator.app.request("/api/v1/state", {
    headers: authorization,
  });
  return MachineStateSchema.parse(await response.json());
}

async function setMode(mode: "brew" | "steam") {
  const response = await simulator.app.request(
    "/api/v1/mode",
    jsonRequest("PUT", { mode }),
  );
  expect(response.status).toBe(200);
}

async function advance(milliseconds: number) {
  const response = await simulator.app.request(
    "/_simulator/advance",
    jsonRequest("POST", { milliseconds }),
  );
  expect(response.status).toBe(200);
}

async function startExtraction() {
  const response = await simulator.app.request(
    "/api/v2/extractions/start",
    jsonRequest("POST", {
      idempotencyKey: "temperature-calibration-conflict",
      selection: { kind: "manual" },
    }),
  );
  expect(response.status).toBe(200);
}

async function startCalibrationError() {
  const response = await simulator.app.request(
    "/api/v2/temperature-calibration/start",
    { headers: authorization, method: "POST" },
  );
  expect(response.status).toBe(409);
  return ApiV2ErrorResponseSchema.parse(await response.json()).error.code;
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: {
      ...authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}
