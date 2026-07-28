import type { ScaleState } from "@philcoino/protocol";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";

import {
  TELEMETRY_COLORS,
  TelemetryGrid,
  TelemetrySurface,
  telemetrySurfaceStyles,
} from "@/components/telemetry-surface";
import {
  isLatestHistoryPageOffset,
  isLatestTemperatureHistoryWindow,
  LIVE_HISTORY_WINDOW_MS,
  temperatureHistoryWindowSamples,
  temperatureHistoryWindows,
  type TemperatureHistorySample,
  type TemperatureHistoryWindow,
} from "@/src/history/temperature-history";
import { currentLocale, translate } from "@/src/localization/i18n";
import {
  telemetryChartHeight,
  telemetryPlotFrame,
  type TelemetryBandCount,
} from "@/src/telemetry/telemetry-plot-frame";
import {
  formatGraphTick,
  temperatureHistoryPlot,
} from "@/src/telemetry/telemetry-plot";
import {
  currentScaleWeightDecigrams,
  formatElapsedReadout,
  formatTemperatureReadout,
  formatWeightReadout,
  nearestHistorySample,
  UNAVAILABLE_READOUT,
} from "@/src/telemetry/telemetry-readouts";

export interface TemperatureHistoryChartProps {
  bands?: TelemetryBandCount;
  compact?: boolean;
  error: "storage" | null;
  history: TemperatureHistorySample[];
  loading: boolean;
  scale: ScaleState | null;
  syncStatus: "idle" | "restoring" | "warning";
  syncWarning: "device" | "network" | "protocol" | "storage" | null;
}

export function TemperatureHistoryChart({
  bands = 2,
  compact = false,
  error,
  history,
  loading,
  scale,
  syncStatus,
  syncWarning,
}: TemperatureHistoryChartProps) {
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
  const currentWeightDecigrams = currentScaleWeightDecigrams(scale);
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
              <Text selectable style={telemetrySurfaceStyles.inspection}>
                {(
                  (selected.recordedAtMs - visibleLiveWindow.startMs) /
                  1_000
                ).toFixed(2)}{" "}
                s · {selected.boilerTemperatureC.toFixed(1)} °C
                {bands === 1
                  ? ` · ${selected.activeTargetC.toFixed(1)} °C`
                  : ` · ${translate("scale.telemetryWeightTraceUnavailable")} · ${translate("scale.telemetryFlowUnavailable")}`}
              </Text>
            ) : (
              <Text selectable style={telemetrySurfaceStyles.inspection}>
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
                pressed && telemetrySurfaceStyles.pressed,
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
          color: TELEMETRY_COLORS.temperature,
          label: translate("scale.telemetryTemperature"),
          value: formatTemperatureReadout(
            latestVisible?.boilerTemperatureC ?? null,
          ),
        },
        ...(bands === 1
          ? [
              {
                color: TELEMETRY_COLORS.target,
                label: translate("dashboard.telemetryTarget"),
                value: formatTemperatureReadout(
                  latestVisible?.activeTargetC ?? null,
                ),
              },
            ]
          : [
              {
                color: TELEMETRY_COLORS.weight,
                label: translate("scale.telemetryWeight"),
                value: formatWeightReadout(currentWeightDecigrams),
              },
              {
                color: TELEMETRY_COLORS.flow,
                label: translate("scale.telemetryFlow"),
                value: UNAVAILABLE_READOUT,
              },
            ]),
        {
          color: TELEMETRY_COLORS.text,
          label: translate("scale.telemetryTime"),
          value: formatElapsedReadout(elapsedMs),
        },
      ]}>
      <TemperatureHistoryPager
        bands={bands}
        compact={compact}
        history={history}
        windows={liveWindows}
        jumpToLatestRequest={jumpToLatestRequest}
        loading={loading}
        onInspect={setSelectedTimestampMs}
        onPageChange={setLivePage}
        selectedTimestampMs={selectedTimestampMs}
      />
    </TelemetrySurface>
  );
}

interface HistoryPage {
  isLatest: boolean;
  window: TemperatureHistoryWindow;
}

