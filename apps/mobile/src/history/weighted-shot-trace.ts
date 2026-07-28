import type {
  WeightedExtractionTracePage,
  WeightedExtractionTraceSample,
} from "@philcoino/protocol";

export type TraceCompleteness = "complete" | "live" | "partial";
export type TraceGapStatus = "continuous" | "gap";

export interface StoredWeightedTraceSample
  extends WeightedExtractionTraceSample {
  derivedFlowGPerS: number | null;
  gapStatus: TraceGapStatus;
}

export interface StoredWeightedShotTrace {
  bootId: string;
  completeness: TraceCompleteness;
  deviceId: string;
  extractionId: string;
  samples: StoredWeightedTraceSample[];
}

export function mergeTracePage(
  previous: StoredWeightedShotTrace | null,
  deviceId: string,
  page: WeightedExtractionTracePage,
): StoredWeightedShotTrace {
  const sameTrace =
    previous?.deviceId === deviceId &&
    previous.extractionId === page.extractionId &&
    previous.bootId === page.bootId &&
    !supersedesRetainedTrace(previous, page);
  const samples = new Map<number, WeightedExtractionTraceSample>();
  if (sameTrace) {
    for (const sample of previous.samples) {
      if (sample.sequence <= page.latestSequence) {
        samples.set(sample.sequence, sample);
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
    bootId: page.bootId,
    completeness:
      page.status !== "terminal" ? "live" : partial ? "partial" : "complete",
    deviceId,
    extractionId: page.extractionId,
    samples: deriveBeverageFlow(ordered),
  };
}

function supersedesRetainedTrace(
  previous: StoredWeightedShotTrace,
  page: WeightedExtractionTracePage,
): boolean {
  const retained = new Map(
    previous.samples.map((sample) => [sample.sequence, sample.uptimeMs]),
  );
  return page.samples.some((sample) => {
    const uptimeMs = retained.get(sample.sequence);
    return uptimeMs !== undefined && uptimeMs !== sample.uptimeMs;
  });
}

export function deriveBeverageFlow(
  samples: WeightedExtractionTraceSample[],
): StoredWeightedTraceSample[] {
  const output: StoredWeightedTraceSample[] = [];
  let segment: WeightedExtractionTraceSample[] = [];
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

function regressionSlope(samples: WeightedExtractionTraceSample[]): number {
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

export function weightedShotTraceToCsv(trace: StoredWeightedShotTrace): string {
  const headers = [
    "elapsed_ms",
    "firmware_uptime_ms",
    "temperature_c",
    "target_c",
    "weight_g",
    "derived_flow_g_per_s",
    "phase",
    "pump_command",
    "gap_status",
  ];
  const rows = trace.samples.map((sample) =>
    [
      sample.elapsedMs,
      sample.uptimeMs,
      sample.boilerTemperatureC,
      sample.activeTargetC,
      sample.netWeightDecigrams === null
        ? ""
        : (sample.netWeightDecigrams / 10).toFixed(1),
      sample.derivedFlowGPerS === null
        ? ""
        : sample.derivedFlowGPerS.toFixed(2),
      sample.phase,
      sample.pumpCommand,
      sample.gapStatus,
    ].join(","),
  );
  return `${[headers.join(","), ...rows].join("\r\n")}\r\n`;
}
