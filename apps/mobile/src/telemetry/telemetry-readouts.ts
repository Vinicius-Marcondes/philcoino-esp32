import type { ScaleState } from "@philcoino/protocol";

import type { TemperatureHistorySample } from "../history/temperature-history";

/** Rendered whenever the machine has not reported a value. Never a placeholder zero. */
export const UNAVAILABLE_READOUT = "—";

export function currentScaleWeightDecigrams(
  scale: ScaleState | null,
): number | null {
  return scale?.netWeightDecigrams ?? scale?.grossWeightDecigrams ?? null;
}

/** Grams with one decimal and no unit, for editable weight fields. */
export function formatDecigrams(decigrams: number): string {
  return (decigrams / 10).toFixed(1);
}

export function formatWeightReadout(
  decigrams: number | null | undefined,
): string {
  if (decigrams === null || decigrams === undefined) {
    return UNAVAILABLE_READOUT;
  }
  return `${formatDecigrams(decigrams)} g`;
}

export function formatFlowReadout(
  gramsPerSecond: number | null,
  digits: 1 | 2 = 1,
): string {
  if (gramsPerSecond === null) return UNAVAILABLE_READOUT;
  return `${gramsPerSecond.toFixed(digits)} g/s`;
}

export function formatTemperatureReadout(
  celsius: number | null,
  suffix = "°",
): string {
  if (celsius === null) return UNAVAILABLE_READOUT;
  return `${celsius.toFixed(1)}${suffix}`;
}

export function formatElapsedReadout(
  elapsedMs: number | null,
  digits: 1 | 2 = 1,
): string {
  if (elapsedMs === null) return UNAVAILABLE_READOUT;
  return `${(elapsedMs / 1_000).toFixed(digits)} s`;
}

/**
 * Index of the sample closest to `elapsedMs`, resolving ties to the earlier
 * sample. Samples must be ordered by `elapsedMs`, which holds for a trace because
 * firmware emits monotonic elapsed time within one extraction.
 */
export function nearestTraceSampleIndex(
  samples: { elapsedMs: number }[],
  elapsedMs: number,
): number | null {
  return nearestSampleIndex(samples, (sample) => sample.elapsedMs, elapsedMs);
}

export function nearestHistorySample(
  samples: TemperatureHistorySample[],
  timestampMs: number,
): TemperatureHistorySample | null {
  const index = nearestSampleIndex(
    samples,
    (sample) => sample.recordedAtMs,
    timestampMs,
  );
  return index === null ? null : samples[index];
}

function nearestSampleIndex<T>(
  samples: T[],
  value: (sample: T) => number,
  target: number,
): number | null {
  if (samples.length === 0) return null;
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (value(samples[middle]) < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const before = Math.max(0, low - 1);
  return Math.abs(value(samples[low]) - target) <
    Math.abs(value(samples[before]) - target)
    ? low
    : before;
}
