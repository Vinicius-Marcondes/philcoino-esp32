import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, useWindowDimensions } from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";

import type { StoredExtractionTrace } from "@/src/history/extraction-trace";
import { translate } from "@/src/localization/i18n";
import type { ExtractionStreamStatus } from "@/src/telemetry/extraction-stream-session";
import {
  TELEMETRY_COLORS,
  TelemetryGrid,
  TelemetrySurface,
  telemetrySurfaceStyles,
} from "@/components/telemetry-surface";
import {
  telemetryChartHeight,
  type TelemetryChartVariant,
} from "@/src/telemetry/telemetry-plot-frame";
import {
  extractionTelemetryPlot,
  formatGraphTick,
  type WeightedTracePlot,
} from "@/src/telemetry/telemetry-plot";
import {
  formatElapsedReadout,
  formatFlowReadout,
  formatTemperatureReadout,
  formatWeightReadout,
  nearestTraceSampleIndex,
} from "@/src/telemetry/telemetry-readouts";

interface WeightedTraceChartProps {
  compact?: boolean;
  cutoffDecigrams?: number | null;
  streamStatus?: ExtractionStreamStatus;
  trace: StoredExtractionTrace | null;
  variant?: TelemetryChartVariant;
}

const EMPTY_TRACE: StoredExtractionTrace = {
  bootId: "",
  completeness: "live",
  deviceId: "",
  extractionId: "",
  samples: [],
};

export function WeightedTraceChart({
  compact = false,
  cutoffDecigrams,
  streamStatus = "idle",
  trace,
  variant = "trace-detail",
}: WeightedTraceChartProps) {
  const plottedTrace = trace ?? EMPTY_TRACE;
  const windowSize = useWindowDimensions();
  // Seeded from the window so the first frame is not drawn at a stale scale.
  const [width, setWidth] = useState(windowSize.width);
  const [cursorIndex, setCursorIndex] = useState(
    Math.max(0, plottedTrace.samples.length - 1),
  );
  useEffect(() => {
    if (plottedTrace.completeness === "live") {
      setCursorIndex(Math.max(0, plottedTrace.samples.length - 1));
    }
  }, [plottedTrace.completeness, plottedTrace.samples.length]);

  const height = telemetryChartHeight(variant, compact);
  const plot = useMemo(
    () => extractionTelemetryPlot({ cutoffDecigrams, height, trace: plottedTrace, width }),
    [cutoffDecigrams, height, plottedTrace, width],
  );
  const selected =
    plottedTrace.samples[
      Math.min(cursorIndex, plottedTrace.samples.length - 1)
    ] ?? null;
  const latest = plottedTrace.samples.at(-1) ?? null;

  const inspect = (locationX: number) => {
    const ratio = Math.max(
      0,
      Math.min(1, (locationX - plot.left) / plot.plotWidth),
    );
    const nearest = nearestTraceSampleIndex(
      plottedTrace.samples,
      ratio * plot.maxElapsed,
    );
    if (nearest !== null) setCursorIndex(nearest);
  };

  return (
    <TelemetrySurface
      accessibilityLabel={translate("scale.traceAccessibility", {
        count: plottedTrace.samples.length,
        status: trace === null ? streamStatus : plottedTrace.completeness,
      })}
      alerts={null}
      footer={
        selected ? (
          <Text selectable style={telemetrySurfaceStyles.inspection}>
            {formatElapsedReadout(selected.elapsedMs, 2)} ·{" "}
            Boiler {formatTemperatureReadout(selected.boilerTemperatureC, " °C")} ·{" "}
            Steam {formatTemperatureReadout(selected.steamTemperatureC, " °C")} ·{" "}
            {selected.netWeightDecigrams === null
              ? translate("scale.telemetryWeightUnavailable")
              : formatWeightReadout(selected.netWeightDecigrams)}
            {" · "}
            {selected.derivedFlowGPerS === null
              ? translate("scale.telemetryFlowUnavailable")
              : formatFlowReadout(selected.derivedFlowGPerS, 2)}
          </Text>
        ) : (
          <Text selectable style={telemetrySurfaceStyles.inspection}>
            {streamPlaceholder(streamStatus)}
          </Text>
        )
      }
      metrics={[
        {
          color: TELEMETRY_COLORS.temperature,
          label: "Boiler",
          value: formatTemperatureReadout(latest?.boilerTemperatureC ?? null),
        },
        {
          color: TELEMETRY_COLORS.steamTemperature,
          label: "Steam",
          value: formatTemperatureReadout(latest?.steamTemperatureC ?? null),
        },
        {
          color: TELEMETRY_COLORS.weight,
          label: translate("scale.telemetryWeight"),
          value: formatWeightReadout(latest?.netWeightDecigrams ?? null),
        },
        {
          color: TELEMETRY_COLORS.flow,
          label: translate("scale.telemetryFlow"),
          value: formatFlowReadout(latest?.derivedFlowGPerS ?? null),
        },
        {
          color: TELEMETRY_COLORS.text,
          label: translate("scale.telemetryTime"),
          value: formatElapsedReadout(latest?.elapsedMs ?? null),
        },
      ]}>
      <Pressable
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onMoveShouldSetResponderCapture={() => true}
        onResponderGrant={(event) => inspect(event.nativeEvent.locationX)}
        onResponderMove={(event) => inspect(event.nativeEvent.locationX)}
        style={{ height }}>
        <WeightedTraceSvg height={height} latest={latest} plot={plot} selected={selected} width={width} />
      </Pressable>
    </TelemetrySurface>
  );
}

