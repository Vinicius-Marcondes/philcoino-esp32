import { describe, expect, test } from "bun:test";
import type { ScaleState } from "@philcoino/protocol";

import {
  currentScaleWeightDecigrams,
  formatElapsedReadout,
  formatFlowReadout,
  formatTemperatureReadout,
  formatWeightReadout,
  nearestHistorySample,
  nearestTraceSampleIndex,
  UNAVAILABLE_READOUT,
} from "../src/telemetry/telemetry-readouts";

describe("telemetry readouts", () => {
  test("prefers net weight, falls back to gross, and keeps a real zero", () => {
    expect(
      currentScaleWeightDecigrams(
        scaleState({ grossWeightDecigrams: 900, netWeightDecigrams: 180 }),
      ),
    ).toBe(180);
    expect(
      currentScaleWeightDecigrams(
        scaleState({ grossWeightDecigrams: 900, netWeightDecigrams: null }),
      ),
    ).toBe(900);
    expect(
      currentScaleWeightDecigrams(
        scaleState({ grossWeightDecigrams: 900, netWeightDecigrams: 0 }),
      ),
    ).toBe(0);
    expect(
      currentScaleWeightDecigrams(
        scaleState({ grossWeightDecigrams: null, netWeightDecigrams: null }),
      ),
    ).toBeNull();
    expect(currentScaleWeightDecigrams(null)).toBeNull();
  });

  test("marks every missing value unavailable instead of showing a zero", () => {
    expect(formatWeightReadout(null)).toBe(UNAVAILABLE_READOUT);
    expect(formatFlowReadout(null)).toBe(UNAVAILABLE_READOUT);
    expect(formatTemperatureReadout(null)).toBe(UNAVAILABLE_READOUT);
    expect(formatElapsedReadout(null)).toBe(UNAVAILABLE_READOUT);
  });

  test("formats values with the units the instrument panel uses", () => {
    expect(formatWeightReadout(184)).toBe("18.4 g");
    expect(formatWeightReadout(0)).toBe("0.0 g");
    expect(formatFlowReadout(1.234)).toBe("1.2 g/s");
    expect(formatFlowReadout(1.234, 2)).toBe("1.23 g/s");
    expect(formatTemperatureReadout(92.45)).toBe("92.5°");
    expect(formatTemperatureReadout(92.45, " °C")).toBe("92.5 °C");
    expect(formatElapsedReadout(25_400)).toBe("25.4 s");
    expect(formatElapsedReadout(25_400, 2)).toBe("25.40 s");
  });

  test("finds the nearest trace sample and clamps outside the range", () => {
    const samples = [0, 250, 500, 750, 1_000].map((elapsedMs) => ({
      elapsedMs,
    }));
    expect(nearestTraceSampleIndex(samples, -100)).toBe(0);
    expect(nearestTraceSampleIndex(samples, 0)).toBe(0);
    expect(nearestTraceSampleIndex(samples, 260)).toBe(1);
    expect(nearestTraceSampleIndex(samples, 700)).toBe(3);
    expect(nearestTraceSampleIndex(samples, 5_000)).toBe(4);
    expect(nearestTraceSampleIndex([], 100)).toBeNull();
  });

  test("resolves an exact tie to the earlier sample", () => {
    const samples = [{ elapsedMs: 0 }, { elapsedMs: 100 }];
    expect(nearestTraceSampleIndex(samples, 50)).toBe(0);
  });

  test("matches a linear scan over irregular monotonic samples", () => {
    const samples: { elapsedMs: number }[] = [];
    let elapsedMs = 0;
    for (let index = 0; index < 200; index += 1) {
      elapsedMs += 1 + ((index * 37) % 11);
      samples.push({ elapsedMs });
    }
    for (let target = -5; target <= elapsedMs + 5; target += 3) {
      expect(nearestTraceSampleIndex(samples, target)).toBe(
        linearNearestIndex(samples, target),
      );
    }
  });

  test("finds the nearest history sample by timestamp", () => {
    const samples = [1_000, 2_000, 3_000].map((recordedAtMs) => ({
      ...historySample(),
      recordedAtMs,
    }));
    expect(nearestHistorySample(samples, 2_400)?.recordedAtMs).toBe(2_000);
    expect(nearestHistorySample(samples, 2_600)?.recordedAtMs).toBe(3_000);
    expect(nearestHistorySample([], 2_000)).toBeNull();
  });
});

function linearNearestIndex(
  samples: { elapsedMs: number }[],
  target: number,
): number {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  samples.forEach((sample, index) => {
    const candidate = Math.abs(sample.elapsedMs - target);
    if (candidate < distance) {
      distance = candidate;
      nearest = index;
    }
  });
  return nearest;
}

function scaleState(overrides: Partial<ScaleState>): ScaleState {
  return {
    activeExtraction: null,
    availability: "ready",
    calibrationStatus: "calibrated",
    grossWeightDecigrams: null,
    netWeightDecigrams: null,
    stable: true,
    terminalExtraction: null,
    warning: null,
    ...overrides,
  };
}

function historySample() {
  return {
    activeMode: "brew" as const,
    activeTargetC: 93,
    boilerTemperatureC: 92,
    brewTargetC: 93,
    deviceId: "machine-1",
    faultCode: null,
    heaterActive: false,
    heaterEnabled: true,
    machineStatus: "ready" as const,
    predictiveTemperature: null,
    pumpActive: false,
    recordedAtMs: 0,
    sourceBootId: null,
    sourceSequence: null,
    startsAfterHistoryGap: false,
    steamTargetC: 115,
    uptimeMs: 1_000,
  };
}
