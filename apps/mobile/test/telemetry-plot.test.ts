import { describe, expect, test } from "bun:test";

import {
  HISTORY_GAP_THRESHOLD_MS,
  type TemperatureHistorySample,
} from "../src/history/temperature-history";
import type {
  StoredWeightedShotTrace,
  StoredWeightedTraceSample,
} from "../src/history/weighted-shot-trace";
import {
  activityRects,
  linePath,
  splitContinuous,
  temperatureHistoryPlot,
  weightedTracePlot,
} from "../src/telemetry/telemetry-plot";

const WINDOW = { endMs: 1_800_030_000, startMs: 1_800_000_000 };

describe("weighted trace plot", () => {
  test("anchors the weight scale to the band and clamps negative weight", () => {
    const plot = plotOf([
      traceSample({ elapsedMs: 0, netWeightDecigrams: 0 }),
      traceSample({ elapsedMs: 10_000, netWeightDecigrams: 180 }),
    ]);
    expect(plot.weightY(0)).toBe(plot.weightBand.bottom);
    expect(plot.weightY(18)).toBe(plot.weightBand.top);
    expect(plot.weightY(-5)).toBe(plot.weightBand.bottom);
    expect(plot.flowY(0)).toBe(plot.weightBand.bottom);
  });

  test("keeps the weight floor at ten grams and lifts it to the cutoff", () => {
    const light = plotOf([
      traceSample({ elapsedMs: 0, netWeightDecigrams: 0 }),
      traceSample({ elapsedMs: 5_000, netWeightDecigrams: 20 }),
    ]);
    expect(light.weightY(10)).toBe(light.weightBand.top);

    const withCutoff = plotOf(
      [
        traceSample({ elapsedMs: 0, netWeightDecigrams: 0 }),
        traceSample({ elapsedMs: 5_000, netWeightDecigrams: 20 }),
      ],
      360,
    );
    expect(withCutoff.weightY(36)).toBe(withCutoff.weightBand.top);
    expect(withCutoff.cutoffY).toBe(withCutoff.weightY(36));
    expect(light.cutoffY).toBeNull();
  });

  test("keeps the flow floor at two grams per second", () => {
    const plot = plotOf([
      traceSample({ derivedFlowGPerS: 0.4, elapsedMs: 0 }),
      traceSample({ derivedFlowGPerS: 0.8, elapsedMs: 5_000 }),
    ]);
    expect(plot.flowY(2)).toBe(plot.weightBand.top);
  });

  test("maps elapsed time across the full plot width", () => {
    const plot = plotOf([
      traceSample({ elapsedMs: 0 }),
      traceSample({ elapsedMs: 24_000 }),
    ]);
    expect(plot.x(0)).toBe(plot.left);
    expect(plot.x(24_000)).toBe(plot.right);
    expect(plot.maxElapsed).toBe(24_000);
  });

  test("never plots weight or flow that the device did not report", () => {
    const plot = plotOf([
      traceSample({ derivedFlowGPerS: null, elapsedMs: 0, netWeightDecigrams: null }),
      traceSample({
        derivedFlowGPerS: null,
        elapsedMs: 5_000,
        netWeightDecigrams: null,
      }),
    ]);
    expect(plot.weightPaths).toEqual([]);
    expect(plot.flowAreas).toEqual([]);
  });

  test("needs two flow samples in a segment before filling an area", () => {
    const plot = plotOf([
      traceSample({ derivedFlowGPerS: 1.2, elapsedMs: 0 }),
      traceSample({ derivedFlowGPerS: null, elapsedMs: 5_000 }),
    ]);
    expect(plot.flowAreas).toEqual([]);
  });

  test("starts a new segment on the gap sample itself", () => {
    const plot = plotOf([
      traceSample({ elapsedMs: 0 }),
      traceSample({ elapsedMs: 5_000 }),
      traceSample({ elapsedMs: 10_000, gapStatus: "gap" }),
      traceSample({ elapsedMs: 15_000 }),
    ]);
    expect(plot.temperaturePaths).toHaveLength(2);
    const [first, second] = plot.temperaturePaths;
    expect(first.split("L")).toHaveLength(2);
    expect(second.startsWith(`M ${plot.x(10_000).toFixed(2)}`)).toBe(true);
  });

  test("marks one boundary per phase transition and the first settling sample", () => {
    const plot = plotOf([
      traceSample({ elapsedMs: 0, phase: "pre-infusion" }),
      traceSample({ elapsedMs: 5_000, phase: "main-extraction" }),
      traceSample({ elapsedMs: 10_000, phase: "main-extraction" }),
      traceSample({ elapsedMs: 15_000, phase: "settling" }),
      traceSample({ elapsedMs: 20_000, phase: "settling" }),
    ]);
    expect(plot.phaseBoundaries).toEqual([plot.x(5_000), plot.x(15_000)]);
    expect(plot.settlingX).toBe(plot.x(15_000));
    expect(plotOf([traceSample({ elapsedMs: 0 })]).settlingX).toBeNull();
  });

  test("keeps a minimum span so a first sample still has a scale", () => {
    const plot = plotOf([traceSample({ elapsedMs: 0 })]);
    expect(plot.maxElapsed).toBe(1_000);
  });
});

