import type {
  ExtractionOutcome,
  ExtractionSelection,
  ExtractionTelemetryControlMode,
  ExtractionTelemetryPage,
  ExtractionTelemetryPhase,
  ExtractionTelemetrySample,
  PumpCommand,
  ScaleAvailability,
  TerminalWeightExtraction,
  WeightControl,
} from "@philcoino/protocol";

import type {
  TraceCompleteness,
  TraceGapStatus,
} from "./weighted-shot-trace";

export interface StoredExtractionTraceSample {
  activeTargetC: number;
  boilerTemperatureC: number;
  derivedFlowGPerS: number | null;
  elapsedMs: number;
  extractionElapsedMs?: number;
  gapStatus: TraceGapStatus;
  heaterActive?: boolean;
  netWeightDecigrams: number | null;
  phase: ExtractionTelemetryPhase;
  pumpCommand: PumpCommand;
  scaleAvailability: ScaleAvailability;
  sequence: number;
  uptimeMs: number;
}

export interface StoredExtractionTrace {
  baselineWeightDecigrams?: number | null;
  bootId: string;
  completeness: TraceCompleteness;
  controlMode?: ExtractionTelemetryControlMode;
  deviceId: string;
  extractionId: string;
  outcome?: ExtractionOutcome | null;
  samples: StoredExtractionTraceSample[];
  selection?: ExtractionSelection;
  terminalWeight?: TerminalWeightExtraction | null;
  weightControl?: WeightControl | null;
}

