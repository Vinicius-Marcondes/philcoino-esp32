import type { ScaleState } from "@philcoino/protocol";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";

import type { StoredWeightedShotTrace } from "@/src/history/weighted-shot-trace";
import {
  isLatestHistoryPageOffset,
  isLatestTemperatureHistoryWindow,
  isTemperatureHistoryGap,
  LIVE_HISTORY_WINDOW_MS,
  temperatureHistoryGraphScale,
  temperatureHistoryWindowSamples,
  temperatureHistoryWindows,
  type TemperatureHistorySample,
  type TemperatureHistoryWindow,
} from "@/src/history/temperature-history";
import { currentLocale, translate } from "@/src/localization/i18n";

const COLORS = {
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

type ExtractionTelemetryChartProps =
  | {
      compact?: boolean;
      cutoffDecigrams?: number | null;
      mode: "weighted-trace";
      trace: StoredWeightedShotTrace;
    }
  | {
      compact?: boolean;
      error: "storage" | null;
      history: TemperatureHistorySample[];
      loading: boolean;
      mode: "temperature-history";
      scale: ScaleState | null;
      syncStatus: "idle" | "restoring" | "warning";
      syncWarning: "device" | "network" | "protocol" | "storage" | null;
    };

export function ExtractionTelemetryChart(
  props: ExtractionTelemetryChartProps,
) {
  if (props.mode === "weighted-trace") {
    return <WeightedTraceChart {...props} />;
  }
  return <TemperatureHistoryChart {...props} />;
}

function WeightedTraceChart({
  compact = false,
  cutoffDecigrams,
  trace,
}: Extract<ExtractionTelemetryChartProps, { mode: "weighted-trace" }>) {
  const [width, setWidth] = useState(640);
  const [cursorIndex, setCursorIndex] = useState(
    Math.max(0, trace.samples.length - 1),
  );
  useEffect(() => {
    if (trace.completeness === "live") {
      setCursorIndex(Math.max(0, trace.samples.length - 1));
    }
  }, [trace.completeness, trace.samples.length]);

  const height = compact ? 250 : 330;
  const plot = useMemo(
    () => weightedTraceGeometry(trace, width, height, cutoffDecigrams),
    [cutoffDecigrams, height, trace, width],
  );
  const selected =
    trace.samples[Math.min(cursorIndex, trace.samples.length - 1)] ?? null;
  const latest = trace.samples.at(-1) ?? null;

  const inspect = (locationX: number) => {
    if (trace.samples.length === 0) return;
    const ratio = Math.max(
      0,
      Math.min(1, (locationX - plot.left) / plot.plotWidth),
    );
    const elapsed = ratio * plot.maxElapsed;
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    trace.samples.forEach((sample, index) => {
      const next = Math.abs(sample.elapsedMs - elapsed);
      if (next < distance) {
        distance = next;
        nearest = index;
      }
    });
    setCursorIndex(nearest);
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
          <Text selectable style={styles.inspection}>
            {(selected.elapsedMs / 1_000).toFixed(2)} s ·{" "}
            {selected.boilerTemperatureC.toFixed(1)} °C ·{" "}
            {selected.netWeightDecigrams === null
              ? translate("scale.telemetryWeightUnavailable")
              : `${(selected.netWeightDecigrams / 10).toFixed(1)} g`}
            {" · "}
            {selected.derivedFlowGPerS === null
              ? translate("scale.telemetryFlowUnavailable")
              : `${selected.derivedFlowGPerS.toFixed(2)} g/s`}
          </Text>
        ) : null
      }
      metrics={[
        {
          color: COLORS.temperature,
          label: translate("scale.telemetryTemperature"),
          value: latest ? `${latest.boilerTemperatureC.toFixed(1)}°` : "—",
        },
        {
          color: COLORS.weight,
          label: translate("scale.telemetryWeight"),
          value:
            latest?.netWeightDecigrams === null || latest === null
              ? "—"
              : `${(latest.netWeightDecigrams / 10).toFixed(1)} g`,
        },
        {
          color: COLORS.flow,
          label: translate("scale.telemetryFlow"),
          value:
            latest?.derivedFlowGPerS === null || latest === null
              ? "—"
              : `${latest.derivedFlowGPerS.toFixed(1)} g/s`,
        },
        {
          color: COLORS.text,
          label: translate("scale.telemetryTime"),
          value: latest ? `${(latest.elapsedMs / 1_000).toFixed(1)} s` : "—",
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

function TemperatureHistoryChart({
  compact = false,
  error,
  history,
  loading,
  scale,
  syncStatus,
  syncWarning,
}: Extract<ExtractionTelemetryChartProps, { mode: "temperature-history" }>) {
  const [livePage, setLivePage] = useState<HistoryPage | null>(null);
  const [jumpToLatestRequest, setJumpToLatestRequest] = useState(0);
  const [selectedTimestampMs, setSelectedTimestampMs] = useState<number | null>(
    null,
  );
  const liveWindows = useMemo(
    () => temperatureHistoryWindows(history),
    [history],
  );
  const latestLiveWindow = liveWindows.at(-1) ?? null;
  const visibleLiveWindow =
    livePage !== null &&
    liveWindows.some(
      (window) =>
        window.startMs === livePage.window.startMs &&
        window.endMs === livePage.window.endMs,
    )
      ? livePage.window
      : latestLiveWindow;
  const visibleSamples =
    visibleLiveWindow === null
      ? []
      : temperatureHistoryWindowSamples(history, visibleLiveWindow);
  const latestVisible = visibleSamples.at(-1) ?? null;
  const selected =
    visibleSamples.find(
      (sample) => sample.recordedAtMs === selectedTimestampMs,
    ) ??
    latestVisible ??
    null;
  const latestLivePage = isLatestTemperatureHistoryWindow(
    liveWindows,
    visibleLiveWindow,
  );
  const pageStatus =
    visibleLiveWindow === null
      ? null
      : translate(
          compact
            ? latestLivePage
              ? "dashboard.historyPageLatestCompact"
              : "dashboard.historyPageEarlierCompact"
            : latestLivePage
              ? "dashboard.historyPageLatest"
              : "dashboard.historyPageEarlier",
          {
            end: formatHistoryPageTime(visibleLiveWindow.endMs),
            start: formatHistoryPageTime(visibleLiveWindow.startMs),
          },
        );
  const currentWeightDecigrams =
    scale?.netWeightDecigrams ?? scale?.grossWeightDecigrams ?? null;
  const elapsedMs =
    latestVisible === null || visibleLiveWindow === null
      ? null
      : Math.max(
          0,
          Math.min(
            LIVE_HISTORY_WINDOW_MS,
            latestVisible.recordedAtMs - visibleLiveWindow.startMs,
          ),
        );

  useEffect(() => {
    setSelectedTimestampMs(null);
  }, [visibleLiveWindow?.startMs]);

  const warning =
    syncStatus === "warning"
      ? translate(
          syncWarning === "protocol"
            ? "dashboard.historySyncProtocolWarning"
            : syncWarning === "network"
              ? "dashboard.historySyncNetworkWarning"
              : syncWarning === "device"
                ? "dashboard.historySyncDeviceWarning"
                : "dashboard.historySyncStorageWarning",
        )
      : syncStatus === "restoring"
        ? translate("dashboard.historySyncRestoring")
        : error !== null
          ? translate("dashboard.historyStorageError")
          : null;

  return (
    <TelemetrySurface
      accessibilityLabel={translate("dashboard.curveAccessibility", {
        count: visibleSamples.length,
      })}
      alerts={
        warning === null ? null : (
          <Text
            accessibilityLiveRegion="polite"
            selectable
            style={
              syncStatus === "warning" || error !== null
                ? styles.historyError
                : styles.historyStatus
            }>
            {warning}
          </Text>
        )
      }
      footer={
        <View style={styles.historyFooter}>
          <View style={styles.historyInspection}>
            {selected !== null && visibleLiveWindow !== null ? (
              <Text selectable style={styles.inspection}>
                {(
                  (selected.recordedAtMs - visibleLiveWindow.startMs) /
                  1_000
                ).toFixed(2)}{" "}
                s · {selected.boilerTemperatureC.toFixed(1)} °C ·{" "}
                {translate("scale.telemetryWeightTraceUnavailable")} ·{" "}
                {translate("scale.telemetryFlowUnavailable")}
              </Text>
            ) : (
              <Text selectable style={styles.inspection}>
                {translate("dashboard.historyEmpty")}
              </Text>
            )}
            {pageStatus !== null ? (
              <Text selectable style={styles.historyPageStatus}>
                {pageStatus}
              </Text>
            ) : null}
          </View>
          {!latestLivePage && visibleLiveWindow !== null ? (
            <Pressable
              accessibilityLabel={translate("dashboard.historyJumpToLatest")}
              accessibilityRole="button"
              onPress={() => setJumpToLatestRequest((current) => current + 1)}
              style={({ pressed }) => [
                styles.historyJumpToLatest,
                pressed && styles.pressed,
              ]}>
              <Text selectable style={styles.historyJumpToLatestText}>
                {translate("dashboard.historyJumpToLatest")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      }
      metrics={[
        {
          color: COLORS.temperature,
          label: translate("scale.telemetryTemperature"),
          value:
            latestVisible === null
              ? "—"
              : `${latestVisible.boilerTemperatureC.toFixed(1)}°`,
        },
        {
          color: COLORS.weight,
          label: translate("scale.telemetryWeight"),
          value:
            currentWeightDecigrams === null
              ? "—"
              : `${(currentWeightDecigrams / 10).toFixed(1)} g`,
        },
        {
          color: COLORS.flow,
          label: translate("scale.telemetryFlow"),
          value: "—",
        },
        {
          color: COLORS.text,
          label: translate("scale.telemetryTime"),
          value: elapsedMs === null ? "—" : `${(elapsedMs / 1_000).toFixed(1)} s`,
        },
      ]}>
      <TemperatureHistoryPager
        compact={compact}
        history={history}
        jumpToLatestRequest={jumpToLatestRequest}
        loading={loading}
        onInspect={setSelectedTimestampMs}
        onPageChange={setLivePage}
        selectedTimestampMs={selectedTimestampMs}
      />
    </TelemetrySurface>
  );
}

function TelemetrySurface({
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
  metrics: { color: string; label: string; value: string }[];
}) {
  return (
    <View accessibilityLabel={accessibilityLabel} style={styles.surface}>
      <View style={styles.metricRow}>
        {metrics.map((metric) => (
          <Metric key={metric.label} {...metric} />
        ))}
      </View>
      {children}
      <View style={styles.footer}>{footer}</View>
      {alerts === null ? null : <View style={styles.alerts}>{alerts}</View>}
    </View>
  );
}

function Metric({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.metric}>
      <Text selectable style={[styles.metricLabel, { color }]}>
        {label}
      </Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        selectable
        style={styles.metricValue}>
        {value}
      </Text>
    </View>
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
  plot: ReturnType<typeof weightedTraceGeometry>;
  selected: StoredWeightedShotTrace["samples"][number] | null;
  width: number;
}) {
  return (
    <Svg height={height} width={width}>
      <Rect fill={COLORS.background} height={height} width={width} x={0} y={0} />
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
      <SharedGrid height={height} plot={plot} />
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
          fill={COLORS.flow}
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
          stroke={COLORS.target}
          strokeDasharray="5 4"
          strokeWidth={1.5}
        />
      ))}
      {plot.temperaturePaths.map((path, index) => (
        <Path
          d={path}
          fill="none"
          key={`temperature-${index}`}
          stroke={COLORS.temperature}
          strokeWidth={2}
        />
      ))}
      {plot.weightPaths.map((path, index) => (
        <Path
          d={path}
          fill="none"
          key={`weight-${index}`}
          stroke={COLORS.weight}
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
            fill={COLORS.background}
            r={4}
            stroke={COLORS.temperature}
            strokeWidth={2}
          />
          {latest.netWeightDecigrams !== null ? (
            <Circle
              cx={plot.x(latest.elapsedMs)}
              cy={plot.weightY(latest.netWeightDecigrams / 10)}
              fill={COLORS.background}
              r={4}
              stroke={COLORS.weight}
              strokeWidth={2}
            />
          ) : null}
        </>
      ) : null}
    </Svg>
  );
}

interface HistoryPage {
  isLatest: boolean;
  window: TemperatureHistoryWindow;
}

function TemperatureHistoryPager({
  compact,
  history,
  jumpToLatestRequest,
  loading,
  onInspect,
  onPageChange,
  selectedTimestampMs,
}: {
  compact: boolean;
  history: TemperatureHistorySample[];
  jumpToLatestRequest: number;
  loading: boolean;
  onInspect: (timestampMs: number) => void;
  onPageChange: (page: HistoryPage) => void;
  selectedTimestampMs: number | null;
}) {
  const list = useRef<FlatList<TemperatureHistoryWindow>>(null);
  const followsLatest = useRef(true);
  const hasPositionedInitialWindow = useRef(false);
  const handledJumpToLatestRequest = useRef(0);
  const userDragging = useRef(false);
  const viewedPageDistanceFromLatest = useRef(0);
  const viewedWindowStartMs = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const windows = useMemo(
    () => temperatureHistoryWindows(history),
    [history],
  );
  const latestWindowStartMs = windows.at(-1)?.startMs ?? null;
  const height = compact ? 250 : 330;
  const reportPage = useCallback(
    (index: number) => {
      const window = windows[index];
      if (window === undefined) return;
      onPageChange({
        isLatest: index === windows.length - 1,
        window,
      });
    },
    [onPageChange, windows],
  );
  const updateViewedOffset = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    if (!hasPositionedInitialWindow.current) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    followsLatest.current = isLatestHistoryPageOffset(
      contentOffset.x,
      contentSize.width,
      layoutMeasurement.width,
    );
    const viewedIndex = Math.max(
      0,
      Math.min(
        windows.length - 1,
        Math.round(contentOffset.x / layoutMeasurement.width),
      ),
    );
    viewedPageDistanceFromLatest.current = windows.length - 1 - viewedIndex;
    viewedWindowStartMs.current = windows[viewedIndex]?.startMs ?? null;
    reportPage(viewedIndex);
  };

  useEffect(() => {
    if (
      jumpToLatestRequest === 0 ||
      jumpToLatestRequest === handledJumpToLatestRequest.current ||
      viewportWidth <= 0
    ) {
      return;
    }
    handledJumpToLatestRequest.current = jumpToLatestRequest;
    followsLatest.current = true;
    viewedPageDistanceFromLatest.current = 0;
    viewedWindowStartMs.current = latestWindowStartMs;
    list.current?.scrollToEnd({ animated: false });
    reportPage(windows.length - 1);
  }, [
    jumpToLatestRequest,
    latestWindowStartMs,
    reportPage,
    viewportWidth,
    windows.length,
  ]);

  return (
    <View
      onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
      style={{ height }}>
      {viewportWidth > 0 && windows.length > 0 ? (
        <FlatList
          data={windows}
          decelerationRate="fast"
          getItemLayout={(_, index) => ({
            index,
            length: viewportWidth,
            offset: viewportWidth * index,
          })}
          horizontal
          initialNumToRender={2}
          keyExtractor={(window) => `history-window-${window.startMs}`}
          maxToRenderPerBatch={3}
          onContentSizeChange={() => {
            if (!hasPositionedInitialWindow.current || followsLatest.current) {
              list.current?.scrollToEnd({ animated: false });
              hasPositionedInitialWindow.current = true;
              viewedPageDistanceFromLatest.current = 0;
              viewedWindowStartMs.current = windows.at(-1)?.startMs ?? null;
              reportPage(windows.length - 1);
              return;
            }
            const preservedIndex = windows.findIndex(
              (window) => window.startMs === viewedWindowStartMs.current,
            );
            const viewedIndex =
              preservedIndex >= 0
                ? preservedIndex
                : Math.max(
                    0,
                    windows.length -
                      1 -
                      viewedPageDistanceFromLatest.current,
                  );
            list.current?.scrollToOffset({
              animated: false,
              offset: viewedIndex * viewportWidth,
            });
            reportPage(viewedIndex);
          }}
          onMomentumScrollEnd={updateViewedOffset}
          onScroll={(event) => {
            if (userDragging.current) updateViewedOffset(event);
          }}
          onScrollBeginDrag={() => {
            userDragging.current = true;
          }}
          onScrollEndDrag={(event) => {
            updateViewedOffset(event);
            userDragging.current = false;
          }}
          pagingEnabled
          ref={list}
          renderItem={({ item }) => (
            <TemperatureHistoryPage
              height={height}
              onInspect={onInspect}
              samples={temperatureHistoryWindowSamples(history, item)}
              selectedTimestampMs={selectedTimestampMs}
              width={viewportWidth}
              window={item}
            />
          )}
          scrollEnabled={windows.length > 1}
          scrollEventThrottle={32}
          showsHorizontalScrollIndicator={false}
          style={styles.historyPager}
          windowSize={3}
        />
      ) : (
        <EmptyHistoryPlot height={height} loading={loading} width={viewportWidth} />
      )}
    </View>
  );
}

function TemperatureHistoryPage({
  height,
  onInspect,
  samples,
  selectedTimestampMs,
  width,
  window,
}: {
  height: number;
  onInspect: (timestampMs: number) => void;
  samples: TemperatureHistorySample[];
  selectedTimestampMs: number | null;
  width: number;
  window: TemperatureHistoryWindow;
}) {
  const plot = historyGeometry(samples, window, width, height);
  const latest = samples.at(-1) ?? null;
  const selected =
    samples.find((sample) => sample.recordedAtMs === selectedTimestampMs) ??
    latest;
  const inspect = (locationX: number) => {
    if (samples.length === 0) return;
    const ratio = Math.max(
      0,
      Math.min(1, (locationX - plot.left) / plot.plotWidth),
    );
    const timestampMs =
      window.startMs + ratio * (window.endMs - window.startMs);
    let nearest = samples[0];
    for (const sample of samples.slice(1)) {
      if (
        Math.abs(sample.recordedAtMs - timestampMs) <
        Math.abs(nearest.recordedAtMs - timestampMs)
      ) {
        nearest = sample;
      }
    }
    onInspect(nearest.recordedAtMs);
  };

  return (
    <Pressable
      accessibilityHint={translate("dashboard.historyScrollHint")}
      onPress={(event) => inspect(event.nativeEvent.locationX)}
      style={{ height, width }}>
      <Svg height={height} width={width}>
        <Rect fill={COLORS.background} height={height} width={width} x={0} y={0} />
        <SharedGrid height={height} plot={plot} />
        {plot.temperatureTicks.map((tick) => (
          <SvgText
            fill="#74695E"
            fontSize={8}
            key={`temperature-tick-${tick}`}
            textAnchor="end"
            x={plot.left - 5}
            y={plot.temperatureY(tick) + 3}>
            {`${formatGraphTick(tick)}°`}
          </SvgText>
        ))}
        {plot.heaterRects.map((rect) => (
          <Rect
            fill={COLORS.heater}
            height={3}
            key={`heater-${rect.key}`}
            opacity={0.75}
            width={rect.width}
            x={rect.x}
            y={plot.upperBottom - 4}
          />
        ))}
        {plot.pumpRects.map((rect) => (
          <Rect
            fill={COLORS.flow}
            height={3}
            key={`pump-${rect.key}`}
            opacity={0.75}
            width={rect.width}
            x={rect.x}
            y={plot.bottom - 4}
          />
        ))}
        {plot.targetPaths.map((path, index) => (
          <Path
            d={path}
            fill="none"
            key={`target-${index}`}
            stroke={COLORS.target}
            strokeDasharray="5 4"
            strokeWidth={1.5}
          />
        ))}
        {plot.temperaturePaths.map((path, index) => (
          <Path
            d={path}
            fill="none"
            key={`temperature-${index}`}
            stroke={COLORS.temperature}
            strokeWidth={2}
          />
        ))}
        <SvgText
          fill="#8A8075"
          fontSize={9}
          textAnchor="middle"
          x={(plot.left + plot.right) / 2}
          y={(plot.lowerTop + plot.bottom) / 2}>
          {translate("scale.telemetryTraceUnavailable")}
        </SvgText>
        {selected ? (
          <Line
            stroke="#5C5249"
            strokeWidth={1}
            x1={plot.x(selected.recordedAtMs)}
            x2={plot.x(selected.recordedAtMs)}
            y1={plot.top}
            y2={plot.bottom}
          />
        ) : null}
        {latest ? (
          <Circle
            cx={plot.x(latest.recordedAtMs)}
            cy={plot.temperatureY(latest.boilerTemperatureC)}
            fill={COLORS.background}
            r={4}
            stroke={COLORS.temperature}
            strokeWidth={2}
          />
        ) : null}
      </Svg>
    </Pressable>
  );
}

function EmptyHistoryPlot({
  height,
  loading,
  width,
}: {
  height: number;
  loading: boolean;
  width: number;
}) {
  const plot = baseGeometry(Math.max(width, 320), height, LIVE_HISTORY_WINDOW_MS);
  return (
    <View style={{ height }}>
      <Svg height={height} width={Math.max(width, 320)}>
        <Rect
          fill={COLORS.background}
          height={height}
          width={Math.max(width, 320)}
          x={0}
          y={0}
        />
        <SharedGrid height={height} plot={plot} />
        <SvgText
          fill="#8A8075"
          fontSize={9}
          textAnchor="middle"
          x={(plot.left + plot.right) / 2}
          y={(plot.lowerTop + plot.bottom) / 2}>
          {translate("scale.telemetryTraceUnavailable")}
        </SvgText>
      </Svg>
      <View pointerEvents="none" style={styles.emptyHistory}>
        {loading ? <ActivityIndicator size="small" /> : null}
        <Text selectable style={styles.emptyHistoryText}>
          {translate(
            loading ? "dashboard.historyLoading" : "dashboard.historyEmpty",
          )}
        </Text>
      </View>
    </View>
  );
}

function SharedGrid({
  height,
  plot,
}: {
  height: number;
  plot: ReturnType<typeof baseGeometry>;
}) {
  return (
    <G>
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const x = plot.left + ratio * plot.plotWidth;
        return (
          <G key={`x-${ratio}`}>
            <Line
              stroke={COLORS.grid}
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
      {[plot.top, plot.upperBottom, plot.lowerTop, plot.bottom].map((y) => (
        <Line
          key={`y-${y}`}
          stroke={COLORS.grid}
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

function baseGeometry(width: number, height: number, maxElapsed: number) {
  const left = 34;
  const right = width - 34;
  const top = 8;
  const upperBottom = Math.round(height * 0.48);
  const lowerTop = upperBottom + 18;
  const bottom = height - 22;
  const plotWidth = Math.max(1, right - left);
  return {
    bottom,
    left,
    lowerTop,
    maxElapsed,
    plotWidth,
    right,
    top,
    upperBottom,
  };
}

function weightedTraceGeometry(
  trace: StoredWeightedShotTrace,
  width: number,
  height: number,
  cutoffDecigrams?: number | null,
) {
  const maxElapsed = Math.max(1_000, trace.samples.at(-1)?.elapsedMs ?? 1_000);
  const base = baseGeometry(width, height, maxElapsed);
  const temperatures = trace.samples.flatMap((sample) => [
    sample.boilerTemperatureC,
    sample.activeTargetC,
  ]);
  const temperatureMin = Math.floor(Math.min(...temperatures, 85) - 1);
  const temperatureMax = Math.ceil(Math.max(...temperatures, 96) + 1);
  const weights = trace.samples
    .map((sample) =>
      sample.netWeightDecigrams === null
        ? null
        : sample.netWeightDecigrams / 10,
    )
    .filter((value): value is number => value !== null);
  const weightMax = Math.max(10, ...weights, (cutoffDecigrams ?? 0) / 10);
  const flowMax = Math.max(
    2,
    ...trace.samples.map((sample) => sample.derivedFlowGPerS ?? 0),
  );
  const x = (elapsedMs: number) =>
    base.left + (elapsedMs / maxElapsed) * base.plotWidth;
  const temperatureY = (value: number) =>
    base.upperBottom -
    ((value - temperatureMin) / (temperatureMax - temperatureMin)) *
      (base.upperBottom - base.top);
  const weightY = (value: number) =>
    base.bottom -
    (Math.max(0, value) / weightMax) * (base.bottom - base.lowerTop);
  const flowY = (value: number) =>
    base.bottom -
    (Math.max(0, value) / flowMax) * (base.bottom - base.lowerTop);
  const continuous = splitWeightedContinuous(trace.samples);
  return {
    ...base,
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
        return `${linePath(available, (sample) => x(sample.elapsedMs), (sample) =>
          flowY(sample.derivedFlowGPerS!),
        )} L ${x(available.at(-1)!.elapsedMs)} ${base.bottom} L ${x(
          available[0].elapsedMs,
        )} ${base.bottom} Z`;
      })
      .filter(Boolean),
    phaseBoundaries: trace.samples
      .filter(
        (sample, index) =>
          index > 0 && sample.phase !== trace.samples[index - 1].phase,
      )
      .map((sample) => x(sample.elapsedMs)),
    settlingX:
      trace.samples.find((sample) => sample.phase === "settling")?.elapsedMs ===
      undefined
        ? null
        : x(
            trace.samples.find((sample) => sample.phase === "settling")!
              .elapsedMs,
          ),
    targetPaths: continuous.map((segment) =>
      linePath(
        segment,
        (sample) => x(sample.elapsedMs),
        (sample) => temperatureY(sample.activeTargetC),
      ),
    ),
    temperaturePaths: continuous.map((segment) =>
      linePath(
        segment,
        (sample) => x(sample.elapsedMs),
        (sample) => temperatureY(sample.boilerTemperatureC),
      ),
    ),
    temperatureY,
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

function historyGeometry(
  samples: TemperatureHistorySample[],
  window: TemperatureHistoryWindow,
  width: number,
  height: number,
) {
  const base = baseGeometry(width, height, window.endMs - window.startMs);
  const scale = temperatureHistoryGraphScale(samples);
  const x = (recordedAtMs: number) =>
    base.left +
    ((recordedAtMs - window.startMs) / (window.endMs - window.startMs)) *
      base.plotWidth;
  const temperatureY = (value: number) =>
    base.upperBottom -
    ((value - scale.minimumValue) /
      (scale.maximumValue - scale.minimumValue)) *
      (base.upperBottom - base.top);
  const continuous = splitHistoryContinuous(samples);
  return {
    ...base,
    heaterRects: activityRects(samples, x, (sample) => sample.heaterActive),
    pumpRects: activityRects(
      samples,
      x,
      (sample) => sample.pumpActive === true,
    ),
    targetPaths: continuous.map((segment) =>
      linePath(
        segment,
        (sample) => x(sample.recordedAtMs),
        (sample) => temperatureY(sample.activeTargetC),
      ),
    ),
    temperaturePaths: continuous.map((segment) =>
      linePath(
        segment,
        (sample) => x(sample.recordedAtMs),
        (sample) => temperatureY(sample.boilerTemperatureC),
      ),
    ),
    temperatureTicks: scale.ticks,
    temperatureY,
    x,
  };
}

function activityRects(
  samples: TemperatureHistorySample[],
  x: (recordedAtMs: number) => number,
  isActive: (sample: TemperatureHistorySample) => boolean,
): { key: number; width: number; x: number }[] {
  const rects: { key: number; width: number; x: number }[] = [];
  let startIndex: number | null = null;
  for (let index = 0; index < samples.length; index += 1) {
    if (isActive(samples[index]) && startIndex === null) startIndex = index;
    if (startIndex === null) continue;
    const next = samples[index + 1];
    const continuous =
      next !== undefined &&
      isActive(next) &&
      !isTemperatureHistoryGap(samples[index], next);
    if (continuous) continue;
    const startX = x(samples[startIndex].recordedAtMs);
    const endX =
      next !== undefined && !isTemperatureHistoryGap(samples[index], next)
        ? x(next.recordedAtMs)
        : x(samples[index].recordedAtMs) + 2;
    rects.push({
      key: samples[startIndex].recordedAtMs,
      width: Math.max(2, endX - startX),
      x: startX,
    });
    startIndex = null;
  }
  return rects;
}

function splitWeightedContinuous<T extends { gapStatus: string }>(
  samples: T[],
): T[][] {
  const segments: T[][] = [];
  for (const sample of samples) {
    if (segments.length === 0 || sample.gapStatus === "gap") segments.push([]);
    segments.at(-1)!.push(sample);
  }
  return segments.filter((segment) => segment.length > 0);
}

function splitHistoryContinuous(
  samples: TemperatureHistorySample[],
): TemperatureHistorySample[][] {
  const segments: TemperatureHistorySample[][] = [];
  samples.forEach((sample, index) => {
    if (
      index === 0 ||
      isTemperatureHistoryGap(samples[index - 1], sample)
    ) {
      segments.push([]);
    }
    segments.at(-1)!.push(sample);
  });
  return segments;
}

function linePath<T>(
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

function formatGraphTick(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatHistoryPageTime(timestampMs: number): string {
  return new Intl.DateTimeFormat(currentLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestampMs));
}

const styles = StyleSheet.create({
  alerts: {
    borderTopColor: COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyHistory: {
    alignItems: "center",
    bottom: "52%",
    gap: 8,
    justifyContent: "center",
    left: 40,
    position: "absolute",
    right: 20,
    top: 8,
  },
  emptyHistoryText: {
    color: "#6B5B51",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  footer: {
    borderTopColor: COLORS.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 44,
  },
  historyError: {
    color: "#8C2F24",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
  },
  historyFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    minHeight: 44,
  },
  historyInspection: { flex: 1, minWidth: 0 },
  historyJumpToLatest: {
    backgroundColor: "#EFE6DA",
    borderColor: "#B98A76",
    borderCurve: "continuous",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginRight: 8,
    minHeight: 32,
    paddingHorizontal: 10,
  },
  historyJumpToLatestText: {
    color: "#7A3025",
    fontSize: 11,
    fontWeight: "800",
  },
  historyPageStatus: {
    color: "#74695E",
    fontSize: 9,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
    paddingBottom: 6,
    paddingHorizontal: 12,
  },
  historyPager: { flex: 1 },
  historyStatus: {
    color: "#6B5B51",
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
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
    borderBottomColor: COLORS.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  metricValue: {
    color: COLORS.text,
    fontSize: 18,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
  pressed: { opacity: 0.72 },
  surface: {
    backgroundColor: COLORS.background,
    borderColor: COLORS.border,
    borderCurve: "continuous",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
});
