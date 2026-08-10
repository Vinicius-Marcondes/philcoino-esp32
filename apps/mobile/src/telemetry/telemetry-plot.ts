import {
  isTemperatureHistoryGap,
  temperatureHistoryGraphScale,
  type TemperatureHistorySample,
  type TemperatureHistoryWindow,
} from "../history/temperature-history";
import type { StoredExtractionTrace } from "../history/extraction-trace";
import {
  telemetryBandValueY,
  telemetryPlotFrame,
  type TelemetryBand,
  type TelemetryBandCount,
  type TelemetryPlotFrame,
} from "./telemetry-plot-frame";

const MINIMUM_TRACE_SPAN_MS = 1_000;
const TRACE_TEMPERATURE_FLOOR_C = 85;
const TRACE_TEMPERATURE_CEILING_C = 96;
const TRACE_TEMPERATURE_PADDING_C = 1;
const MINIMUM_WEIGHT_G = 10;
const MINIMUM_FLOW_G_PER_S = 2;
const ACTIVITY_MINIMUM_WIDTH = 2;

export interface ActivityRect {
  key: number;
  width: number;
  x: number;
}

export interface WeightedTracePlot extends TelemetryPlotFrame {
  cutoffY: number | null;
  flowAreas: string[];
  flowY: (value: number) => number;
  phaseBoundaries: number[];
  settlingX: number | null;
  targetPaths: string[];
  temperatureBand: TelemetryBand;
  temperaturePaths: string[];
  temperatureY: (value: number) => number;
  weightBand: TelemetryBand;
  weightPaths: string[];
  weightY: (value: number) => number;
  x: (elapsedMs: number) => number;
}

export interface TemperatureHistoryPlot extends TelemetryPlotFrame {
  heaterRects: ActivityRect[];
  targetPaths: string[];
  temperatureBand: TelemetryBand;
  temperaturePaths: string[];
  temperatureTicks: number[];
  temperatureY: (value: number) => number;
  pumpRects: ActivityRect[];
  weightBand: TelemetryBand | null;
  x: (recordedAtMs: number) => number;
}

export function weightedTracePlot({
  cutoffDecigrams,
  height,
  trace,
  width,
}: {
  cutoffDecigrams?: number | null;
  height: number;
  trace: StoredExtractionTrace;
  width: number;
}): WeightedTracePlot {
  const maxElapsed = Math.max(
    MINIMUM_TRACE_SPAN_MS,
    trace.samples.at(-1)?.elapsedMs ?? MINIMUM_TRACE_SPAN_MS,
  );
  const frame = telemetryPlotFrame({
    bandCount: 2,
    height,
    maxElapsed,
    width,
  });
  const temperatureBand = frame.bands[0];
  const weightBand = frame.bands[1];

  let temperatureLowest = TRACE_TEMPERATURE_FLOOR_C;
  let temperatureHighest = TRACE_TEMPERATURE_CEILING_C;
  let weightHighest = MINIMUM_WEIGHT_G;
  let flowHighest = MINIMUM_FLOW_G_PER_S;
  for (const sample of trace.samples) {
    temperatureLowest = Math.min(
      temperatureLowest,
      sample.boilerTemperatureC,
      sample.activeTargetC,
    );
    temperatureHighest = Math.max(
      temperatureHighest,
      sample.boilerTemperatureC,
      sample.activeTargetC,
    );
    if (sample.netWeightDecigrams !== null) {
      weightHighest = Math.max(weightHighest, sample.netWeightDecigrams / 10);
    }
    if (sample.derivedFlowGPerS !== null) {
      flowHighest = Math.max(flowHighest, sample.derivedFlowGPerS);
    }
  }
  if (cutoffDecigrams !== null && cutoffDecigrams !== undefined) {
    weightHighest = Math.max(weightHighest, cutoffDecigrams / 10);
  }
  const temperatureMin = Math.floor(
    temperatureLowest - TRACE_TEMPERATURE_PADDING_C,
  );
  const temperatureMax = Math.ceil(
    temperatureHighest + TRACE_TEMPERATURE_PADDING_C,
  );

  const x = (elapsedMs: number) =>
    frame.left + (elapsedMs / maxElapsed) * frame.plotWidth;
  const temperatureY = (value: number) =>
    telemetryBandValueY(temperatureBand, value, temperatureMin, temperatureMax);
  const weightY = (value: number) =>
    telemetryBandValueY(weightBand, Math.max(0, value), 0, weightHighest);
  const flowY = (value: number) =>
    telemetryBandValueY(weightBand, Math.max(0, value), 0, flowHighest);
  const continuous = splitContinuous(
    trace.samples,
    (sample) => sample.gapStatus === "gap",
  );
  const settling = trace.samples.find((sample) => sample.phase === "settling");

  return {
    ...frame,
    cutoffY:
      cutoffDecigrams === null || cutoffDecigrams === undefined
        ? null
        : weightY(cutoffDecigrams / 10),
    flowAreas: continuous
      .map((segment) => {
        const available = segment.filter(
          (sample) => sample.derivedFlowGPerS !== null,
        );
        if (available.length < 2) return "";
        return `${linePath(
          available,
          (sample) => x(sample.elapsedMs),
          (sample) => flowY(sample.derivedFlowGPerS!),
        )} L ${x(available.at(-1)!.elapsedMs)} ${frame.bottom} L ${x(
          available[0].elapsedMs,
        )} ${frame.bottom} Z`;
      })
      .filter(Boolean),
    flowY,
    phaseBoundaries: trace.samples
      .filter(
        (sample, index) =>
          index > 0 && sample.phase !== trace.samples[index - 1].phase,
      )
      .map((sample) => x(sample.elapsedMs)),
    settlingX: settling === undefined ? null : x(settling.elapsedMs),
    targetPaths: continuous.map((segment) =>
      linePath(
        segment,
        (sample) => x(sample.elapsedMs),
        (sample) => temperatureY(sample.activeTargetC),
      ),
    ),
    temperatureBand,
    temperaturePaths: continuous.map((segment) =>
      linePath(
        segment,
        (sample) => x(sample.elapsedMs),
        (sample) => temperatureY(sample.boilerTemperatureC),
      ),
    ),
    temperatureY,
    weightBand,
    weightPaths: continuous
      .map((segment) =>
        linePath(
          segment.filter((sample) => sample.netWeightDecigrams !== null),
          (sample) => x(sample.elapsedMs),
          (sample) => weightY(sample.netWeightDecigrams! / 10),
        ),
      )
      .filter(Boolean),
    weightY,
    x,
  };
}

