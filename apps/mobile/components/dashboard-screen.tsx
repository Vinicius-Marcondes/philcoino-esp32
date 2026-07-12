import type { MachineState } from "@philcoino/protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  MachineControls,
  MutationFeedback,
} from "@/components/machine-controls";
import { useMachineDashboard } from "@/hooks/use-machine-dashboard";
import {
  appendTemperatureSample,
  boilerTargetC,
  boilerTemperatureC,
  connectionCopy,
  faultLabel,
  formatHistoryDuration,
  formatSteamCountdown,
  formatTarget,
  formatTemperature,
  formatUptime,
  machineActivityLabel,
  modeLabel,
  steamCountdownContext,
  type TemperatureSample,
} from "@/src/dashboard/dashboard-view-model";
import type { DashboardMutationState } from "@/src/dashboard/dashboard-mutation-session";
import { isDebugDeviceModeEnabled } from "@/src/debug-device-mode";
import { translate } from "@/src/localization/i18n";
import { createDebugDeviceApiClient } from "@/src/networking/debug-device-api-client";
import { createDeviceApiClient } from "@/src/networking/expo-device-api-client";
import type { SelectedDevice } from "@/src/storage/selected-device-repository";

interface DashboardScreenProps {
  deviceName: string;
  initialNote: string;
  onForget: () => void;
  selectedDevice: SelectedDevice;
}

