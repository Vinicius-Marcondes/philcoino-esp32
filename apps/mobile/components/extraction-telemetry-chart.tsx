import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, useWindowDimensions } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import type { StoredWeightedShotTrace } from "@/src/history/weighted-shot-trace";
import { translate } from "@/src/localization/i18n";
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
  weightedTracePlot,
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
  trace: StoredWeightedShotTrace;
  variant?: TelemetryChartVariant;
}

export function WeightedTraceChart({
  compact = false,
  cutoffDecigrams,
  trace,
  variant = "trace-detail",
}: WeightedTraceChartProps) {
  const windowSize = useWindowDimensions();
  // Seeded from the window so the first frame is not drawn at a stale scale.
  const [width, setWidth] = useState(windowSize.width);
  const [cursorIndex, setCursorIndex] = useState(
    Math.max(0, trace.samples.length - 1),
  );
  useEffect(() => {
    if (trace.completeness === "live") {
      setCursorIndex(Math.max(0, trace.samples.length - 1));
    }
  }, [trace.completeness, trace.samples.length]);

  const height = telemetryChartHeight(variant, compact);
  const plot = useMemo(
    () => weightedTracePlot({ cutoffDecigrams, height, trace, width }),
    [cutoffDecigrams, height, trace, width],
  );
  const selected =
    trace.samples[Math.min(cursorIndex, trace.samples.length - 1)] ?? null;
  const latest = trace.samples.at(-1) ?? null;

  const inspect = (locationX: number) => {
    const ratio = Math.max(
      0,
      Math.min(1, (locationX - plot.left) / plot.plotWidth),
    );
    const nearest = nearestTraceSampleIndex(
      trace.samples,
      ratio * plot.maxElapsed,
    );
    if (nearest !== null) setCursorIndex(nearest);
  };

  return (
    <TelemetrySurface
      accessibilityLabel={translate("scale.traceAccessibility", {
        count: trace.samples.length,
        status: trace.completeness,
      })}
      alerts={null}
      footer={
        selected ? (
          <Text selectable style={telemetrySurfaceStyles.inspection}>
            {formatElapsedReadout(selected.elapsedMs, 2)} ·{" "}
            {formatTemperatureReadout(selected.boilerTemperatureC, " °C")} ·{" "}
            {selected.netWeightDecigrams === null
              ? translate("scale.telemetryWeightUnavailable")
              : formatWeightReadout(selected.netWeightDecigrams)}
            {" · "}
            {selected.derivedFlowGPerS === null
              ? translate("scale.telemetryFlowUnavailable")
              : formatFlowReadout(selected.derivedFlowGPerS, 2)}
          </Text>
        ) : null
      }
      metrics={[
        {
          color: TELEMETRY_COLORS.temperature,
          label: translate("scale.telemetryTemperature"),
          value: formatTemperatureReadout(latest?.boilerTemperatureC ?? null),
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

function WeightedTraceSvg({
  height,
  latest,
  plot,
  selected,
  width,
}: {
  height: number;
  latest: StoredWeightedShotTrace["samples"][number] | null;
  plot: WeightedTracePlot;
  selected: StoredWeightedShotTrace["samples"][number] | null;
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
      {latest ? (
        <>
          <Circle
            cx={plot.x(latest.elapsedMs)}
            cy={plot.temperatureY(latest.boilerTemperatureC)}
            fill={TELEMETRY_COLORS.background}
            r={4}
            stroke={TELEMETRY_COLORS.temperature}
            strokeWidth={2}
          />
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
        </>
      ) : null}
    </Svg>
  );
}
