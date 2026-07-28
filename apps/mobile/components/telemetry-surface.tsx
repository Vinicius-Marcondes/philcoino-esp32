import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { G, Line, Text as SvgText } from "react-native-svg";

import {
  telemetryGridLines,
  type TelemetryPlotFrame,
} from "@/src/telemetry/telemetry-plot-frame";

export const TELEMETRY_COLORS = {
  background: "#FFF9F1",
  border: "#DCCFC0",
  flow: "#537D7B",
  grid: "#D8CEC2",
  heater: "#F29A52",
  target: "#B37A26",
  temperature: "#7E2F3B",
  text: "#211D19",
  weight: "#282421",
};

export interface TelemetryMetricProps {
  color: string;
  label: string;
  value: string;
}

export function TelemetrySurface({
  accessibilityLabel,
  alerts,
  children,
  footer,
  metrics,
}: {
  accessibilityLabel: string;
  alerts: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  metrics: TelemetryMetricProps[];
}) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={telemetrySurfaceStyles.surface}>
      <View style={telemetrySurfaceStyles.metricRow}>
        {metrics.map((metric) => (
          <TelemetryMetric key={metric.label} {...metric} />
        ))}
      </View>
      {children}
      <View style={telemetrySurfaceStyles.footer}>{footer}</View>
      {alerts === null ? null : (
        <View style={telemetrySurfaceStyles.alerts}>{alerts}</View>
      )}
    </View>
  );
}

export function TelemetryMetric({ color, label, value }: TelemetryMetricProps) {
  return (
    <View style={telemetrySurfaceStyles.metric}>
      <Text selectable style={[telemetrySurfaceStyles.metricLabel, { color }]}>
        {label}
      </Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        selectable
        style={telemetrySurfaceStyles.metricValue}>
        {value}
      </Text>
    </View>
  );
}

export function TelemetryGrid({
  height,
  plot,
}: {
  height: number;
  plot: TelemetryPlotFrame;
}) {
  return (
    <G>
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const x = plot.left + ratio * plot.plotWidth;
        return (
          <G key={`x-${ratio}`}>
            <Line
              stroke={TELEMETRY_COLORS.grid}
              strokeDasharray="3 5"
              strokeWidth={1}
              x1={x}
              x2={x}
              y1={plot.top}
              y2={plot.bottom}
            />
            <SvgText
              fill="#74695E"
              fontSize={9}
              textAnchor="middle"
              x={x}
              y={height - 6}>
              {`${((ratio * plot.maxElapsed) / 1_000).toFixed(0)}s`}
            </SvgText>
          </G>
        );
      })}
      {telemetryGridLines(plot).map((y) => (
        <Line
          key={`y-${y}`}
          stroke={TELEMETRY_COLORS.grid}
          strokeDasharray="3 5"
          strokeWidth={1}
          x1={plot.left}
          x2={plot.right}
          y1={y}
          y2={y}
        />
      ))}
    </G>
  );
}

export const telemetrySurfaceStyles = StyleSheet.create({
  alerts: {
    borderTopColor: TELEMETRY_COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  footer: {
    borderTopColor: TELEMETRY_COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 44,
  },
  inspection: {
    color: "#655B51",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  metric: { flex: 1, minWidth: 0 },
  metricLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 0.7 },
  metricRow: {
    borderBottomColor: TELEMETRY_COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  metricValue: {
    color: TELEMETRY_COLORS.text,
    fontSize: 18,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
  pressed: { opacity: 0.72 },
  surface: {
    backgroundColor: TELEMETRY_COLORS.background,
    borderColor: TELEMETRY_COLORS.border,
    borderCurve: "continuous",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
});
