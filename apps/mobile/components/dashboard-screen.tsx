import type { MachineState } from "@philcoino/protocol";
import { Stack } from "expo-router";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { useMachineDashboard } from "@/hooks/use-machine-dashboard";
import { createDeviceApiClient } from "@/src/networking/expo-device-api-client";
import {
  connectionCopy,
  faultLabel,
  formatSteamCountdown,
  formatTarget,
  formatTemperature,
  formatUptime,
  machineStatusLabel,
  modeLabel,
  steamCountdownContext,
} from "@/src/dashboard/dashboard-view-model";
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
  const client = useMemo(
    () =>
      createDeviceApiClient({
        address: selectedDevice.lastSuccessfulAddress,
        token: selectedDevice.token,
      }),
    [selectedDevice.lastSuccessfulAddress, selectedDevice.token],
  );
  const { connection, snapshot } = useMachineDashboard(client);
  const { width } = useWindowDimensions();
  const connectionContent = connectionCopy(connection);
  const metricWidth = width >= 700 ? "48.5%" : "100%";

  return (
    <>
      <Stack.Screen options={{ title: deviceName }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}>
        <View style={styles.intro}>
          <Text selectable style={styles.eyebrow}>LIVE MACHINE</Text>
          <Text selectable style={styles.lead}>
            Temperatures and safety state reported by the machine.
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
              App connection · {connectionContent.label}
            </Text>
            {connection.status === "connecting" ? (
              <ActivityIndicator accessibilityLabel="Connecting" size="small" />
            ) : null}
          </View>
          <Text selectable style={styles.connectionDetail}>
            {connectionContent.detail}
          </Text>
        </View>

        {connection.status === "online" && snapshot !== null ? (
          <MachineSnapshot snapshot={snapshot} metricWidth={metricWidth} />
        ) : (
          <View style={styles.unavailableCard}>
            <Text selectable style={styles.unavailableTitle}>
              Machine status unavailable
            </Text>
            <Text selectable style={styles.unavailableText}>
              No cached values are shown as live data. The app will keep trying while this screen is active.
            </Text>
          </View>
        )}

        <View style={styles.contextCard}>
          <Text selectable style={styles.contextTitle}>Saved machine</Text>
          <Text selectable style={styles.contextText}>{initialNote}</Text>
          <Text selectable style={styles.deviceId}>{selectedDevice.deviceId}</Text>
          <Text selectable style={styles.address}>
            {selectedDevice.lastSuccessfulAddress}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onForget}
            style={({ pressed }) => [styles.forgetButton, pressed && styles.pressed]}>
            <Text style={styles.forgetButtonText}>Forget this machine</Text>
          </Pressable>
        </View>
      </ScrollView>
    </>
  );
}

function MachineSnapshot({
  metricWidth,
  snapshot,
}: {
  metricWidth: "100%" | "48.5%";
  snapshot: MachineState;
}) {
  return (
    <>
      <View style={styles.machineStateCard}>
        <Text selectable style={styles.cardLabel}>MACHINE STATUS</Text>
        <View style={styles.machineStateRow}>
          <View style={styles.machineStatePrimary}>
            <Text
              selectable
              style={[
                styles.machineStateValue,
                snapshot.status === "fault" && styles.faultText,
              ]}>
              {machineStatusLabel(snapshot.status)}
            </Text>
            <Text selectable style={styles.machineStateDetail}>
              {modeLabel(snapshot.activeMode)} mode
            </Text>
          </View>
          <View style={styles.heaterPill}>
            <View
              style={[
                styles.heaterDot,
                snapshot.heaterActive ? styles.heaterOn : styles.heaterOff,
              ]}
            />
            <Text selectable style={styles.heaterText}>
              Heater {snapshot.heaterActive ? "on" : "off"}
            </Text>
          </View>
        </View>
      </View>

      {snapshot.status === "fault" ? (
        <View accessibilityLiveRegion="assertive" style={styles.faultCard}>
          <Text selectable style={styles.faultEyebrow}>FIRMWARE FAULT</Text>
          <Text selectable style={styles.faultTitle}>
            {faultLabel(snapshot.fault.code)}
          </Text>
          <Text selectable style={styles.faultMessage}>{snapshot.fault.message}</Text>
          <Text selectable style={styles.faultSafety}>Heater command is off.</Text>
        </View>
      ) : null}

      <View style={styles.metricGrid}>
        <TemperatureCard
          active={snapshot.activeMode === "brew"}
          label="Brew"
          targetC={snapshot.brewTargetC}
          temperatureC={snapshot.brewTemperatureC}
          width={metricWidth}
        />
        <TemperatureCard
          active={snapshot.activeMode === "steam"}
          label="Steam"
          targetC={snapshot.steamTargetC}
          temperatureC={snapshot.steamTemperatureC}
          width={metricWidth}
        />
      </View>

      <View style={styles.metricGrid}>
        <ContextMetric
          label="Steam timer"
          value={formatSteamCountdown(snapshot.steamTimeoutRemainingMs)}
          detail={steamCountdownContext(snapshot)}
          width={metricWidth}
        />
        <ContextMetric
          label="Machine uptime"
          value={formatUptime(snapshot.uptimeMs)}
          detail="Since the last machine power cycle"
          width={metricWidth}
        />
      </View>
    </>
  );
}

function TemperatureCard({
  active,
  label,
  targetC,
  temperatureC,
  width,
}: {
  active: boolean;
  label: string;
  targetC: number;
  temperatureC: number;
  width: "100%" | "48.5%";
}) {
  return (
    <View style={[styles.temperatureCard, { width }, active && styles.activeCard]}>
      <View style={styles.temperatureHeading}>
        <Text selectable style={styles.temperatureLabel}>{label}</Text>
        {active ? <Text selectable style={styles.activePill}>ACTIVE</Text> : null}
      </View>
      <Text selectable style={styles.temperatureValue}>
        {formatTemperature(temperatureC)}
      </Text>
      <Text selectable style={styles.temperatureTarget}>
        Target {formatTarget(targetC)}
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

const styles = StyleSheet.create({
  content: {
    backgroundColor: "#F4F0E8",
    flexGrow: 1,
    gap: 16,
    padding: 20,
    paddingBottom: 44,
  },
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
  machineStatePrimary: { flex: 1, gap: 4 },
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
  pressed: { opacity: 0.7 },
});
