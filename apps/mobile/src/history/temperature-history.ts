import type {
  ExtractionState,
  FaultCode,
  MachineState,
  MachineStatus,
  Mode,
  PredictiveTemperatureDiagnostics,
} from "@philcoino/protocol";

export const LIVE_HISTORY_WINDOW_MS = 30 * 1_000;
export const HISTORY_GAP_THRESHOLD_MS = 2_500;
const GRAPH_TICK_COUNT = 5;
const GRAPH_MINIMUM_RANGE_C = 10;
const GRAPH_PADDING_C = 2;

export interface TemperatureHistorySample {
  activeMode: Mode;
  activeTargetC: number;
  boilerTemperatureC: number;
  brewTargetC: number;
  deviceId: string;
  faultCode: FaultCode | null;
  heaterActive: boolean;
  heaterEnabled: boolean;
  machineStatus: MachineStatus;
  pumpActive: boolean | null;
  predictiveTemperature: PredictiveTemperatureDiagnostics | null;
  recordedAtMs: number;
  sourceBootId: string | null;
  sourceSequence: number | null;
  startsAfterHistoryGap: boolean;
  steamTargetC: number;
  uptimeMs: number;
}

export interface LocalDayRange {
  endMs: number;
  startMs: number;
}

export interface TemperatureHistoryWindow {
  endMs: number;
  startMs: number;
}

export interface TemperatureGraphScale {
  maximumValue: number;
  minimumValue: number;
  ticks: number[];
}

export function createTemperatureHistorySample(
  deviceId: string,
  snapshot: MachineState,
  extraction: ExtractionState,
  recordedAtMs = Date.now(),
  predictiveTemperature: PredictiveTemperatureDiagnostics | null = null,
): TemperatureHistorySample {
  return {
    activeMode: snapshot.activeMode,
    activeTargetC:
      snapshot.activeMode === "brew"
        ? snapshot.brewTargetC
        : snapshot.steamTargetC,
    boilerTemperatureC: snapshot.boilerTemperatureC,
    brewTargetC: snapshot.brewTargetC,
    deviceId,
    faultCode: snapshot.fault?.code ?? null,
    heaterActive: snapshot.heaterActive,
    heaterEnabled: snapshot.heaterEnabled,
    machineStatus: snapshot.status,
    pumpActive: extraction.pumpCommand === "running",
    predictiveTemperature,
    recordedAtMs,
    sourceBootId: null,
    sourceSequence: null,
    startsAfterHistoryGap: false,
    steamTargetC: snapshot.steamTargetC,
    uptimeMs: snapshot.uptimeMs,
  };
}

export function localDayRange(nowMs: number): LocalDayRange {
  const now = new Date(nowMs);
  const startMs = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  return {
    endMs: new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    ).getTime(),
    startMs,
  };
}

export function appendTodaySample(
  samples: TemperatureHistorySample[],
  sample: TemperatureHistorySample,
): TemperatureHistorySample[] {
  const range = localDayRange(sample.recordedAtMs);
  const today = samples.filter(
    (current) =>
      current.recordedAtMs >= range.startMs && current.recordedAtMs < range.endMs,
  );
  const previous = today.at(-1);
  if (
    previous?.deviceId === sample.deviceId &&
    previous.recordedAtMs === sample.recordedAtMs
  ) {
    return [...today.slice(0, -1), sample];
  }
  return [...today, sample];
}

export function liveTemperatureHistory(
  samples: TemperatureHistorySample[],
  windowMs = LIVE_HISTORY_WINDOW_MS,
): TemperatureHistorySample[] {
  const latest = samples.at(-1);
  if (latest === undefined) {
    return [];
  }
  const startMs = latest.recordedAtMs - windowMs;
  return samples.filter(
    (sample) =>
      sample.recordedAtMs > startMs &&
      sample.recordedAtMs <= latest.recordedAtMs,
  );
}

export function temperatureHistoryWindows(
  samples: TemperatureHistorySample[],
  windowMs = LIVE_HISTORY_WINDOW_MS,
): TemperatureHistoryWindow[] {
  const first = samples[0];
  const last = samples.at(-1);
  if (
    first === undefined ||
    last === undefined ||
    !Number.isFinite(windowMs) ||
    windowMs <= 0
  ) {
    return [];
  }

  const firstWindowEndMs = Math.ceil(first.recordedAtMs / windowMs) * windowMs;
  const lastWindowEndMs = Math.ceil(last.recordedAtMs / windowMs) * windowMs;
  const windowCount =
    Math.floor((lastWindowEndMs - firstWindowEndMs) / windowMs) + 1;

  return Array.from({ length: windowCount }, (_, index) => ({
    endMs: firstWindowEndMs + index * windowMs,
    startMs: firstWindowEndMs + (index - 1) * windowMs,
  }));
}