export function mergeExtractionTracePage(
  previous: StoredExtractionTrace | null,
  deviceId: string,
  page: ExtractionTelemetryPage,
): StoredExtractionTrace {
  const sameTrace =
    previous?.deviceId === deviceId &&
    previous.extractionId === page.extractionId &&
    previous.bootId === page.bootId &&
    !page.samples.some((sample) => {
      const retained = previous.samples.find(
        (candidate) => candidate.sequence === sample.sequence,
      );
      return retained !== undefined && retained.uptimeMs !== sample.uptimeMs;
    });
  const samples = new Map<
    number,
    ExtractionTelemetrySample | StoredExtractionTraceSample
  >();
  if (sameTrace) {
    for (const sample of previous.samples) {
      if (sample.sequence <= page.latestSequence) {
        samples.set(sample.sequence, {
          ...sample,
          extractionElapsedMs: sample.extractionElapsedMs ?? sample.elapsedMs,
        });
      }
    }
  }
  for (const sample of page.samples) samples.set(sample.sequence, sample);
  const ordered = [...samples.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const partial =
    page.continuity === "truncated" ||
    page.continuity === "reset" ||
    ordered.some(
      (sample, index) =>
        index > 0 && sample.sequence !== ordered[index - 1].sequence + 1,
    );
  return {
    baselineWeightDecigrams: page.baselineWeightDecigrams,
    bootId: page.bootId,
    completeness:
      page.status !== "terminal" ? "live" : partial ? "partial" : "complete",
    controlMode: page.controlMode,
    deviceId,
    extractionId: page.extractionId,
    outcome: page.outcome,
    samples: deriveExtractionFlow(ordered),
    selection: page.selection,
    terminalWeight: page.terminalWeight,
    weightControl: page.weightControl,
  };
}

export function deriveExtractionFlow(
  samples: (ExtractionTelemetrySample | StoredExtractionTraceSample)[],
): StoredExtractionTraceSample[] {
  const output: StoredExtractionTraceSample[] = [];
  let segment: (ExtractionTelemetrySample | StoredExtractionTraceSample)[] = [];
  for (const sample of samples) {
    const previous = segment.at(-1);
    const discontinuity =
      previous !== undefined &&
      (sample.sequence !== previous.sequence + 1 ||
        sample.uptimeMs <= previous.uptimeMs ||
        sample.scaleAvailability !== previous.scaleAvailability);
    if (
      discontinuity ||
      sample.netWeightDecigrams === null ||
      sample.scaleAvailability === "unavailable"
    ) {
      segment = [];
    }
    if (
      sample.netWeightDecigrams !== null &&
      sample.scaleAvailability !== "unavailable"
    ) {
      segment.push(sample);
      segment = segment.filter(
        (candidate) => sample.uptimeMs - candidate.uptimeMs <= 1_000,
      );
    }
    let flow: number | null = null;
    let gapStatus: TraceGapStatus =
      discontinuity || sample.netWeightDecigrams === null ? "gap" : "continuous";
    if (
      segment.length >= 3 &&
      segment.at(-1)!.uptimeMs - segment[0].uptimeMs >= 500
    ) {
      flow = regressionSlope(segment);
      if (flow < 0 && flow >= -0.35) flow = 0;
      if (flow < -0.35) {
        flow = null;
        gapStatus = "gap";
        segment = [sample];
      }
    }
    output.push({ ...sample, derivedFlowGPerS: flow, gapStatus });
  }
  return output;
}

function regressionSlope(
  samples: (ExtractionTelemetrySample | StoredExtractionTraceSample)[],
): number {
  const origin = samples[0].uptimeMs;
  const points = samples.map((sample) => ({
    time: (sample.uptimeMs - origin) / 1_000,
    weight: sample.netWeightDecigrams! / 10,
  }));
  const meanTime =
    points.reduce((sum, point) => sum + point.time, 0) / points.length;
  const meanWeight =
    points.reduce((sum, point) => sum + point.weight, 0) / points.length;
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    numerator += (point.time - meanTime) * (point.weight - meanWeight);
    denominator += (point.time - meanTime) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

export function extractionTraceToCsv(trace: StoredExtractionTrace): string {
  const rows = [
    [
      "elapsed_ms",
      "extraction_elapsed_ms",
      "firmware_uptime_ms",
      "control_mode",
      "selection",
      "temperature_c",
      "target_c",
      "baseline_weight_g",
      "weight_g",
      "target_weight_g",
      "compensation_g",
      "cutoff_weight_g",
      "terminal_weight_g",
      "terminal_settled",
      "weight_completion_reason",
      "weight_fallback_occurred",
      "derived_flow_g_per_s",
      "phase",
      "heater_command",
      "pump_command",
      "scale_availability",
      "gap_status",
    ].join(","),
  ];
  for (const sample of trace.samples) {
    rows.push(
      [
        sample.elapsedMs,
        sample.extractionElapsedMs ?? sample.elapsedMs,
        sample.uptimeMs,
        trace.controlMode ?? "",
        trace.selection?.kind === "manual"
          ? "manual"
          : trace.selection?.profileId ?? "",
        sample.boilerTemperatureC,
        sample.activeTargetC,
        nullableDecigrams(trace.baselineWeightDecigrams ?? null),
        sample.netWeightDecigrams === null
          ? ""
          : (sample.netWeightDecigrams / 10).toFixed(1),
        nullableDecigrams(trace.weightControl?.targetWeightDecigrams ?? null),
        nullableDecigrams(
          trace.weightControl?.compensationDecigrams ?? null,
        ),
        trace.weightControl === null || trace.weightControl === undefined
          ? ""
          : nullableDecigrams(
              trace.weightControl.targetWeightDecigrams -
                trace.weightControl.compensationDecigrams,
            ),
        nullableDecigrams(trace.terminalWeight?.finalWeightDecigrams ?? null),
        trace.terminalWeight?.settled ?? "",
        trace.terminalWeight?.completionReason ?? "",
        trace.terminalWeight?.fallbackOccurred ?? "",
        sample.derivedFlowGPerS === null
          ? ""
          : sample.derivedFlowGPerS.toFixed(2),
        sample.phase,
        sample.heaterActive === undefined
          ? ""
          : sample.heaterActive
            ? "on"
            : "off",
        sample.pumpCommand,
        sample.scaleAvailability,
        sample.gapStatus,
      ].join(","),
    );
  }
  return `${rows.join("\r\n")}\r\n`;
}

function nullableDecigrams(value: number | null): string {
  return value === null ? "" : (value / 10).toFixed(1);
}
