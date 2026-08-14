import { describe, expect, test } from "bun:test";
import type {
  ExtractionState,
  ScaleState,
} from "@philcoino/protocol";

import { extractionConsoleReadouts } from "../src/dashboard/extraction-console-model";
import type { StoredExtractionTrace } from "../src/history/extraction-trace";

describe("extraction console live weight", () => {
  test("shows gross scale weight before automatic tare", () => {
    const readouts = extractionConsoleReadouts({
      extraction: null,
      scale: scaleState({
        grossWeightDecigrams: 1260,
        netWeightDecigrams: null,
      }),
      snapshot: null,
      trace: null,
    });

    expect(readouts.weight).toBe("126.0 g");
  });

  test("prefers the newest 4 Hz SSE weight while extraction is running", () => {
    const readouts = extractionConsoleReadouts({
      extraction: runningExtraction(),
      scale: scaleState({
        activeExtraction: {
          compensationDecigrams: 20,
          cutoffWeightDecigrams: 330,
          extractionId: "shot-1",
          mode: "weight",
          netWeightDecigrams: 100,
          targetWeightDecigrams: 350,
        },
        grossWeightDecigrams: 900,
        netWeightDecigrams: 100,
      }),
      snapshot: null,
      trace: liveTrace(140),
    });

    expect(readouts.weight).toBe("14.0 g");
  });

  test("falls back to acknowledged state until the first SSE sample arrives", () => {
    const readouts = extractionConsoleReadouts({
      extraction: runningExtraction(),
      scale: scaleState({
        activeExtraction: {
          compensationDecigrams: 20,
          cutoffWeightDecigrams: 330,
          extractionId: "shot-1",
          mode: "weight",
          netWeightDecigrams: 75,
          targetWeightDecigrams: 350,
        },
        netWeightDecigrams: 75,
      }),
      snapshot: null,
      trace: null,
    });

    expect(readouts.weight).toBe("7.5 g");
  });
});

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

function runningExtraction(): ExtractionState {
  return {
    elapsedMs: 1000,
    extractionId: "shot-1",
    phase: "main-extraction",
    pumpCommand: "running",
    remainingMs: 20_000,
    selection: {
      kind: "profile",
      profile: {
        mainExtractionSeconds: 20,
        name: "Test",
        preInfusionSeconds: 2,
        soakSeconds: 1,
      },
      profileId: "profile-1",
    },
    status: "running",
  };
}

function liveTrace(netWeightDecigrams: number): StoredExtractionTrace {
  return {
    bootId: "0".repeat(32),
    completeness: "live",
    deviceId: "machine-1",
    extractionId: "shot-1",
    samples: [{
      activeTargetC: 93,
      boilerTemperatureC: 92,
      derivedFlowGPerS: 1.2,
      elapsedMs: 1000,
      extractionElapsedMs: 1000,
      gapStatus: "continuous",
      heaterActive: false,
      netWeightDecigrams,
      phase: "main-extraction",
      pumpCommand: "running",
      scaleAvailability: "ready",
      sequence: 4,
      uptimeMs: 5000,
    }],
  };
}
