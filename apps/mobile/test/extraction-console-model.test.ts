import { describe, expect, test } from "bun:test";
import type {
  ExtractionState,
  MachineState,
  ScaleState,
} from "@philcoino/protocol";

import {
  extractionConsoleReadouts,
  extractionConsoleTrace,
} from "../src/dashboard/extraction-console-model";
import type {
  StoredWeightedShotTrace,
  StoredWeightedTraceSample,
} from "../src/history/weighted-shot-trace";

describe("extraction console trace selection", () => {
  test("holds a finished trace for review", () => {
    const trace = traceOf("run-1", [sample({ elapsedMs: 25_000 })]);
    expect(extractionConsoleTrace(trace, idle)).toBe(trace);
    expect(extractionConsoleTrace(trace, null)).toBe(trace);
  });

  test("drops a trace that belongs to a previous extraction", () => {
    const trace = traceOf("run-1", [sample({ elapsedMs: 25_000 })]);
    expect(extractionConsoleTrace(trace, running("run-2"))).toBeNull();
    expect(extractionConsoleTrace(trace, running("run-1"))).toBe(trace);
    expect(extractionConsoleTrace(null, running("run-1"))).toBeNull();
  });
});

describe("extraction console readouts", () => {
  test("prefers live machine and scale state while a shot runs", () => {
    const readouts = extractionConsoleReadouts({
      extraction: running("run-1", 12_500),
      scale: scaleState({
        activeExtraction: {
          compensationDecigrams: 10,
          cutoffWeightDecigrams: 350,
          extractionId: "run-1",
          mode: "weight",
          netWeightDecigrams: 214,
          targetWeightDecigrams: 360,
        },
        netWeightDecigrams: 214,
      }),
      snapshot: machineState({ boilerTemperatureC: 92.8 }),
      trace: traceOf("run-1", [
        sample({ derivedFlowGPerS: 1.84, elapsedMs: 12_250, netWeightDecigrams: 205 }),
      ]),
    });
    expect(readouts).toMatchObject({
      elapsed: "12.5 s",
      flow: "1.8 g/s",
      phase: "main-extraction",
      pumpRunning: true,
      running: true,
      target: "93.0°",
      temperature: "92.8°",
      weight: "21.4 g",
    });
  });

  test("reads the held trace between shots", () => {
    const readouts = extractionConsoleReadouts({
      extraction: idle,
      scale: scaleState({ netWeightDecigrams: null }),
      snapshot: null,
      trace: traceOf("run-1", [
        sample({ derivedFlowGPerS: 0.4, elapsedMs: 27_000, netWeightDecigrams: 361 }),
      ]),
    });
    expect(readouts.elapsed).toBe("27.0 s");
    expect(readouts.weight).toBe("36.1 g");
    expect(readouts.running).toBe(false);
    expect(readouts.pumpRunning).toBe(false);
  });

  test("never synthesizes a value the machine has not reported", () => {
    const readouts = extractionConsoleReadouts({
      extraction: null,
      scale: null,
      snapshot: null,
      trace: null,
    });
    expect(readouts).toMatchObject({
      elapsed: "—",
      flow: "—",
      phase: null,
      target: "—",
      temperature: "—",
      weight: "—",
    });
  });

  test("marks flow unavailable while the trace has not derived it yet", () => {
    const readouts = extractionConsoleReadouts({
      extraction: running("run-1", 500),
      scale: scaleState({ netWeightDecigrams: 0 }),
      snapshot: machineState({}),
      trace: traceOf("run-1", [
        sample({ derivedFlowGPerS: null, elapsedMs: 250, netWeightDecigrams: 0 }),
      ]),
    });
    expect(readouts.flow).toBe("—");
    expect(readouts.weight).toBe("0.0 g");
  });
});

const idle: ExtractionState = {
  elapsedMs: 0,
  extractionId: null,
  phase: "idle",
  pumpCommand: "off",
  remainingMs: null,
  selection: null,
  status: "idle",
};

function running(extractionId: string, elapsedMs = 5_000): ExtractionState {
  return {
    elapsedMs,
    extractionId,
    phase: "main-extraction",
    pumpCommand: "running",
    remainingMs: 20_000,
    selection: { kind: "profile", profileId: "profile-1" },
    status: "running",
  };
}

function traceOf(
  extractionId: string,
  samples: StoredWeightedTraceSample[],
): StoredWeightedShotTrace {
  return {
    bootId: "0123456789abcdef0123456789abcdef",
    completeness: "live",
    deviceId: "machine-1",
    extractionId,
    samples,
  };
}

function sample(
  overrides: Partial<StoredWeightedTraceSample>,
): StoredWeightedTraceSample {
  return {
    activeTargetC: 93,
    boilerTemperatureC: 92.5,
    derivedFlowGPerS: 1.5,
    elapsedMs: 0,
    gapStatus: "continuous",
    netWeightDecigrams: 120,
    phase: "main-extraction",
    pumpCommand: "running",
    scaleAvailability: "ready",
    sequence: 1,
    uptimeMs: 500_000,
    ...overrides,
  };
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

function machineState({
  boilerTemperatureC = 92,
  brewTargetC = 93,
}: {
  boilerTemperatureC?: number;
  brewTargetC?: number;
}): MachineState {
  return {
    activeMode: "brew",
    boilerTemperatureC,
    brewTargetC,
    fault: null,
    heaterActive: true,
    heaterEnabled: true,
    status: "ready",
    steamTargetC: 115,
    steamTimeoutRemainingMs: null,
    steamControl: {
      settings: {
        initialCompensationC: 12,
        decayDurationMs: 720_000,
        readyTimeoutMs: 300_000,
      },
      compensationActive: false,
      appliedCompensationC: 0,
      controlTemperatureC: null,
      heatSoakElapsedMs: null,
    },
    uptimeMs: 500_000,
  };
}