export function DashboardScreen({
  deviceName,
  initialNote,
  onForget,
  selectedDevice,
}: DashboardScreenProps) {
  const debugDeviceMode = isDebugDeviceModeEnabled();
  const client = useMemo(
    () =>
      debugDeviceMode
        ? createDebugDeviceApiClient()
        : createDeviceApiClient({
            address: selectedDevice.lastSuccessfulAddress,
            token: selectedDevice.token,
          }),
    [
      debugDeviceMode,
      selectedDevice.lastSuccessfulAddress,
      selectedDevice.token,
    ],
  );
  const {
    connection,
    dismissMutation,
    dismissOverTemperature,
    faultMutation,
    heaterMutation,
    modeMutation,
    setHeaterEnabled,
    setMode,
    snapshot,
    temperatureMutation,
    updateTemperatureSettings,
  } = useMachineDashboard(client);
  const { width } = useWindowDimensions();
  const connectionContent = connectionCopy(connection);
  const metricWidth = width >= 700 ? "48.5%" : "100%";
  const [temperatureHistory, setTemperatureHistory] = useState<
    TemperatureSample[]
  >([]);
  const dismissModeMutation = useCallback(
    () => dismissMutation("mode"),
    [dismissMutation],
  );
  const dismissTemperatureMutation = useCallback(
    () => dismissMutation("temperatures"),
    [dismissMutation],
  );
  const dismissFaultMutation = useCallback(
    () => dismissMutation("fault"),
    [dismissMutation],
  );
  const dismissHeaterMutation = useCallback(
    () => dismissMutation("heater"),
    [dismissMutation],
  );
  const mutationPending =
    faultMutation.status === "pending" ||
    heaterMutation.status === "pending" ||
    modeMutation.status === "pending" ||
    temperatureMutation.status === "pending";

  useEffect(() => {
    if (connection.status !== "online" || snapshot === null) {
      setTemperatureHistory([]);
      return;
    }
    setTemperatureHistory((history) =>
      appendTemperatureSample(history, snapshot),
    );
  }, [connection.status, snapshot]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={styles.content}>
        <View style={styles.pageHeader}>
          <Text selectable style={styles.pageTitle}>{deviceName}</Text>
        </View>
        <View style={styles.intro}>
          <Text selectable style={styles.eyebrow}>{translate("dashboard.liveMachine")}</Text>
          <Text selectable style={styles.lead}>
            {translate("dashboard.lead")}
          </Text>
        </View>

        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.connectionCard,
            connection.status === "online"
              ? styles.connectionOnline
              : styles.connectionUnavailable,
          ]}>
          <View style={styles.statusHeading}>
            <View
              style={[
                styles.statusDot,
                connection.status === "online"
                  ? styles.statusDotOnline
                  : styles.statusDotUnavailable,
              ]}
            />
            <Text selectable style={styles.connectionLabel}>
              {translate("dashboard.appConnection", { status: connectionContent.label })}
            </Text>
            {connection.status === "connecting" ? (
              <ActivityIndicator accessibilityLabel={translate("dashboard.connecting")} size="small" />
            ) : null}
          </View>
          <Text selectable style={styles.connectionDetail}>
            {connectionContent.detail}
          </Text>
        </View>

        <MutationFeedback
          onDismiss={dismissModeMutation}
          state={modeMutation}
        />
        <MutationFeedback
          onDismiss={dismissTemperatureMutation}
          state={temperatureMutation}
        />
        <MutationFeedback
          onDismiss={dismissFaultMutation}
          state={faultMutation}
        />
        <MutationFeedback
          onDismiss={dismissHeaterMutation}
          state={heaterMutation}
        />

        {connection.status === "online" && snapshot !== null ? (
          <>
            <MachineSnapshot
              faultMutation={faultMutation}
              metricWidth={metricWidth}
              onDismissOverTemperature={dismissOverTemperature}
              snapshot={snapshot}
            />
            <TemperatureCurve
              history={temperatureHistory}
              snapshot={snapshot}
            />
            <MachineControls
              faultMutation={faultMutation}
              heaterMutation={heaterMutation}
              modeMutation={modeMutation}
              onSetMode={setMode}
              onUpdateTemperatureSettings={updateTemperatureSettings}
              snapshot={snapshot}
              temperatureMutation={temperatureMutation}
            />
          </>
        ) : (
          <View style={styles.unavailableCard}>
            <Text selectable style={styles.unavailableTitle}>
              {translate("dashboard.unavailableTitle")}
            </Text>
            <Text selectable style={styles.unavailableText}>
              {translate("dashboard.unavailableText")}
            </Text>
          </View>
        )}

        {connection.status === "online" && snapshot !== null ? (
          <HeaterToggleBar
            disabled={mutationPending}
            mutation={heaterMutation}
            onSetHeaterEnabled={setHeaterEnabled}
            snapshot={snapshot}
          />
        ) : null}

        <View style={styles.contextCard}>
          <Text selectable style={styles.contextTitle}>{translate("dashboard.savedMachine")}</Text>
          <Text selectable style={styles.contextText}>{initialNote}</Text>
          <Text selectable style={styles.deviceId}>{selectedDevice.deviceId}</Text>
          <Text selectable style={styles.address}>
            {selectedDevice.lastSuccessfulAddress}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onForget}
            style={({ pressed }) => [styles.forgetButton, pressed && styles.pressed]}>
            <Text style={styles.forgetButtonText}>{translate("dashboard.forgetMachine")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function TemperatureCurve({
  history,
  snapshot,
}: {
  history: TemperatureSample[];
  snapshot: MachineState;
}) {
  const visibleHistory = history.slice(-72);
  const currentSample: TemperatureSample = {
    activeMode: snapshot.activeMode,
    brewTargetC: snapshot.brewTargetC,
    brewTemperatureC: snapshot.brewTemperatureC,
    heaterActive: snapshot.heaterActive,
    steamTargetC: snapshot.steamTargetC,
    steamTemperatureC: snapshot.steamTemperatureC,
    uptimeMs: snapshot.uptimeMs,
  };
  const displayHistory =
    visibleHistory.length === 0 ? [currentSample] : visibleHistory;
  const values = [
    boilerTemperatureC(snapshot),
    boilerTargetC(snapshot),
    ...displayHistory.flatMap((sample) => [
      boilerTemperatureC(sample),
      boilerTargetC(sample),
    ]),
  ];
  const minimumValue = Math.floor(Math.min(...values) - 1);
  const maximumValue = Math.ceil(Math.max(...values) + 1);

  return (
    <View style={styles.curveCard}>
      <View style={styles.curveHeading}>
        <View style={styles.curveTitleGroup}>
          <Text selectable style={styles.cardLabel}>{translate("dashboard.temperatureCurve")}</Text>
          <Text selectable style={styles.curveTitle}>
            {translate("dashboard.controlTrend", { mode: modeLabel(snapshot.activeMode) })}
          </Text>
        </View>
        <View style={styles.curveWindowPill}>
          <Text selectable style={styles.curveWindowText}>
            {formatHistoryDuration(history)}
          </Text>
        </View>
      </View>

      <View style={styles.curveLegend}>
        <LegendItem color="#8B3A2B" label={translate("dashboard.boiler")} />
        <LegendItem color="#D39A42" label={translate("dashboard.target")} />
        <LegendItem color="#F29A52" label={translate("dashboard.heater")} />
      </View>

      <View style={styles.curvePlot}>
        <View style={styles.curveGridLineTop} />
        <View style={styles.curveGridLineMiddle} />
        <View style={styles.curveGridLineBottom} />
        <View style={styles.curveYAxis}>
          <Text selectable style={styles.curveAxisText}>
            {maximumValue}°
          </Text>
          <Text selectable style={styles.curveAxisText}>
            {minimumValue}°
          </Text>
        </View>
        <LineGraph
          maximumValue={maximumValue}
          minimumValue={minimumValue}
          samples={displayHistory}
        />
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text selectable style={styles.legendText}>{label}</Text>
    </View>
  );
}

interface ChartPoint {
  x: number;
  y: number;
}

function LineGraph({
  maximumValue,
  minimumValue,
  samples,
}: {
  maximumValue: number;
  minimumValue: number;
  samples: TemperatureSample[];
}) {
  const [plotSize, setPlotSize] = useState({ height: 0, width: 0 });
  const readyToDraw = plotSize.width > 0 && plotSize.height > 0;
  const points = readyToDraw
    ? samples.map((sample, index) =>
        samplePoint(
          boilerTemperatureC(sample),
          index,
          samples.length,
          minimumValue,
          maximumValue,
          plotSize,
        ),
      )
    : [];
  const targetPoints = readyToDraw
    ? samples.map((sample, index) =>
        samplePoint(
          boilerTargetC(sample),
          index,
          samples.length,
          minimumValue,
          maximumValue,
          plotSize,
        ),
      )
    : [];
  const heaterBandWidth =
    samples.length <= 1 ? plotSize.width : plotSize.width / samples.length;

  return (
    <View
      accessibilityLabel={translate("dashboard.curveAccessibility", { count: samples.length })}
      onLayout={(event) => {
        const { height, width } = event.nativeEvent.layout;
        setPlotSize({ height, width });
      }}
      style={styles.curveCanvas}>
      {readyToDraw
        ? samples.map((sample, index) =>
            sample.heaterActive ? (
              <View
                key={`heater-${sample.uptimeMs}`}
                style={[
                  styles.heaterPulseBand,
                  {
                    left: Math.max(0, points[index].x - heaterBandWidth / 2),
                    width: Math.max(2, heaterBandWidth),
                  },
                ]}
              />
            ) : null,
          )
        : null}
      {targetPoints.slice(1).map((point, index) => (
        <LineSegment
          color="#D39A42"
          from={targetPoints[index]}
          key={`target-${samples[index + 1].uptimeMs}`}
          thickness={2}
          to={point}
        />
      ))}
      {points.slice(1).map((point, index) => (
        <LineSegment
          color="#8B3A2B"
          from={points[index]}
          key={`boiler-${samples[index + 1].uptimeMs}`}
          thickness={4}
          to={point}
        />
      ))}
      {points.map((point, index) => (
        <View
          key={`dot-${samples[index].uptimeMs}`}
          style={[
            styles.curveDot,
            index === points.length - 1 && styles.currentCurveDot,
            {
              left: point.x - 4,
              top: point.y - 4,
            },
          ]}
        />
      ))}
    </View>
  );
}

function LineSegment({
  color,
  from,
  thickness,
  to,
}: {
  color: string;
  from: ChartPoint;
  thickness: number;
  to: ChartPoint;
}) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const angle = Math.atan2(deltaY, deltaX);

  return (
    <View
      style={[
        styles.lineSegment,
        {
          backgroundColor: color,
          height: thickness,
          left: (from.x + to.x) / 2 - length / 2,
          top: (from.y + to.y) / 2 - thickness / 2,
          transform: [{ rotateZ: `${angle}rad` }],
          width: length,
        },
      ]}
    />
  );
}

