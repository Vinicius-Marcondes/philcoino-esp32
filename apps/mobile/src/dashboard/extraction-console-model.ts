import type {
  ExtractionPhase,
  ExtractionTelemetryPhase,
  ExtractionState,
  MachineState,
  ScaleState,
} from "@philcoino/protocol";

import type { StoredExtractionTrace } from "../history/extraction-trace";
import {
  currentScaleWeightDecigrams,
  formatElapsedReadout,
  formatFlowReadout,
  formatTemperatureReadout,
  formatWeightReadout,
} from "../telemetry/telemetry-readouts";

export type ExtractionConsolePhase =
  | ExtractionPhase
  | ExtractionTelemetryPhase;

export interface ExtractionConsoleReadouts {
  elapsed: string;
  flow: string;
  /** Null while no extraction has reported a phase; the screen localizes it. */
  phase: ExtractionConsolePhase | null;
  pumpRunning: boolean;
  running: boolean;
  target: string;
  temperature: string;
  steamTemperature: string;
  weight: string;
}

/**
 * The trace worth plotting. A finished trace is held for review, but a trace that
 * belongs to a previous extraction is dropped as soon as another one runs, so the
 * console never mixes two shots on one time axis.
 */
export function extractionConsoleTrace(
  trace: StoredExtractionTrace | null,
  extraction: ExtractionState | null,
): StoredExtractionTrace | null {
  if (trace === null) return null;
  if (
    extraction?.status === "running" &&
    extraction.extractionId !== trace.extractionId
  ) {
    return null;
  }
  return trace;
}

export function extractionConsoleReadouts({
  extraction,
  scale,
  snapshot,
  trace,
}: {
  extraction: ExtractionState | null;
  scale: ScaleState | null;
  snapshot: MachineState | null;
  trace: StoredExtractionTrace | null;
}): ExtractionConsoleReadouts {
  const running = extraction?.status === "running";
  const latest = trace?.samples.at(-1) ?? null;
  const elapsedMs = running
    ? extraction.elapsedMs
    : (latest?.elapsedMs ?? extraction?.elapsedMs ?? null);
  const temperatureC = snapshot?.boilerTemperatureC ?? latest?.boilerTemperatureC ?? null;
  const steamTemperatureC = snapshot?.steamTemperatureC ?? latest?.steamTemperatureC ?? null;
  const targetC = snapshot === null ? (latest?.activeTargetC ?? null) : snapshot.brewTargetC;
  const weightDecigrams =
    running
      ? latest?.netWeightDecigrams ??
        scale?.activeExtraction?.netWeightDecigrams ??
        currentScaleWeightDecigrams(scale)
      : currentScaleWeightDecigrams(scale) ??
        latest?.netWeightDecigrams ??
        null;
  return {
    elapsed: formatElapsedReadout(elapsedMs),
    flow: formatFlowReadout(latest?.derivedFlowGPerS ?? null),
    phase: running ? extraction.phase : (latest?.phase ?? null),
    pumpRunning: extraction?.pumpCommand === "running",
    running,
    target: formatTemperatureReadout(targetC),
    temperature: formatTemperatureReadout(temperatureC),
    steamTemperature: formatTemperatureReadout(steamTemperatureC),
    weight: formatWeightReadout(weightDecigrams),
  };
}