function streamPlaceholder(status: ExtractionStreamStatus): string {
  if (status === "stale") return translate("scale.telemetryStreamReconnecting");
  if (status === "unsupported") {
    return translate("scale.telemetryStreamUnsupported");
  }
  return translate("scale.telemetryStreamWaiting");
}

function WeightedTraceSvg({
  height,
  latest,
  plot,
  selected,
  width,
}: {
  height: number;
  latest: StoredExtractionTrace["samples"][number] | null;
  plot: WeightedTracePlot;
  selected: StoredExtractionTrace["samples"][number] | null;
  width: number;
}) {
  return (
    <Svg height={height} width={width}>
      <Rect fill={TELEMETRY_COLORS.background} height={height} width={width} x={0} y={0} />
      {plot.settlingX !== null ? (
        <Rect
          fill="#E9E1D7"
          height={plot.bottom - plot.top}
          opacity={0.55}
          width={plot.right - plot.settlingX}
          x={plot.settlingX}
          y={plot.top}
        />
      ) : null}
      <TelemetryGrid height={height} plot={plot} />
      <SeriesAxisLabels plot={plot} />
      {plot.phaseBoundaries.map((x) => (
        <Line
          key={`phase-${x}`}
          stroke="#9B8F82"
          strokeWidth={1}
          x1={x}
          x2={x}
          y1={plot.top}
          y2={plot.bottom}
        />
      ))}
      {plot.flowAreas.map((path, index) => (
        <Path
          d={path}
          fill={TELEMETRY_COLORS.flow}
          key={`flow-${index}`}
          opacity={0.14}
          stroke="none"
        />
      ))}
      {plot.flowPaths.map((path, index) => (
        <Path
          d={path}
          fill="none"
          key={`flow-line-${index}`}
          stroke={TELEMETRY_COLORS.flow}
          strokeWidth={2}
        />
      ))}
      {plot.targetPaths.map((path, index) => (
        <Path
          d={path}
          fill="none"
          key={`target-${index}`}
          stroke={TELEMETRY_COLORS.target}
          strokeDasharray="5 4"
          strokeWidth={1.5}
        />
      ))}
      {plot.temperaturePaths.map((path, index) => (
        <Path
          d={path}
          fill="none"
          key={`temperature-${index}`}
          stroke={TELEMETRY_COLORS.temperature}
          strokeWidth={2}
        />
      ))}
      {plot.steamTemperaturePaths.map((path, index) => (
        <Path
          d={path}
          fill="none"
          key={`steam-temperature-${index}`}
          stroke={TELEMETRY_COLORS.steamTemperature}
          strokeWidth={2}
        />
      ))}
      {plot.weightPaths.map((path, index) => (
        <Path
          d={path}
          fill="none"
          key={`weight-${index}`}
          stroke={TELEMETRY_COLORS.weight}
          strokeWidth={2}
        />
      ))}
      {plot.cutoffY !== null ? (
        <Line
          stroke="#8F8275"
          strokeDasharray="2 4"
          strokeWidth={1}
          x1={plot.left}
          x2={plot.right}
          y1={plot.cutoffY}
          y2={plot.cutoffY}
        />
      ) : null}
      {selected ? (
        <Line
          stroke="#5C5249"
          strokeWidth={1}
          x1={plot.x(selected.elapsedMs)}
          x2={plot.x(selected.elapsedMs)}
          y1={plot.top}
          y2={plot.bottom}
        />
      ) : null}
      {latest !== null ? (
        <>
          {latest.boilerTemperatureC !== null ? (
          <Circle
            cx={plot.x(latest.elapsedMs)}
            cy={plot.temperatureY(latest.boilerTemperatureC)}
            fill={TELEMETRY_COLORS.background}
            r={4}
            stroke={TELEMETRY_COLORS.temperature}
            strokeWidth={2}
          />
          ) : null}
          {latest.steamTemperatureC !== null ? (
            <Circle
              cx={plot.x(latest.elapsedMs)}
              cy={plot.temperatureY(latest.steamTemperatureC)}
              fill={TELEMETRY_COLORS.background}
              r={4}
              stroke={TELEMETRY_COLORS.steamTemperature}
              strokeWidth={2}
            />
          ) : null}
          {latest.netWeightDecigrams !== null ? (
            <Circle
              cx={plot.x(latest.elapsedMs)}
              cy={plot.weightY(latest.netWeightDecigrams / 10)}
              fill={TELEMETRY_COLORS.background}
              r={4}
              stroke={TELEMETRY_COLORS.weight}
              strokeWidth={2}
            />
          ) : null}
          {latest.derivedFlowGPerS !== null ? (
            <Circle
              cx={plot.x(latest.elapsedMs)}
              cy={plot.flowY(latest.derivedFlowGPerS)}
              fill={TELEMETRY_COLORS.background}
              r={4}
              stroke={TELEMETRY_COLORS.flow}
              strokeWidth={2}
            />
          ) : null}
        </>
      ) : null}
    </Svg>
  );
}