function samplePoint(
  value: number,
  index: number,
  count: number,
  minimumValue: number,
  maximumValue: number,
  plotSize: { height: number; width: number },
): ChartPoint {
  const x =
    count <= 1 ? plotSize.width / 2 : (index / (count - 1)) * plotSize.width;
  const topPercent = curvePointTop(value, minimumValue, maximumValue);
  return { x, y: (topPercent / 100) * plotSize.height };
}

function curvePointTop(value: number, minimumValue: number, maximumValue: number) {
  const range = Math.max(1, maximumValue - minimumValue);
  return Math.max(0, Math.min(100, ((maximumValue - value) / range) * 100));
}

function MachineSnapshot({
  faultMutation,
  metricWidth,
  onDismissOverTemperature,
  snapshot,
}: {
  faultMutation: DashboardMutationState;
  metricWidth: "100%" | "48.5%";
  onDismissOverTemperature: () => void;
  snapshot: MachineState;
}) {
  const useAndroidStatusLayout = process.env.EXPO_OS === "android";
  const canDismissOverTemperature =
    snapshot.status === "fault" &&
    snapshot.fault.code === "over_temperature" &&
    boilerTemperatureC(snapshot) <= boilerTargetC(snapshot);
  const dismissPending = faultMutation.status === "pending";
  const confirmDismissOverTemperature = () => {
    Alert.alert(
      translate("dashboard.dismissAlertTitle"),
      translate("dashboard.dismissAlertMessage"),
      [
        { style: "cancel", text: translate("dashboard.cancel") },
        {
          onPress: onDismissOverTemperature,
          style: "destructive",
          text: translate("dashboard.dismiss"),
        },
      ],
    );
  };

  return (
    <>
      <View style={styles.machineStateCard}>
        <Text selectable style={styles.cardLabel}>{translate("dashboard.machineStatus")}</Text>
        <View
          style={[
            styles.machineStateRow,
            useAndroidStatusLayout && styles.machineStateRowAndroid,
          ]}>
          <View
            style={[
              styles.machineStatePrimary,
              useAndroidStatusLayout && styles.machineStatePrimaryAndroid,
            ]}>
            <Text
              adjustsFontSizeToFit={useAndroidStatusLayout}
              minimumFontScale={0.8}
              numberOfLines={useAndroidStatusLayout ? 1 : undefined}
              selectable
              style={[
                styles.machineStateValue,
                snapshot.status === "fault" && styles.faultText,
              ]}>
              {machineActivityLabel(snapshot)}
            </Text>
            {!useAndroidStatusLayout ? (
              <MachineModeLabel mode={snapshot.activeMode} />
            ) : null}
          </View>
          {useAndroidStatusLayout ? (
            <View style={styles.machineStateFooterAndroid}>
              <MachineModeLabel mode={snapshot.activeMode} />
              <HeaterStatusPill heaterActive={snapshot.heaterActive} />
            </View>
          ) : (
            <HeaterStatusPill heaterActive={snapshot.heaterActive} />
          )}
        </View>
      </View>

      {snapshot.status === "fault" ? (
        <View accessibilityLiveRegion="assertive" style={styles.faultCard}>
          <Text selectable style={styles.faultEyebrow}>{translate("dashboard.firmwareFault")}</Text>
          <Text selectable style={styles.faultTitle}>
            {faultLabel(snapshot.fault.code)}
          </Text>
          <Text selectable style={styles.faultMessage}>{snapshot.fault.message}</Text>
          <Text selectable style={styles.faultSafety}>{translate("dashboard.heaterCommandOff")}</Text>
          {snapshot.fault.code === "over_temperature" ? (
            <>
              <Text selectable style={styles.faultRecoveryText}>
                {canDismissOverTemperature
                  ? translate("dashboard.boilerBackAtTarget")
                  : translate("dashboard.dismissalLocked", {
                      current: formatTemperature(boilerTemperatureC(snapshot)),
                      target: formatTarget(boilerTargetC(snapshot)),
                    })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  disabled: !canDismissOverTemperature || dismissPending,
                }}
                disabled={!canDismissOverTemperature || dismissPending}
                onPress={confirmDismissOverTemperature}
                style={({ pressed }) => [
                  styles.faultRecoveryButton,
                  (!canDismissOverTemperature || dismissPending) && styles.disabled,
                  pressed &&
                    canDismissOverTemperature &&
                    !dismissPending &&
                    styles.pressed,
                ]}>
                <Text style={styles.faultRecoveryButtonText}>
                  {dismissPending ? translate("dashboard.dismissing") : translate("dashboard.dismissOverTemperature")}
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}

      <View style={styles.metricGrid}>
        <TemperatureCard
          mode={snapshot.activeMode}
          targetC={boilerTargetC(snapshot)}
          temperatureC={boilerTemperatureC(snapshot)}
          width="100%"
        />
      </View>

      <View style={styles.metricGrid}>
        <ContextMetric
          label={translate("dashboard.steamTimer")}
          value={formatSteamCountdown(snapshot.steamTimeoutRemainingMs)}
          detail={steamCountdownContext(snapshot)}
          width={metricWidth}
        />
        <ContextMetric
          label={translate("dashboard.machineUptime")}
          value={formatUptime(snapshot.uptimeMs)}
          detail={translate("dashboard.uptimeDetail")}
          width={metricWidth}
        />
      </View>
    </>
  );
}

function MachineModeLabel({ mode }: { mode: MachineState["activeMode"] }) {
  return (
    <Text selectable style={styles.machineStateDetail}>
      {translate("dashboard.mode", { mode: modeLabel(mode) })}
    </Text>
  );
}

function HeaterStatusPill({ heaterActive }: { heaterActive: boolean }) {
  return (
    <View style={styles.heaterPill}>
      <View
        style={[
          styles.heaterDot,
          heaterActive ? styles.heaterOn : styles.heaterOff,
        ]}
      />
      <Text selectable style={styles.heaterText}>
        {translate("dashboard.heaterState", {
          state: translate(heaterActive ? "dashboard.on" : "dashboard.off"),
        })}
      </Text>
    </View>
  );
}

function TemperatureCard({
  mode,
  targetC,
  temperatureC,
  width,
}: {
  mode: MachineState["activeMode"];
  targetC: number;
  temperatureC: number;
  width: "100%" | "48.5%";
}) {
  return (
    <View style={[styles.temperatureCard, { width }, styles.activeCard]}>
      <View style={styles.temperatureHeading}>
        <Text selectable style={styles.temperatureLabel}>{translate("dashboard.boiler")}</Text>
        <Text selectable style={styles.activePill}>
          {modeLabel(mode).toUpperCase()}
        </Text>
      </View>
      <Text selectable style={styles.temperatureValue}>
        {formatTemperature(temperatureC)}
      </Text>
      <Text selectable style={styles.temperatureTarget}>
        {translate("dashboard.target")} {formatTarget(targetC)}
      </Text>
    </View>
  );
}

function ContextMetric({
  detail,
  label,
  value,
  width,
}: {
  detail: string;
  label: string;
  value: string;
  width: "100%" | "48.5%";
}) {
  return (
    <View style={[styles.contextMetric, { width }]}>
      <Text selectable style={styles.contextMetricLabel}>{label}</Text>
      <Text selectable style={styles.contextMetricValue}>{value}</Text>
      <Text selectable style={styles.contextMetricDetail}>{detail}</Text>
    </View>
  );
}

function HeaterToggleBar({
  disabled,
  mutation,
  onSetHeaterEnabled,
  snapshot,
}: {
  disabled: boolean;
  mutation: DashboardMutationState;
  onSetHeaterEnabled: (heaterEnabled: boolean) => void;
  snapshot: MachineState;
}) {
  const pending = mutation.status === "pending";
  const switchDisabled = disabled || pending;
  const label = translate(snapshot.heaterEnabled ? "dashboard.heaterEnabled" : "dashboard.heaterOff");
  const detail = snapshot.heaterEnabled
    ? snapshot.heaterActive
      ? translate("dashboard.ssrActive")
      : translate("dashboard.automaticControlAllowed")
    : translate("dashboard.ssrInhibited");

  return (
    <View style={styles.heaterToggleBar}>
      <View style={styles.heaterToggleCopy}>
        <Text selectable style={styles.heaterToggleLabel}>
          {pending ? translate("dashboard.heaterChangePending") : label}
        </Text>
        <Text selectable style={styles.heaterToggleDetail}>
          {pending ? mutation.message : detail}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="switch"
        accessibilityState={{
          checked: snapshot.heaterEnabled,
          disabled: switchDisabled,
        }}
        disabled={switchDisabled}
        onPress={() => onSetHeaterEnabled(!snapshot.heaterEnabled)}
        style={({ pressed }) => [
          styles.heaterSwitch,
          snapshot.heaterEnabled && styles.heaterSwitchOn,
          switchDisabled && styles.disabled,
          pressed && !switchDisabled && styles.pressed,
        ]}>
        <View
          style={[
            styles.heaterSwitchThumb,
            snapshot.heaterEnabled && styles.heaterSwitchThumbOn,
          ]}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F4F0E8", flex: 1 },
  content: {
    backgroundColor: "#F4F0E8",
    flexGrow: 1,
    gap: 16,
    padding: 20,
    paddingBottom: 44,
    paddingTop: 72,
  },
  pageHeader: { alignItems: "center", minHeight: 34 },
  pageTitle: { color: "#241B17", fontSize: 22, fontWeight: "800" },
  intro: { gap: 7, paddingHorizontal: 2, paddingTop: 8 },
  eyebrow: { color: "#8B3A2B", fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  lead: { color: "#332A25", fontSize: 17, lineHeight: 24 },
  connectionCard: {
    borderCurve: "continuous",
    borderRadius: 18,
    borderWidth: 1,
    gap: 7,
    padding: 16,
  },
  connectionOnline: { backgroundColor: "#E5F1E8", borderColor: "#A9C9B0" },
  connectionUnavailable: { backgroundColor: "#F3E6DC", borderColor: "#D3B9A7" },
  statusHeading: { alignItems: "center", flexDirection: "row", gap: 9 },
  statusDot: { borderRadius: 999, height: 9, width: 9 },
  statusDotOnline: { backgroundColor: "#2D7547" },
  statusDotUnavailable: { backgroundColor: "#A54B36" },
  connectionLabel: { color: "#241B17", flex: 1, fontSize: 16, fontWeight: "800" },
  connectionDetail: { color: "#5B4D44", fontSize: 14, lineHeight: 20 },
  machineStateCard: {
    backgroundColor: "#241B17",
    borderCurve: "continuous",
    borderRadius: 22,
    gap: 12,
    padding: 20,
  },
  cardLabel: { color: "#CDBFB5", fontSize: 11, fontWeight: "800", letterSpacing: 1.3 },
  machineStateRow: { alignItems: "flex-end", flexDirection: "row", gap: 14, justifyContent: "space-between" },
  machineStateRowAndroid: { alignItems: "stretch", flexDirection: "column", gap: 8 },
  machineStatePrimary: { flex: 1, gap: 4 },
  machineStatePrimaryAndroid: { flex: undefined },
  machineStateFooterAndroid: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  machineStateValue: { color: "#FFF9F1", fontSize: 34, fontWeight: "800", letterSpacing: -0.7 },
  machineStateDetail: { color: "#D9CBC1", fontSize: 16, fontWeight: "600" },
  faultText: { color: "#FFB5A5" },
  heaterPill: { alignItems: "center", backgroundColor: "#3C312C", borderRadius: 999, flexDirection: "row", gap: 7, paddingHorizontal: 11, paddingVertical: 8 },
  heaterDot: { borderRadius: 999, height: 8, width: 8 },
  heaterOn: { backgroundColor: "#F29A52" },
  heaterOff: { backgroundColor: "#9A8E86" },
  heaterText: { color: "#FFF9F1", fontSize: 13, fontWeight: "700" },
  faultCard: {
    backgroundColor: "#F8DDD7",
    borderColor: "#CC7766",
    borderCurve: "continuous",
    borderRadius: 20,
    borderWidth: 1,
    gap: 7,
    padding: 18,
  },
  faultEyebrow: { color: "#8C2F24", fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  faultTitle: { color: "#6F211A", fontSize: 22, fontWeight: "800" },
  faultMessage: { color: "#6F2F28", fontSize: 15, lineHeight: 21 },
  faultSafety: { color: "#6F211A", fontSize: 14, fontWeight: "800" },
  faultRecoveryText: { color: "#6F2F28", fontSize: 14, lineHeight: 20 },
  faultRecoveryButton: {
    alignItems: "center",
    backgroundColor: "#8C2F24",
    borderColor: "#8C2F24",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 4,
    minHeight: 46,
    paddingHorizontal: 16,
  },
  faultRecoveryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  curveCard: {
    backgroundColor: "#FFFCF7",
    borderColor: "#D7C9B8",
    borderCurve: "continuous",
    borderRadius: 20,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  curveHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  curveTitleGroup: { flex: 1, gap: 5 },
  curveTitle: { color: "#2C231E", fontSize: 20, fontWeight: "800" },
  curveWindowPill: {
    backgroundColor: "#EFE6DA",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  curveWindowText: {
    color: "#5D5048",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
  },
  curveLegend: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  legendItem: { alignItems: "center", flexDirection: "row", gap: 6 },
  legendSwatch: { borderRadius: 999, height: 8, width: 8 },
  legendText: { color: "#5D5048", fontSize: 12, fontWeight: "700" },
  curvePlot: {
    backgroundColor: "#F7F1E9",
    borderColor: "#E0D4C7",
    borderCurve: "continuous",
    borderRadius: 14,
    borderWidth: 1,
    height: 180,
    overflow: "hidden",
    position: "relative",
  },
  curveGridLineTop: {
    backgroundColor: "#E5D8CA",
    height: 1,
    left: 40,
    position: "absolute",
    right: 0,
    top: "18%",
  },
  curveGridLineMiddle: {
    backgroundColor: "#E5D8CA",
    height: 1,
    left: 40,
    position: "absolute",
    right: 0,
    top: "50%",
  },
  curveGridLineBottom: {
    backgroundColor: "#E5D8CA",
    bottom: "18%",
    height: 1,
    left: 40,
    position: "absolute",
    right: 0,
  },
  curveYAxis: {
    bottom: 12,
    justifyContent: "space-between",
    left: 10,
    position: "absolute",
    top: 12,
    width: 28,
  },
  curveAxisText: {
    color: "#7B6D63",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },
  curveCanvas: {
    bottom: 42,
    left: 42,
    position: "absolute",
    right: 10,
    top: 10,
  },
  lineSegment: {
    borderRadius: 999,
    position: "absolute",
  },
  curveDot: {
    backgroundColor: "#8B3A2B",
    borderColor: "#F7F1E9",
    borderRadius: 999,
    borderWidth: 2,
    height: 8,
    position: "absolute",
    width: 8,
  },
  currentCurveDot: {
    backgroundColor: "#F7F1E9",
    borderColor: "#8B3A2B",
    height: 11,
    width: 11,
  },
  heaterPulseBand: {
    backgroundColor: "#F29A52",
    borderRadius: 999,
    bottom: -30,
    height: 8,
    position: "absolute",
  },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  temperatureCard: {
    backgroundColor: "#FFFCF7",
    borderColor: "#DDD3C7",
    borderCurve: "continuous",
    borderRadius: 22,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  activeCard: { borderColor: "#A14B37", borderWidth: 2, padding: 17 },
  temperatureHeading: { alignItems: "center", flexDirection: "row", gap: 10, justifyContent: "space-between" },
  temperatureLabel: { color: "#4A3E37", fontSize: 17, fontWeight: "800" },
  activePill: { backgroundColor: "#8B3A2B", borderRadius: 999, color: "#FFFFFF", fontSize: 10, fontWeight: "900", letterSpacing: 0.7, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5 },
  temperatureValue: { color: "#241B17", fontSize: 46, fontVariant: ["tabular-nums"], fontWeight: "800", letterSpacing: -1.5 },
  temperatureTarget: { color: "#6B5B51", fontSize: 15, fontVariant: ["tabular-nums"], fontWeight: "600" },
  contextMetric: {
    backgroundColor: "#EAE2D7",
    borderCurve: "continuous",
    borderRadius: 18,
    gap: 6,
    padding: 17,
  },
  contextMetricLabel: { color: "#695A50", fontSize: 12, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  contextMetricValue: { color: "#2C231E", fontSize: 25, fontVariant: ["tabular-nums"], fontWeight: "800" },
  contextMetricDetail: { color: "#695A50", fontSize: 13, lineHeight: 18 },
  unavailableCard: {
    backgroundColor: "#FFFCF7",
    borderColor: "#DDD3C7",
    borderCurve: "continuous",
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 20,
  },
  unavailableTitle: { color: "#2C231E", fontSize: 20, fontWeight: "800" },
  unavailableText: { color: "#695A50", fontSize: 15, lineHeight: 21 },
  contextCard: {
    backgroundColor: "#FFFCF7",
    borderColor: "#DDD3C7",
    borderCurve: "continuous",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 17,
  },
  contextTitle: { color: "#2C231E", fontSize: 17, fontWeight: "800" },
  contextText: { color: "#5D5048", fontSize: 14, lineHeight: 20 },
  deviceId: { color: "#6C5F56", fontFamily: "monospace", fontSize: 12 },
  address: { color: "#8B3A2B", fontSize: 13, fontWeight: "700" },
  forgetButton: { alignItems: "center", borderColor: "#8B3A2B", borderRadius: 999, borderWidth: 1, justifyContent: "center", marginTop: 6, minHeight: 46, paddingHorizontal: 18 },
  forgetButtonText: { color: "#8B3A2B", fontSize: 15, fontWeight: "800" },
  heaterToggleBar: {
    alignItems: "center",
    backgroundColor: "#241B17",
    borderColor: "#4B3A31",
    borderCurve: "continuous",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between",
    padding: 16,
  },
  heaterToggleCopy: { flex: 1, gap: 3 },
  heaterToggleLabel: { color: "#FFF9F1", fontSize: 17, fontWeight: "800" },
  heaterToggleDetail: { color: "#D9CBC1", fontSize: 13, lineHeight: 18 },
  heaterSwitch: {
    backgroundColor: "#7B6D63",
    borderRadius: 999,
    height: 36,
    justifyContent: "center",
    padding: 3,
    width: 64,
  },
  heaterSwitchOn: { backgroundColor: "#2D7547" },
  heaterSwitchThumb: {
    backgroundColor: "#FFF9F1",
    borderRadius: 999,
    height: 30,
    width: 30,
  },
  heaterSwitchThumbOn: { alignSelf: "flex-end" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.42 },
});
