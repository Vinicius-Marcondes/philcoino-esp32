import type {
  ProfileSlotId,
  ExtractionOutcome,
  ExtractionSelection,
  ExtractionTelemetryControlMode,
  ExtractionTelemetryPage,
  ExtractionState,
  WeightControl,
  ScaleCompletionReason,
  TerminalWeightExtraction,
} from "@philcoino/protocol";
import type { TraceCompleteness } from "./extraction-trace";

export interface WeightedShotSummary {
  compensationDecigrams: number;
  cutoffDecigrams: number;
  deviceId: string;
  durationMs: number | null;
  extractionId: string;
  fallbackOccurred: boolean;
  finalWeightDecigrams: number | null;
  outcome: ScaleCompletionReason;
  profileId: ProfileSlotId;
  recordedAtMs: number;
  settled: boolean;
  targetDecigrams: number;
  traceCompleteness?: TraceCompleteness | null;
  traceSampleCount?: number;
}

export interface ExtractionSummary {
  bootId: string | null;
  compensationDecigrams: number | null;
  controlMode: ExtractionTelemetryControlMode;
  cutoffDecigrams: number | null;
  deviceId: string;
  durationMs: number | null;
  extractionId: string;
  fallbackOccurred: boolean | null;
  finalWeightDecigrams: number | null;
  outcome: ExtractionOutcome | null;
  profileId: ProfileSlotId | null;
  recordedAtMs: number;
  recordStatus?: "running" | "complete" | "incomplete";
  selection: ExtractionSelection;
  settled: boolean | null;
  targetDecigrams: number | null;
  traceCompleteness?: TraceCompleteness | null;
  traceSampleCount?: number;
}

export function extractionSummaryFromPage(
  deviceId: string,
  page: ExtractionTelemetryPage,
  recordedAtMs = Date.now(),
): ExtractionSummary {
  if (page.status !== "terminal" || page.outcome === null) {
    throw new TypeError("Only terminal extraction telemetry can be summarized.");
  }
  const terminal = page.terminalWeight;
  return {
    bootId: page.bootId,
    compensationDecigrams: terminal?.compensationDecigrams ?? null,
    controlMode: page.controlMode,
    cutoffDecigrams: terminal?.cutoffWeightDecigrams ?? null,
    deviceId,
    durationMs: page.samples.at(-1)?.extractionElapsedMs ?? null,
    extractionId: page.extractionId,
    fallbackOccurred: terminal?.fallbackOccurred ?? null,
    finalWeightDecigrams:
      terminal?.finalWeightDecigrams ??
      page.samples.at(-1)?.netWeightDecigrams ??
      null,
    outcome: page.outcome,
    profileId: page.selection.kind === "profile" ? page.selection.profileId : null,
    recordedAtMs,
    recordStatus: "complete",
    selection: page.selection,
    settled: terminal?.settled ?? null,
    targetDecigrams: terminal?.targetWeightDecigrams ?? null,
    traceCompleteness: null,
    traceSampleCount: page.latestSequence - page.oldestSequence + 1,
  };
}

export function extractionSummaryFromState(
  deviceId: string,
  extraction: ExtractionState,
  weightControl?: WeightControl,
  recordedAtMs = Date.now(),
): ExtractionSummary {
  if (extraction.extractionId === null || extraction.selection === null) {
    throw new TypeError("An identified extraction is required.");
  }
  const weighted =
    extraction.selection.kind === "profile" && weightControl !== undefined;
  return {
    bootId: null,
    compensationDecigrams: weightControl?.compensationDecigrams ?? null,
    controlMode:
      extraction.selection.kind === "manual"
        ? "manual"
        : weighted ? "weight" : "timed",
    cutoffDecigrams: weightControl === undefined
      ? null
      : weightControl.targetWeightDecigrams - weightControl.compensationDecigrams,
    deviceId,
    durationMs: extraction.elapsedMs,
    extractionId: extraction.extractionId,
    fallbackOccurred: null,
    finalWeightDecigrams: null,
    outcome: extraction.status === "idle" ? extraction.outcome : null,
    profileId:
      extraction.selection.kind === "profile"
        ? extraction.selection.profileId
        : null,
    recordedAtMs,
    // A retained terminal state proves the outcome, but the record remains
    // incomplete until the replay stream supplies the terminal trace page.
    recordStatus: extraction.status === "running" ? "running" : "incomplete",
    selection: extraction.selection,
    settled: null,
    targetDecigrams: weightControl?.targetWeightDecigrams ?? null,
    traceCompleteness: null,
    traceSampleCount: 0,
  };
}

