import type {
  ProfileSlotId,
  ScaleCompletionReason,
  TerminalWeightExtraction,
} from "@philcoino/protocol";

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
  samples: WeightedShotSummary[],
): string {
  const rows = [HEADERS.join(",")];
  for (const sample of samples) {
    rows.push(
      [
        new Date(sample.recordedAtMs).toISOString(),
        sample.deviceId,
        sample.extractionId,
        sample.profileId,
        decigrams(sample.targetDecigrams),
        decigrams(sample.compensationDecigrams),
        decigrams(sample.cutoffDecigrams),
        sample.finalWeightDecigrams === null
          ? ""
          : decigrams(sample.finalWeightDecigrams),
        sample.settled,
        sample.durationMs ?? "",
        sample.outcome,
        sample.fallbackOccurred,
      ].join(","),
    );
  }
  return `${rows.join("\r\n")}\r\n`;
}

function decigrams(value: number): string {
  return (value / 10).toFixed(1);
}