export function temperatureHistoryPlot({
  bandCount,
  height,
  samples,
  width,
  window,
}: {
  bandCount: TelemetryBandCount;
  height: number;
  samples: TemperatureHistorySample[];
  width: number;
  window: TemperatureHistoryWindow;
}): TemperatureHistoryPlot {
  const spanMs = window.endMs - window.startMs;
  const frame = telemetryPlotFrame({ bandCount, height, maxElapsed: spanMs, width });
  const temperatureBand = frame.bands[0];
  const scale = temperatureHistoryGraphScale(samples);
  const x = (recordedAtMs: number) =>
    frame.left + ((recordedAtMs - window.startMs) / spanMs) * frame.plotWidth;
  const temperatureY = (value: number) =>
    telemetryBandValueY(
      temperatureBand,
      value,
      scale.minimumValue,
      scale.maximumValue,
    );
  const continuous = splitContinuous(samples, (sample, previous) =>
    isTemperatureHistoryGap(previous, sample),
  );
  return {
    ...frame,
    heaterRects: activityRects(samples, x, (sample) => sample.heaterActive),
    pumpRects: activityRects(
      samples,
      x,
      (sample) => sample.pumpCommand === "running",
    ),
    targetPaths: continuous.map((segment) =>
      linePath(
        segment,
        (sample) => x(sample.recordedAtMs),
        (sample) => temperatureY(sample.activeTargetC),
      ),
    ),
    temperatureBand,
    temperaturePaths: continuous.map((segment) =>
      linePath(
        segment,
        (sample) => x(sample.recordedAtMs),
        (sample) => temperatureY(sample.boilerTemperatureC),
      ),
    ),
    temperatureTicks: scale.ticks,
    temperatureY,
    weightBand: frame.bands[1] ?? null,
    x,
  };
}

export function activityRects(
  samples: TemperatureHistorySample[],
  x: (recordedAtMs: number) => number,
  isActive: (sample: TemperatureHistorySample) => boolean,
): ActivityRect[] {
  const rects: ActivityRect[] = [];
  let startIndex: number | null = null;
  for (let index = 0; index < samples.length; index += 1) {
    if (isActive(samples[index]) && startIndex === null) startIndex = index;
    if (startIndex === null) continue;
    const next = samples[index + 1];
    const continues =
      next !== undefined &&
      isActive(next) &&
      !isTemperatureHistoryGap(samples[index], next);
    if (continues) continue;
    const startX = x(samples[startIndex].recordedAtMs);
    const endX =
      next !== undefined && !isTemperatureHistoryGap(samples[index], next)
        ? x(next.recordedAtMs)
        : x(samples[index].recordedAtMs) + ACTIVITY_MINIMUM_WIDTH;
    rects.push({
      key: samples[startIndex].recordedAtMs,
      width: Math.max(ACTIVITY_MINIMUM_WIDTH, endX - startX),
      x: startX,
    });
    startIndex = null;
  }
  return rects;
}

export function splitContinuous<T>(
  samples: T[],
  startsNewSegment: (sample: T, previous: T) => boolean,
): T[][] {
  const segments: T[][] = [];
  samples.forEach((sample, index) => {
    if (index === 0 || startsNewSegment(sample, samples[index - 1])) {
      segments.push([]);
    }
    segments.at(-1)!.push(sample);
  });
  return segments;
}

export function linePath<T>(
  samples: T[],
  x: (sample: T) => number,
  y: (sample: T) => number,
): string {
  return samples
    .map(
      (sample, index) =>
        `${index === 0 ? "M" : "L"} ${x(sample).toFixed(2)} ${y(sample).toFixed(2)}`,
    )
    .join(" ");
}

export function formatGraphTick(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}