export function shotSummaryFromTerminal(
  deviceId: string,
  profileId: ProfileSlotId,
  terminal: TerminalWeightExtraction,
  durationMs: number | null,
  recordedAtMs = Date.now(),
): WeightedShotSummary {
  return {
    compensationDecigrams: terminal.compensationDecigrams,
    cutoffDecigrams: terminal.cutoffWeightDecigrams,
    deviceId,
    durationMs,
    extractionId: terminal.extractionId,
    fallbackOccurred: terminal.fallbackOccurred,
    finalWeightDecigrams: terminal.finalWeightDecigrams,
    outcome: terminal.completionReason,
    profileId,
    recordedAtMs,
    settled: terminal.settled,
    targetDecigrams: terminal.targetWeightDecigrams,
    traceCompleteness: null,
    traceSampleCount: 0,
  };
}

const HEADERS = [
  "timestamp_utc",
  "device_id",
  "extraction_id",
  "profile_id",
  "target_g",
  "compensation_g",
  "cutoff_g",
  "final_weight_g",
  "settled",
  "duration_ms",
  "outcome",
  "fallback_occurred",
] as const;

export function weightedShotHistoryToCsv(
  samples: (WeightedShotSummary | ExtractionSummary)[],
): string {
  const rows = [HEADERS.join(",")];
  for (const sample of samples) {
    rows.push(
      [
        new Date(sample.recordedAtMs).toISOString(),
        sample.deviceId,
        sample.extractionId,
        sample.profileId ?? "",
        nullableDecigrams(sample.targetDecigrams),
        nullableDecigrams(sample.compensationDecigrams),
        nullableDecigrams(sample.cutoffDecigrams),
        sample.finalWeightDecigrams === null
          ? ""
          : decigrams(sample.finalWeightDecigrams),
        sample.settled,
        sample.durationMs ?? "",
        sample.outcome ?? "incomplete",
        sample.fallbackOccurred,
      ].join(","),
    );
  }
  return `${rows.join("\r\n")}\r\n`;
}

export function extractionHistoryToCsv(samples: ExtractionSummary[]): string {
  const headers = [
    "timestamp_utc",
    "device_id",
    "extraction_id",
    "boot_id",
    "control_mode",
    "selection",
    "profile_name",
    "pre_infusion_seconds",
    "soak_seconds",
    "main_extraction_seconds",
    "duration_ms",
    "outcome",
    "record_status",
    "trace_completeness",
    "trace_sample_count",
    "target_g",
    "compensation_g",
    "cutoff_g",
    "final_weight_g",
    "settled",
    "fallback_occurred",
  ];
  const rows = samples.map((sample) =>
    [
      new Date(sample.recordedAtMs).toISOString(),
      sample.deviceId,
      sample.extractionId,
      sample.bootId ?? "",
      sample.controlMode,
      sample.selection.kind === "manual" ? "manual" : sample.selection.profileId,
      sample.selection.kind === "profile" ? sample.selection.profile.name : "",
      sample.selection.kind === "profile"
        ? sample.selection.profile.preInfusionSeconds
        : "",
      sample.selection.kind === "profile" ? sample.selection.profile.soakSeconds : "",
      sample.selection.kind === "profile"
        ? sample.selection.profile.mainExtractionSeconds
        : "",
      sample.durationMs ?? "",
      sample.outcome ?? sample.recordStatus ?? "incomplete",
      sample.recordStatus ?? (sample.outcome === null ? "incomplete" : "complete"),
      sample.traceCompleteness ?? "",
      sample.traceSampleCount ?? 0,
      nullableDecigrams(sample.targetDecigrams),
      nullableDecigrams(sample.compensationDecigrams),
      nullableDecigrams(sample.cutoffDecigrams),
      nullableDecigrams(sample.finalWeightDecigrams),
      sample.settled ?? "",
      sample.fallbackOccurred ?? "",
    ].join(","),
  );
  return `${[headers.join(","), ...rows].join("\r\n")}\r\n`;
}

function nullableDecigrams(value: number | null): string {
  return value === null ? "" : decigrams(value);
}

function decigrams(value: number): string {
  return (value / 10).toFixed(1);
}
