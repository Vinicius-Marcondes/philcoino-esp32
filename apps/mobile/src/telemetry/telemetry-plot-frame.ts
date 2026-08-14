export type TelemetryBandCount = 1 | 2 | 3;

export type TelemetryChartVariant = "console" | "home" | "trace-detail";

export interface TelemetryBand {
  bottom: number;
  top: number;
}

export interface TelemetryPlotFrame {
  /** Extraction charts use one band each for temperature, weight, and flow. */
  bands: TelemetryBand[];
  bottom: number;
  left: number;
  maxElapsed: number;
  plotWidth: number;
  right: number;
  top: number;
}

const HORIZONTAL_GUTTER = 34;
const TOP_INSET = 8;
const BOTTOM_INSET = 22;
const BAND_GAP = 18;
const UPPER_BAND_RATIO = 0.48;
const THREE_BAND_GAP = 12;

const CHART_HEIGHTS: Record<TelemetryChartVariant, { compact: number; full: number }> = {
  // Compact is the mounted-landscape case, where the header, readouts and
  // controls already claim most of a phone's short edge.
  console: { compact: 230, full: 380 },
  home: { compact: 150, full: 190 },
  "trace-detail": { compact: 250, full: 330 },
};

export function telemetryChartHeight(
  variant: TelemetryChartVariant,
  compact: boolean,
): number {
  const heights = CHART_HEIGHTS[variant];
  return compact ? heights.compact : heights.full;
}

export function telemetryPlotFrame({
  bandCount,
  height,
  maxElapsed,
  width,
}: {
  bandCount: TelemetryBandCount;
  height: number;
  maxElapsed: number;
  width: number;
}): TelemetryPlotFrame {
  const left = HORIZONTAL_GUTTER;
  const right = width - HORIZONTAL_GUTTER;
  const top = TOP_INSET;
  const bottom = height - BOTTOM_INSET;
  const upperBottom = Math.round(height * UPPER_BAND_RATIO);
  const bands: TelemetryBand[] = bandCount === 1
    ? [{ bottom, top }]
    : bandCount === 2
      ? [
          { bottom: upperBottom, top },
          { bottom, top: upperBottom + BAND_GAP },
        ]
      : threeBands(top, bottom);
  return {
    bands,
    bottom,
    left,
    maxElapsed,
    plotWidth: Math.max(1, right - left),
    right,
    top,
  };
}

function threeBands(top: number, bottom: number): TelemetryBand[] {
  const availableHeight = bottom - top - THREE_BAND_GAP * 2;
  const bandHeight = Math.floor(availableHeight / 3);
  const firstBottom = top + bandHeight;
  const secondTop = firstBottom + THREE_BAND_GAP;
  const secondBottom = secondTop + bandHeight;
  return [
    { bottom: firstBottom, top },
    { bottom: secondBottom, top: secondTop },
    { bottom, top: secondBottom + THREE_BAND_GAP },
  ];
}

export function telemetryGridLines(frame: TelemetryPlotFrame): number[] {
  return frame.bands.flatMap((band) => [band.top, band.bottom]);
}

export function telemetryBandValueY(
  band: TelemetryBand,
  value: number,
  minimumValue: number,
  maximumValue: number,
): number {
  const range = maximumValue - minimumValue;
  if (range === 0) return band.bottom;
  return (
    band.bottom - ((value - minimumValue) / range) * (band.bottom - band.top)
  );
}
