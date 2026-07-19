import type {
  ExtractionState,
  FaultCode,
  MachineState,
  MachineStatus,
  Mode,
} from "@philcoino/protocol";

export const LIVE_HISTORY_WINDOW_MS = 30 * 1_000;
export const HISTORY_GAP_THRESHOLD_MS = 2_500;
export const TODAY_GRAPH_TARGET_POINTS = 360;

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

export function createTemperatureHistorySample(
  deviceId: string,
  snapshot: MachineState,
  extraction: ExtractionState,
  recordedAtMs = Date.now(),
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

  const durationMs = Math.max(0, last.recordedAtMs - first.recordedAtMs);
  const windowCount = Math.floor(durationMs / windowMs) + 1;
  const firstWindowStartMs = last.recordedAtMs - windowCount * windowMs;

  return Array.from({ length: windowCount }, (_, index) => ({
    endMs: firstWindowStartMs + (index + 1) * windowMs,
    startMs: firstWindowStartMs + index * windowMs,
  }));
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

export function downsampleTemperatureHistory(
  samples: TemperatureHistorySample[],
  targetPoints = TODAY_GRAPH_TARGET_POINTS,
): TemperatureHistorySample[] {
  if (samples.length <= targetPoints || targetPoints < 4) {
    return samples;
  }

  const critical = new Set<number>([0, samples.length - 1]);
  let minimumIndex = 0;
  let maximumIndex = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const sample = samples[index];
    if (sample.boilerTemperatureC < samples[minimumIndex].boilerTemperatureC) {
      minimumIndex = index;
    }
    if (sample.boilerTemperatureC > samples[maximumIndex].boilerTemperatureC) {
      maximumIndex = index;
    }
    if (
      isTemperatureHistoryGap(previous, sample) ||
      previous.heaterActive !== sample.heaterActive ||
      previous.pumpActive !== sample.pumpActive ||
      previous.activeMode !== sample.activeMode ||
      previous.machineStatus !== sample.machineStatus ||
      previous.faultCode !== sample.faultCode
    ) {
      critical.add(index - 1);
      critical.add(index);
    }
  }

  critical.add(minimumIndex);
  critical.add(maximumIndex);

  const desiredCount = Math.max(targetPoints, critical.size);
  if (critical.size < desiredCount) {
    const step = (samples.length - 1) / Math.max(1, desiredCount - 1);
    for (let slot = 0; slot < desiredCount; slot += 1) {
      critical.add(Math.round(slot * step));
    }
  }

  return [...critical]
    .sort((left, right) => left - right)
    .map((index) => samples[index]);
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