export function temperatureHistoryWindowSamples(
  samples: TemperatureHistorySample[],
  window: TemperatureHistoryWindow,
): TemperatureHistorySample[] {
  return samples.filter(
    (sample) =>
      sample.recordedAtMs > window.startMs &&
      sample.recordedAtMs <= window.endMs,
  );
}

export function isLatestTemperatureHistoryWindow(
  windows: TemperatureHistoryWindow[],
  window: TemperatureHistoryWindow | null,
): boolean {
  const latest = windows.at(-1);
  return (
    latest !== undefined &&
    window !== null &&
    latest.startMs === window.startMs &&
    latest.endMs === window.endMs
  );
}

export function temperatureHistoryGraphScale(
  samples: TemperatureHistorySample[],
): TemperatureGraphScale {
  if (samples.length === 0) {
    return {
      maximumValue: 10,
      minimumValue: 0,
      ticks: [0, 2.5, 5, 7.5, 10],
    };
  }

  const values = samples.flatMap((sample) => [
    sample.boilerTemperatureC,
    sample.activeTargetC,
  ]);
  const paddedMinimum = Math.min(...values) - GRAPH_PADDING_C;
  const paddedMaximum = Math.max(...values) + GRAPH_PADDING_C;
  const requiredRange = Math.max(
    GRAPH_MINIMUM_RANGE_C,
    paddedMaximum - paddedMinimum,
  );
  const tickStep = niceGraphTickStep(
    requiredRange / (GRAPH_TICK_COUNT - 1),
  );
  const axisRange = tickStep * (GRAPH_TICK_COUNT - 1);
  let minimumValue = Math.floor(paddedMinimum / tickStep) * tickStep;
  let maximumValue = minimumValue + axisRange;

  if (maximumValue < paddedMaximum) {
    maximumValue = Math.ceil(paddedMaximum / tickStep) * tickStep;
    minimumValue = maximumValue - axisRange;
  }

  minimumValue = normalizeGraphValue(minimumValue);
  maximumValue = normalizeGraphValue(maximumValue);
  const ticks = Array.from({ length: GRAPH_TICK_COUNT }, (_, index) =>
    normalizeGraphValue(minimumValue + tickStep * index),
  );

  return { maximumValue, minimumValue, ticks };
}

export function temperatureGraphValueTopPercent(
  value: number,
  minimumValue: number,
  maximumValue: number,
): number {
  const range = Math.max(1, maximumValue - minimumValue);
  return Math.max(0, Math.min(100, ((maximumValue - value) / range) * 100));
}

function niceGraphTickStep(requiredStep: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(requiredStep));
  const normalizedStep = requiredStep / magnitude;
  const multiplier = [1, 2, 2.5, 5, 10].find(
    (candidate) => candidate >= normalizedStep,
  )!;
  return multiplier * magnitude;
}

function normalizeGraphValue(value: number): number {
  return Number(value.toFixed(6));
}

export function isLatestHistoryPageOffset(
  offsetX: number,
  contentWidth: number,
  viewportWidth: number,
  tolerance = 8,
): boolean {
  return contentWidth - viewportWidth - offsetX <= tolerance;
}

export function isTemperatureHistoryGap(
  previous: TemperatureHistorySample,
  next: TemperatureHistorySample,
): boolean {
  return (
    next.recordedAtMs - previous.recordedAtMs > HISTORY_GAP_THRESHOLD_MS ||
    next.recordedAtMs <= previous.recordedAtMs ||
    next.uptimeMs <= previous.uptimeMs ||
    next.uptimeMs - previous.uptimeMs > HISTORY_GAP_THRESHOLD_MS ||
    next.deviceId !== previous.deviceId ||
    next.startsAfterHistoryGap ||
    (previous.sourceBootId !== null &&
      next.sourceBootId !== null &&
      previous.sourceBootId !== next.sourceBootId) ||
    (previous.sourceBootId !== null &&
      previous.sourceBootId === next.sourceBootId &&
      previous.sourceSequence !== null &&
      next.sourceSequence !== null &&
      next.sourceSequence !== previous.sourceSequence + 1)
  );
}

export function formatHistoryDurationMs(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