function SeriesAxisLabels({ plot }: { plot: WeightedTracePlot }) {
  return (
    <G>
      <SeriesAxisLabel
        band={plot.temperatureBand}
        color={TELEMETRY_COLORS.temperature}
        label="°C"
        maximum={plot.temperatureMaximum}
        minimum={plot.temperatureMinimum}
        plot={plot}
      />
      <SeriesAxisLabel
        band={plot.weightBand}
        color={TELEMETRY_COLORS.weight}
        label="g"
        maximum={plot.weightMaximum}
        minimum={0}
        plot={plot}
      />
      <SeriesAxisLabel
        band={plot.flowBand}
        color={TELEMETRY_COLORS.flow}
        label="g/s"
        maximum={plot.flowMaximum}
        minimum={0}
        plot={plot}
      />
    </G>
  );
}

function SeriesAxisLabel({
  band,
  color,
  label,
  maximum,
  minimum,
  plot,
}: {
  band: WeightedTracePlot["temperatureBand"];
  color: string;
  label: string;
  maximum: number;
  minimum: number;
  plot: WeightedTracePlot;
}) {
  return (
    <G>
      <SvgText
        fill={color}
        fontSize={9}
        fontWeight="700"
        textAnchor="end"
        x={plot.left - 5}
        y={band.top + 9}>
        {label}
      </SvgText>
      <SvgText
        fill="#74695E"
        fontSize={8}
        textAnchor="start"
        x={plot.right + 4}
        y={band.top + 8}>
        {formatGraphTick(maximum)}
      </SvgText>
      <SvgText
        fill="#74695E"
        fontSize={8}
        textAnchor="start"
        x={plot.right + 4}
        y={band.bottom}>
        {formatGraphTick(minimum)}
      </SvgText>
    </G>
  );
}