describe("temperature history plot", () => {
  test("anchors the temperature scale to the first band for both band counts", () => {
    const samples = [
      historySample(WINDOW.startMs + 1_000, 90),
      historySample(WINDOW.startMs + 2_000, 94),
    ];
    for (const bandCount of [1, 2] as const) {
      const plot = temperatureHistoryPlot({
        bandCount,
        height: bandCount === 1 ? 190 : 330,
        samples,
        width: 400,
        window: WINDOW,
      });
      const top = plot.temperatureY(plot.temperatureTicks.at(-1)!);
      const bottom = plot.temperatureY(plot.temperatureTicks[0]);
      expect(top).toBeCloseTo(plot.temperatureBand.top, 6);
      expect(bottom).toBeCloseTo(plot.temperatureBand.bottom, 6);
      expect(plot.weightBand).toEqual(bandCount === 1 ? null : plot.bands[1]);
    }
  });

  test("maps the window edges to the plot edges", () => {
    const plot = historyPlotOf([historySample(WINDOW.startMs + 1_000, 92)]);
    expect(plot.x(WINDOW.startMs)).toBe(plot.left);
    expect(plot.x(WINDOW.endMs)).toBe(plot.right);
  });

  test("breaks the curve at a real history gap instead of bridging it", () => {
    const plot = historyPlotOf([
      historySample(WINDOW.startMs + 1_000, 92),
      historySample(WINDOW.startMs + 2_000, 92.5),
      historySample(
        WINDOW.startMs + 2_000 + HISTORY_GAP_THRESHOLD_MS + 1_000,
        93,
      ),
    ]);
    expect(plot.temperaturePaths).toHaveLength(2);
    expect(plot.targetPaths).toHaveLength(2);
    expect(plot.temperaturePaths[1]).not.toContain("L");
  });

  test("run-length encodes heater activity and breaks runs on gaps", () => {
    const plot = historyPlotOf([
      historySample(WINDOW.startMs + 1_000, 92, { heaterActive: true }),
      historySample(WINDOW.startMs + 2_000, 92, { heaterActive: true }),
      historySample(WINDOW.startMs + 3_000, 92, { heaterActive: false }),
      historySample(WINDOW.startMs + 4_000, 92, { heaterActive: true }),
      historySample(
        WINDOW.startMs + 4_000 + HISTORY_GAP_THRESHOLD_MS + 1_000,
        92,
        { heaterActive: true },
      ),
    ]);
    expect(plot.heaterRects).toHaveLength(3);
    for (const rect of plot.heaterRects) {
      expect(rect.width).toBeGreaterThanOrEqual(2);
    }
    expect(plot.pumpRects).toEqual([]);
  });

  test("extends a run that ends on the last sample", () => {
    const plot = historyPlotOf([
      historySample(WINDOW.startMs + 1_000, 92, { heaterActive: true }),
    ]);
    expect(plot.heaterRects).toHaveLength(1);
    expect(plot.heaterRects[0].width).toBe(2);
  });
});

describe("plot helpers", () => {
  test("splits on the predicate and keeps every sample exactly once", () => {
    const segments = splitContinuous([1, 2, 3, 4], (value) => value === 3);
    expect(segments).toEqual([[1, 2], [3, 4]]);
    expect(splitContinuous([], () => true)).toEqual([]);
  });

  test("writes one move command followed by line commands", () => {
    expect(
      linePath([1, 2, 3], (value) => value, (value) => value * 2),
    ).toBe("M 1.00 2.00 L 2.00 4.00 L 3.00 6.00");
    expect(linePath([], (value: number) => value, (value) => value)).toBe("");
  });

  test("does not report activity when no sample is active", () => {
    expect(
      activityRects(
        [historySample(WINDOW.startMs + 1_000, 92)],
        (recordedAtMs) => recordedAtMs,
        () => false,
      ),
    ).toEqual([]);
  });
});

function plotOf(
  samples: StoredWeightedTraceSample[],
  cutoffDecigrams?: number,
) {
  const trace: StoredWeightedShotTrace = {
    bootId: "0123456789abcdef0123456789abcdef",
    completeness: "live",
    deviceId: "machine-1",
    extractionId: "run-1",
    samples,
  };
  return weightedTracePlot({ cutoffDecigrams, height: 330, trace, width: 400 });
}

function historyPlotOf(samples: TemperatureHistorySample[]) {
  return temperatureHistoryPlot({
    bandCount: 1,
    height: 190,
    samples,
    width: 400,
    window: WINDOW,
  });
}

function traceSample(
  overrides: Partial<StoredWeightedTraceSample> & { elapsedMs: number },
): StoredWeightedTraceSample {
  return {
    activeTargetC: 93,
    boilerTemperatureC: 92.5,
    derivedFlowGPerS: 1.5,
    gapStatus: "continuous",
    netWeightDecigrams: 120,
    phase: "main-extraction",
    pumpCommand: "running",
    scaleAvailability: "ready",
    sequence: Math.round(overrides.elapsedMs / 250) + 1,
    uptimeMs: 500_000 + overrides.elapsedMs,
    ...overrides,
  };
}

function historySample(
  recordedAtMs: number,
  boilerTemperatureC: number,
  overrides: Partial<TemperatureHistorySample> = {},
): TemperatureHistorySample {
  return {
    activeMode: "brew",
    activeTargetC: 93,
    boilerTemperatureC,
    brewTargetC: 93,
    deviceId: "machine-1",
    faultCode: null,
    heaterActive: false,
    heaterEnabled: true,
    machineStatus: "ready",
    predictiveTemperature: null,
    pumpActive: false,
    recordedAtMs,
    sourceBootId: null,
    sourceSequence: null,
    startsAfterHistoryGap: false,
    steamTargetC: 115,
    uptimeMs: 100_000 + (recordedAtMs - WINDOW.startMs),
    ...overrides,
  };
}