function TemperatureHistoryPager({
  bands,
  compact,
  history,
  jumpToLatestRequest,
  loading,
  onInspect,
  onPageChange,
  selectedTimestampMs,
  windows,
}: {
  bands: TelemetryBandCount;
  compact: boolean;
  history: TemperatureHistorySample[];
  jumpToLatestRequest: number;
  loading: boolean;
  onInspect: (timestampMs: number) => void;
  onPageChange: (page: HistoryPage) => void;
  selectedTimestampMs: number | null;
  windows: TemperatureHistoryWindow[];
}) {
  const list = useRef<FlatList<TemperatureHistoryWindow>>(null);
  const followsLatest = useRef(true);
  const hasPositionedInitialWindow = useRef(false);
  const handledJumpToLatestRequest = useRef(0);
  const userDragging = useRef(false);
  const viewedPageDistanceFromLatest = useRef(0);
  const viewedWindowStartMs = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const windowSamples = useMemo(
    () =>
      new Map(
        windows.map((window) => [
          window.startMs,
          temperatureHistoryWindowSamples(history, window),
        ]),
      ),
    [history, windows],
  );
  const latestWindowStartMs = windows.at(-1)?.startMs ?? null;
  const height = telemetryChartHeight(
    bands === 1 ? "home" : "trace-detail",
    compact,
  );
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
  const renderPage = useCallback(
    ({ item }: { item: TemperatureHistoryWindow }) => (
      <TemperatureHistoryPage
        bands={bands}
        height={height}
        onInspect={onInspect}
        samples={windowSamples.get(item.startMs) ?? []}
        selectedTimestampMs={selectedTimestampMs}
        width={viewportWidth}
        window={item}
      />
    ),
    [bands, height, onInspect, selectedTimestampMs, viewportWidth, windowSamples],
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
          renderItem={renderPage}
          scrollEnabled={windows.length > 1}
          scrollEventThrottle={32}
          showsHorizontalScrollIndicator={false}
          style={styles.historyPager}
          windowSize={3}
        />
      ) : (
        <EmptyHistoryPlot
          bands={bands}
          height={height}
          loading={loading}
          width={viewportWidth}
        />
      )}
    </View>
  );
}

const TemperatureHistoryPage = memo(function TemperatureHistoryPage({
  bands,
  height,
  onInspect,
  samples,
  selectedTimestampMs,
  width,
  window,
}: {
  bands: TelemetryBandCount;
  height: number;
  onInspect: (timestampMs: number) => void;
  samples: TemperatureHistorySample[];
  selectedTimestampMs: number | null;
  width: number;
  window: TemperatureHistoryWindow;
}) {
  const plot = useMemo(
    () =>
      temperatureHistoryPlot({
        bandCount: bands,
        height,
        samples,
        width,
        window,
      }),
    [bands, height, samples, width, window],
  );
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
    const nearest = nearestHistorySample(samples, timestampMs);
    if (nearest !== null) onInspect(nearest.recordedAtMs);
  };

  return (
    <Pressable
      accessibilityHint={translate("dashboard.historyScrollHint")}
      onPress={(event) => inspect(event.nativeEvent.locationX)}
      style={{ height, width }}>
      <Svg height={height} width={width}>
        <Rect fill={TELEMETRY_COLORS.background} height={height} width={width} x={0} y={0} />
        <TelemetryGrid height={height} plot={plot} />
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
            fill={TELEMETRY_COLORS.heater}
            height={3}
            key={`heater-${rect.key}`}
            opacity={0.75}
            width={rect.width}
            x={rect.x}
            y={plot.temperatureBand.bottom - 4}
          />
        ))}
        {plot.pumpRects.map((rect) => (
          <Rect
            fill={TELEMETRY_COLORS.flow}
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
        {plot.weightBand === null ? null : (
          <SvgText
            fill="#8A8075"
            fontSize={9}
            textAnchor="middle"
            x={(plot.left + plot.right) / 2}
            y={(plot.weightBand.top + plot.weightBand.bottom) / 2}>
            {translate("scale.telemetryTraceUnavailable")}
          </SvgText>
        )}
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
            fill={TELEMETRY_COLORS.background}
            r={4}
            stroke={TELEMETRY_COLORS.temperature}
            strokeWidth={2}
          />
        ) : null}
      </Svg>
    </Pressable>
  );
});
function EmptyHistoryPlot({
  bands,
  height,
  loading,
  width,
}: {
  bands: TelemetryBandCount;
  height: number;
  loading: boolean;
  width: number;
}) {
  const plot = telemetryPlotFrame({
    bandCount: bands,
    height,
    maxElapsed: LIVE_HISTORY_WINDOW_MS,
    width: Math.max(width, 320),
  });
  const unavailableBand = plot.bands[1] ?? null;
  return (
    <View style={{ height }}>
      <Svg height={height} width={Math.max(width, 320)}>
        <Rect
          fill={TELEMETRY_COLORS.background}
          height={height}
          width={Math.max(width, 320)}
          x={0}
          y={0}
        />
        <TelemetryGrid height={height} plot={plot} />
        {unavailableBand === null ? null : (
          <SvgText
            fill="#8A8075"
            fontSize={9}
            textAnchor="middle"
            x={(plot.left + plot.right) / 2}
            y={(unavailableBand.top + unavailableBand.bottom) / 2}>
            {translate("scale.telemetryTraceUnavailable")}
          </SvgText>
        )}
      </Svg>
      <View
        pointerEvents="none"
        style={[
          styles.emptyHistory,
          {
            bottom: height - plot.bands[0].bottom,
            left: plot.left + 6,
            right: Math.max(width, 320) - plot.right + 6,
            top: plot.top,
          },
        ]}>
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

const pageTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatHistoryPageTime(timestampMs: number): string {
  const locale = currentLocale();
  let formatter = pageTimeFormatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    pageTimeFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(timestampMs));
}

const styles = StyleSheet.create({
  emptyHistory: {
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    position: "absolute",
  },
  emptyHistoryText: {
    color: "#6B5B51",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
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
});
