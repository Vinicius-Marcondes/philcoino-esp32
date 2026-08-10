import { describe, expect, it } from "bun:test";
import {
  ApiV2ErrorResponseSchema,
  ExtractionTelemetryPageSchema,
  type ExtractionTelemetryPage,
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
const classicProfile = {
  name: "Classic30",
  preInfusionSeconds: 0,
  soakSeconds: 0,
  mainExtractionSeconds: 30,
} as const;

describe("extraction telemetry stream", () => {
  it("requires authentication, retained telemetry, and one subscriber", async () => {
    const simulator = createSimulator();
    let response = await simulator.app.request("/api/v2/extractions/stream");
    expect(response.status).toBe(401);

    response = await simulator.app.request("/api/v2/extractions/stream", {
      headers: authorization,
    });
    expect(response.status).toBe(409);
    expect(ApiV2ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "stream_unavailable",
    );

    startManual(simulator, "manual-stream-0001");
    const active = await simulator.app.request("/api/v2/extractions/stream", {
      headers: authorization,
    });
    expect(active.status).toBe(200);
    expect(active.headers.get("Content-Type")).toContain("text/event-stream");

    const busy = await simulator.app.request("/api/v2/extractions/stream", {
      headers: authorization,
    });
    expect(busy.status).toBe(409);
    expect(ApiV2ErrorResponseSchema.parse(await busy.json()).error.code).toBe(
      "stream_busy",
    );
    await active.body?.cancel();
  });

  it("publishes deterministic 250 ms manual samples and a ten-second tail", async () => {
    const simulator = createSimulator();
    startManual(simulator, "manual-stream-0002");
    const response = await simulator.app.request("/api/v2/extractions/stream", {
      headers: authorization,
    });

    simulator.machine.advance(500);
    simulator.machine.stopExtraction();
    simulator.machine.advance(10_000);
    const pages = await readAllTelemetry(response);
    const samples = pages.flatMap((page) => page.samples);

    expect(samples.slice(0, 3).map((sample) => sample.elapsedMs)).toEqual([
      0, 250, 500,
    ]);
    expect(samples.every((sample) => sample.netWeightDecigrams === null)).toBe(
      true,
    );
    expect(pages.at(-1)).toMatchObject({
      controlMode: "manual",
      status: "terminal",
      outcome: "stopped",
      hasMore: false,
    });
    expect(samples.at(-1)).toMatchObject({
      elapsedMs: 10_500,
      extractionElapsedMs: 500,
      phase: "settling",
      pumpCommand: "off",
    });
  });

  it("captures best-effort baselines for timed and weighted shots", () => {
    const simulator = createSimulator();
    calibrate(simulator);
    simulator.machine.setScaleState({ weightDecigrams: 800 });
    const timed = simulator.machine.startExtraction(
      "timed-stream-00001",
      { kind: "profile", profileId: "profile-1", profile: classicProfile },
    );
    expect(timed.ok).toBe(true);
    simulator.machine.setScaleState({ weightDecigrams: 900 });
    simulator.machine.advance(250);
    const timedPage = simulator.machine.getExtractionTelemetryPage();
    expect(timedPage.ok && timedPage.page).toMatchObject({
      controlMode: "timed",
      baselineWeightDecigrams: 800,
    });
    expect(
      timedPage.ok ? timedPage.page?.samples.at(-1)?.netWeightDecigrams : null,
    ).toBe(100);

    simulator.machine.stopExtraction();
    const weightedSimulator = createSimulator();
    calibrate(weightedSimulator);
    weightedSimulator.machine.setScaleState({ weightDecigrams: 700 });
    const weighted = weightedSimulator.machine.startExtraction(
      "weight-stream-0001",
      { kind: "profile", profileId: "profile-1", profile: classicProfile },
      { targetWeightDecigrams: 350, compensationDecigrams: 20 },
    );
    expect(weighted.ok).toBe(true);
    const weightedPage = weightedSimulator.machine.getExtractionTelemetryPage();
    expect(weightedPage.ok && weightedPage.page).toMatchObject({
      controlMode: "weight",
      baselineWeightDecigrams: 700,
      weightControl: {
        targetWeightDecigrams: 350,
        compensationDecigrams: 20,
      },
    });
  });

  it("replays from durable cursors and reports reset continuity", () => {
    const simulator = createSimulator();
    startManual(simulator, "manual-stream-0003");
    simulator.machine.advance(1_000);
    const first = simulator.machine.getExtractionTelemetryPage();
    expect(first.ok && first.page).not.toBeNull();
    if (!first.ok || first.page === null) {
      throw new Error("Expected retained extraction telemetry.");
    }
    const cursor = first.page.nextCursor;
    simulator.machine.advance(500);
    const replay = simulator.machine.getExtractionTelemetryPage(cursor);
    expect(replay.ok && replay.page).toMatchObject({ continuity: "continuous" });
    expect(
      replay.ok ? replay.page?.samples.map((sample) => sample.elapsedMs) : [],
    ).toEqual([1_250, 1_500]);

    simulator.machine.powerCycle();
    startManual(simulator, "manual-stream-0004");
    const reset = simulator.machine.getExtractionTelemetryPage(cursor);
    expect(reset.ok && reset.page).toMatchObject({
      continuity: "reset",
      extractionId: "sim-run-1",
    });
  });
});

function startManual(simulator: SimulatorApplication, key: string): void {
  const result = simulator.machine.startExtraction(key, { kind: "manual" });
  expect(result.ok).toBe(true);
}

function calibrate(simulator: SimulatorApplication): void {
  simulator.machine.setScaleState({
    available: true,
    stable: true,
    weightDecigrams: 0,
  });
  expect(simulator.machine.startScaleCalibration()).toBe("ok");
  simulator.machine.setScaleState({ weightDecigrams: 1_000 });
  expect(simulator.machine.completeScaleCalibration(1_000)).toBe("ok");
}

async function readAllTelemetry(
  response: Response,
): Promise<ExtractionTelemetryPage[]> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error("Expected a streaming response body.");
  }
  const decoder = new TextDecoder();
  const pages: ExtractionTelemetryPage[] = [];
  let buffered = "";
  while (true) {
    const { done, value } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    const frames = buffered.split("\n\n");
    buffered = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6);
      if (data !== undefined) {
        pages.push(ExtractionTelemetryPageSchema.parse(JSON.parse(data)));
      }
    }
    if (done) {
      return pages;
    }
  }
}
