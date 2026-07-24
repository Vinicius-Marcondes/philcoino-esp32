import { describe, expect, it } from "bun:test";
import {
  ApiV2ErrorResponseSchema,
  ExtractionStateSchema,
  ScaleStateSchema,
} from "@philcoino/protocol";

import {
  createSimulator,
  DEFAULT_SIMULATOR_TOKEN,
  type SimulatorApplication,
} from "../src/app.ts";

const authorization = {
  Authorization: `Bearer ${DEFAULT_SIMULATOR_TOKEN}`,
  "Content-Type": "application/json",
};

describe("weighted extraction", () => {
  it("calibrates, automatically tares, and completes at compensated weight", async () => {
    const simulator = createSimulator();
    await calibrate(simulator);
    await setScale(simulator, { weightDecigrams: 800 });

    const started = await startWeighted(simulator, "weight-start-0001", 350, 60);
    expect(started.status).toBe(200);
    expect(ExtractionStateSchema.parse(await started.json())).toMatchObject({
      status: "running",
      extractionId: "sim-run-1",
    });

    let scale = await getScale(simulator);
    expect(scale).toMatchObject({
      activeExtraction: {
        cutoffWeightDecigrams: 290,
        netWeightDecigrams: 0,
      },
    });

    await setScale(simulator, { weightDecigrams: 1089 });
    expect((await getScale(simulator)).activeExtraction).not.toBeNull();

    await setScale(simulator, { weightDecigrams: 1090 });
    scale = await getScale(simulator);
    expect(scale.activeExtraction).toBeNull();
    expect(scale.terminalExtraction).toMatchObject({
      completionReason: "weight-reached",
      finalWeightDecigrams: 290,
      fallbackOccurred: false,
      settled: true,
    });
  });

  it("does not start when calibration or automatic-tare stability is missing", async () => {
    const simulator = createSimulator();
    let response = await startWeighted(
      simulator,
      "weight-start-0002",
      350,
      60,
    );
    expect(response.status).toBe(409);
    expect(ApiV2ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "scale_not_calibrated",
    );

    await calibrate(simulator);
    await setScale(simulator, { stable: false, weightDecigrams: 800 });
    response = await startWeighted(
      simulator,
      "weight-start-0003",
      350,
      60,
    );
    expect(response.status).toBe(409);
    expect(ApiV2ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "scale_not_stable",
    );
    expect(simulator.machine.getExtractionState().status).toBe("idle");
  });

  it("falls back to the profile deadline and gates the next weighted Start", async () => {
    const simulator = createSimulator();
    await calibrate(simulator);
    await setScale(simulator, { weightDecigrams: 800 });
    await startWeighted(simulator, "weight-fallback-01", 350, 60);
    simulator.machine.advance(10_000);

    await setScale(simulator, { available: false });
    expect((await getScale(simulator)).activeExtraction?.mode).toBe(
      "timer-fallback",
    );
    simulator.machine.advance(20_000);

    let scale = await getScale(simulator);
    expect(scale.terminalExtraction).toMatchObject({
      completionReason: "timer-fallback",
      fallbackOccurred: true,
      finalWeightDecigrams: null,
    });
    expect(scale.warning?.code).toBe("scale_fallback");

    await setScale(simulator, {
      available: true,
      stable: true,
      weightDecigrams: 800,
    });
    let response = await startWeighted(
      simulator,
      "weight-fallback-02",
      350,
      60,
    );
    expect(response.status).toBe(409);
    expect(ApiV2ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "scale_warning_unacknowledged",
    );

    response = await simulator.app.request(
      "/api/v2/scale/warnings/acknowledge",
      { method: "POST", headers: authorization },
    );
    expect(response.status).toBe(200);
    expect(ScaleStateSchema.parse(await response.json()).warning).toBeNull();
    expect(
      (
        await startWeighted(
          simulator,
          "weight-fallback-02",
          350,
          60,
        )
      ).status,
    ).toBe(200);
  });

  it("binds idempotency to weight parameters without repeating tare", async () => {
    const simulator = createSimulator();
    await calibrate(simulator);
    await setScale(simulator, { weightDecigrams: 800 });
    const first = await startWeighted(
      simulator,
      "weight-idempotent-1",
      350,
      60,
    );
    const firstState = ExtractionStateSchema.parse(await first.json());

    await setScale(simulator, { weightDecigrams: 900 });
    const replay = await startWeighted(
      simulator,
      "weight-idempotent-1",
      350,
      60,
    );
    expect(ExtractionStateSchema.parse(await replay.json()).extractionId).toBe(
      firstState.extractionId,
    );
    expect((await getScale(simulator)).netWeightDecigrams).toBe(100);

    const mismatch = await startWeighted(
      simulator,
      "weight-idempotent-1",
      360,
      60,
    );
    expect(mismatch.status).toBe(409);
    expect(
      ApiV2ErrorResponseSchema.parse(await mismatch.json()).error.code,
    ).toBe("idempotency_mismatch");
  });

  it("persists calibration across power cycle but clears volatile scale workflow", async () => {
    const simulator = createSimulator();
    await calibrate(simulator);
    await simulator.app.request("/_simulator/power-cycle", { method: "POST" });
    expect((await getScale(simulator))).toMatchObject({
      calibrationStatus: "calibrated",
      activeExtraction: null,
      terminalExtraction: null,
      warning: null,
    });
  });
});

async function calibrate(simulator: SimulatorApplication): Promise<void> {
  await setScale(simulator, {
    available: true,
    stable: true,
    weightDecigrams: 0,
  });
  let response = await simulator.app.request(
    "/api/v2/scale/calibration/start",
    { method: "POST", headers: authorization },
  );
  expect(response.status).toBe(200);
  await setScale(simulator, { weightDecigrams: 1000 });
  response = await simulator.app.request(
    "/api/v2/scale/calibration/complete",
    {
      method: "POST",
      headers: authorization,
      body: JSON.stringify({ referenceWeightDecigrams: 1000 }),
    },
  );
  expect(response.status).toBe(200);
}

async function setScale(
  simulator: SimulatorApplication,
  state: {
    available?: boolean;
    stable?: boolean;
    weightDecigrams?: number;
  },
): Promise<void> {
  const response = await simulator.app.request("/_simulator/scale", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  expect(response.status).toBe(200);
}

async function getScale(simulator: SimulatorApplication) {
  const response = await simulator.app.request("/api/v2/scale", {
    headers: authorization,
  });
  expect(response.status).toBe(200);
  return ScaleStateSchema.parse(await response.json());
}

function startWeighted(
  simulator: SimulatorApplication,
  idempotencyKey: string,
  targetWeightDecigrams: number,
  compensationDecigrams: number,
) {
  return simulator.app.request("/api/v2/extractions/start", {
    method: "POST",
    headers: authorization,
    body: JSON.stringify({
      idempotencyKey,
      selection: { kind: "profile", profileId: "profile-1" },
      weightControl: { targetWeightDecigrams, compensationDecigrams },
    }),
  });
}
