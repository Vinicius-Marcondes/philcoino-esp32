import type {
  CooldownOutcome,
  CooldownState,
  MachineStateV2,
} from "@philcoino/protocol";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { CompensationIndicator } from "@/components/compensation-indicator";
import {
  faultDetail,
  formatTarget,
  formatTemperature,
} from "@/src/dashboard/dashboard-view-model";
import {
  createThermalWorkflowPreviewState,
  finishStabilizationPreview,
  formatThermalPreviewTime,
  showCompensationActivePreview,
  showCooldownConfirmation,
  showCutoffPreview,
  showDisconnectedPreview,
  showFailurePreview,
  showRejectedPreview,
  showSteamBlockedPreview,
  showTargetReachedPreview,
  startCooldownPreview,
  stopCooldownPreview,
  type ThermalPreviewScenario,
  type ThermalWorkflowPreviewState,
} from "@/src/debug/thermal-workflow-preview-model";
import { translate } from "@/src/localization/i18n";

interface ThermalWorkflowPreviewProps {
  onOpenMachine: () => void;
}

interface ThermalWorkflowStatusProps {
  mutationPending: boolean;
  onOpenMachine: () => void;
  onStartCooldown: () => void;
  onStopCooldown: () => void;
  snapshot: MachineStateV2;
}

export function ThermalWorkflowStatus({
  mutationPending,
  onOpenMachine,
  onStartCooldown,
  onStopCooldown,
  snapshot,
}: ThermalWorkflowStatusProps) {
  const [confirmingCooldown, setConfirmingCooldown] = useState(false);
  const cooldownActive = snapshot.cooldown.status !== "idle";
  const startBlocked =
    mutationPending ||
    snapshot.extraction.status === "running" ||
    snapshot.machine.status === "fault";

  const confirmCooldown = () => {
    if (startBlocked || cooldownActive) {
      return;
    }
    setConfirmingCooldown(false);
    onStartCooldown();
  };

  return (
    <View style={styles.section}>
      {snapshot.machine.activeMode === "steam" && !cooldownActive ? (
        <SteamBlockedCard onOpenMachine={onOpenMachine} />
      ) : null}
      {snapshot.cooldown.status === "idle" &&
      snapshot.cooldown.outcome === "failed" ? (
        <FailureCard snapshot={snapshot} />
      ) : null}
      {confirmingCooldown && snapshot.cooldown.status === "idle" ? (
        <ConfirmationCard
          confirmDisabled={startBlocked}
          onCancel={() => setConfirmingCooldown(false)}
          onConfirm={confirmCooldown}
          snapshot={snapshot}
        />
      ) : (
        <CooldownCard
          actionDisabled={startBlocked}
          onOpenConfirmation={() => setConfirmingCooldown(true)}
          onStop={onStopCooldown}
          snapshot={snapshot}
          stopDisabled={mutationPending}
        />
      )}
    </View>
  );
}

export function ThermalWorkflowPreview({
  onOpenMachine,
}: ThermalWorkflowPreviewProps) {
  const [state, setState] = useState(createThermalWorkflowPreviewState);
  const snapshot = state.snapshot;

  return (
    <View style={styles.section}>
      <View accessibilityLiveRegion="assertive" style={styles.previewBanner}>
        <Text selectable style={styles.previewEyebrow}>
          {translate("thermalPreview.eyebrow")}
        </Text>
        <Text selectable style={styles.previewTitle}>
          {translate("thermalPreview.title")}
        </Text>
        <Text selectable style={styles.previewWarning}>
          {translate("thermalPreview.warning")}
        </Text>
      </View>

      {snapshot === null ? (
        <DisconnectedCard />
      ) : (
        <>
          <CompensationIndicator compensation={snapshot.compensation} />
          {state.scenario === "steam-blocked" ? (
            <SteamBlockedCard onOpenMachine={onOpenMachine} />
          ) : null}
          {state.scenario === "rejected" ? <RejectedCard /> : null}
          {state.scenario === "failed" ? <FailureCard snapshot={snapshot} /> : null}
          {state.scenario === "confirmation" ? (
            <ConfirmationCard
              onCancel={() => setState(createThermalWorkflowPreviewState())}
              onConfirm={() => setState(startCooldownPreview())}
              snapshot={snapshot}
            />
          ) : null}
          {state.scenario !== "confirmation" && state.scenario !== "failed" ? (
            <CooldownCard
              onFinish={() => setState((current) => finishStabilizationPreview(current))}
              onOpenConfirmation={() =>
                setState((current) => showCooldownConfirmation(current))
              }
              onShowCutoff={() => setState(showCutoffPreview())}
              onShowTarget={() => setState(showTargetReachedPreview())}
              onStop={() => setState((current) => stopCooldownPreview(current))}
              snapshot={snapshot}
            />
          ) : null}
        </>
      )}

      <ScenarioControls state={state} onChange={setState} />
    </View>
  );
}

function CooldownCard({
  actionDisabled = false,
  onFinish,
  onOpenConfirmation,
  onShowCutoff,
  onShowTarget,
  onStop,
  snapshot,
  stopDisabled = false,
}: {
  actionDisabled?: boolean;
  onFinish?: () => void;
  onOpenConfirmation: () => void;
  onShowCutoff?: () => void;
  onShowTarget?: () => void;
  onStop: () => void;
  snapshot: MachineStateV2;
  stopDisabled?: boolean;
}) {
  const cooldown = snapshot.cooldown;
  if (cooldown.status === "idle") {
    return (
      <View style={styles.cooldownActionCard}>
        {cooldown.outcome !== null ? (
          <OutcomeSummary cooldown={cooldown} />
        ) : null}
        <Text selectable style={styles.cooldownEyebrow}>
          {translate("thermalPreview.cooldownLabel")}
        </Text>
        <Text selectable style={styles.actionTitle}>
          {translate("thermalPreview.cooldownActionTitle")}
        </Text>
        <Text selectable style={styles.actionDetail}>
          {translate("thermalPreview.cooldownActionDetail")}
        </Text>
        <PrimaryButton
          disabled={actionDisabled}
          label={translate("thermalPreview.cooldownButton")}
          onPress={onOpenConfirmation}
        />
      </View>
    );
  }

  return (
    <View accessibilityLiveRegion="polite" style={styles.activeCooldownCard}>
      <StatusHeader
        dark
        label={translate("thermalPreview.cooldownLabel")}
        status={translate(
          cooldown.status === "pumping"
            ? "thermalPreview.pumping"
            : "thermalPreview.stabilizing",
        )}
      />
      <Text selectable style={styles.activeTitle}>
        {translate(
          cooldown.status === "pumping"
            ? "thermalPreview.pumpingTitle"
            : "thermalPreview.stabilizingTitle",
        )}
      </Text>
      {cooldown.status === "stabilizing" ? (
        <Text selectable style={styles.activeOutcome}>
          {outcomeLabel(cooldown.outcome)}
        </Text>
      ) : null}
      <View style={styles.metricGrid}>
        <Metric
          dark
          label={translate("thermalPreview.elapsed")}
          value={formatThermalPreviewTime(cooldown.elapsedMs)}
        />
        <Metric
          dark
          label={translate("thermalPreview.remaining")}
          value={formatThermalPreviewTime(cooldown.remainingMs)}
        />
        <Metric
          dark
          label={translate("thermalPreview.pumpCommand")}
          value={translate(
            cooldown.pumpCommand === "running"
              ? "thermalPreview.commandRunning"
              : "thermalPreview.commandOff",
          )}
        />
        <Metric
          dark
          label={translate("thermalPreview.heaterControl")}
          value={translate("thermalPreview.heaterInhibited")}
        />
      </View>
      <Text selectable style={styles.commandBoundaryDark}>
        {translate("thermalPreview.commandBoundary")}
      </Text>
      {cooldown.status === "pumping" ? (
        <>
          <PrimaryButton
            destructive
            disabled={stopDisabled}
            label={translate("thermalPreview.stop")}
            onPress={onStop}
          />
          {onShowTarget && onShowCutoff ? (
            <View style={styles.secondaryActions}>
              <SecondaryButton
                label={translate("thermalPreview.reviewTargetReached")}
                onPress={onShowTarget}
              />
              <SecondaryButton
                label={translate("thermalPreview.reviewCutoff")}
                onPress={onShowCutoff}
              />
            </View>
          ) : null}
        </>
      ) : onFinish ? (
        <PrimaryButton
          label={translate("thermalPreview.finishStabilization")}
          onPress={onFinish}
        />
      ) : null}
    </View>
  );
}

function ConfirmationCard({
  confirmDisabled = false,
  onCancel,
  onConfirm,
  snapshot,
}: {
  confirmDisabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  snapshot: MachineStateV2;
}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={styles.confirmationCard}>
      <Text selectable style={styles.actionEyebrow}>
        {translate("thermalPreview.confirmEyebrow")}
      </Text>
      <Text selectable style={styles.confirmationTitle}>
        {translate("thermalPreview.confirmTitle")}
      </Text>
      <Text selectable style={styles.bodyText}>
        {translate("thermalPreview.confirmLead")}
      </Text>
      <View style={styles.metricGrid}>
        <Metric
          label={translate("thermalPreview.currentTemperature")}
          value={formatTemperature(snapshot.machine.boilerTemperatureC)}
        />
        <Metric
          label={translate("thermalPreview.brewThreshold")}
          value={formatTarget(snapshot.machine.brewTargetC)}
        />
      </View>
      <WarningRow text={translate("thermalPreview.waterWarning")} />
      <WarningRow text={translate("thermalPreview.limitWarning")} />
      <WarningRow text={translate("thermalPreview.feedbackWarning")} />
      <Text selectable style={styles.commandBoundary}>
        {translate("thermalPreview.confirmBoundary")}
      </Text>
      <View style={styles.actionRow}>
        <SecondaryButton
          label={translate("thermalPreview.cancel")}
          onPress={onCancel}
        />
        <PrimaryButton
          disabled={confirmDisabled}
          label={translate("thermalPreview.confirmStart")}
          onPress={onConfirm}
        />
      </View>
    </View>
  );
}

function SteamBlockedCard({ onOpenMachine }: { onOpenMachine: () => void }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.warningCard}>
      <Text selectable style={styles.warningEyebrow}>
        {translate("thermalPreview.extractionBlocked")}
      </Text>
      <Text selectable style={styles.cardTitle}>
        {translate("thermalPreview.steamBlockedTitle")}
      </Text>
      <Text selectable style={styles.bodyText}>
        {translate("thermalPreview.steamBlockedDetail")}
      </Text>
      <SecondaryButton
        label={translate("thermalPreview.openMachine")}
        onPress={onOpenMachine}
      />
    </View>
  );
}

function RejectedCard() {
  return (
    <View accessibilityLiveRegion="polite" style={styles.warningCard}>
      <Text selectable style={styles.warningEyebrow}>
        {translate("thermalPreview.rejected")}
      </Text>
      <Text selectable style={styles.cardTitle}>
        {translate("thermalPreview.rejectedTitle")}
      </Text>
      <Text selectable style={styles.bodyText}>
        {translate("thermalPreview.rejectedDetail")}
      </Text>
    </View>
  );
}

function FailureCard({ snapshot }: { snapshot: MachineStateV2 }) {
  return (
    <View accessibilityLiveRegion="assertive" style={styles.failureCard}>
      <Text selectable style={styles.failureEyebrow}>
        {translate("thermalPreview.failed")}
      </Text>
      <Text selectable style={styles.failureTitle}>
        {translate("thermalPreview.failureTitle")}
      </Text>
      <Text selectable style={styles.failureText}>
        {snapshot.machine.fault
          ? faultDetail(snapshot.machine.fault.code)
          : translate("thermalPreview.failureDetail")}
      </Text>
      <Text selectable style={styles.failureSafety}>
        {translate("thermalPreview.failureSafety")}
      </Text>
    </View>
  );
}

function DisconnectedCard() {
  return (
    <View accessibilityLiveRegion="assertive" style={styles.warningCard}>
      <Text selectable style={styles.warningEyebrow}>
        {translate("thermalPreview.disconnected")}
      </Text>
      <Text selectable style={styles.cardTitle}>
        {translate("thermalPreview.disconnectedTitle")}
      </Text>
      <Text selectable style={styles.bodyText}>
        {translate("thermalPreview.disconnectedDetail")}
      </Text>
    </View>
  );
}

function OutcomeSummary({ cooldown }: { cooldown: CooldownState & { status: "idle" } }) {
  if (cooldown.outcome === null) {
    return null;
  }
  return (
    <View accessibilityLiveRegion="polite" style={styles.outcomeSummary}>
      <Text selectable style={styles.outcomeEyebrow}>
        {translate("thermalPreview.lastOutcome")}
      </Text>
      <Text selectable style={styles.outcomeTitle}>
        {outcomeLabel(cooldown.outcome)}
      </Text>
      <Text selectable style={styles.outcomeDetail}>
        {translate("thermalPreview.completedDetail", {
          elapsed: formatThermalPreviewTime(cooldown.elapsedMs),
        })}
      </Text>
    </View>
  );
}

const scenarioActions: {
  id: ThermalPreviewScenario;
  labelKey: string;
  create: () => ThermalWorkflowPreviewState;
}[] = [
  { id: "idle", labelKey: "thermalPreview.scenarios.idle", create: createThermalWorkflowPreviewState },
  { id: "compensation-active", labelKey: "thermalPreview.scenarios.compensation", create: showCompensationActivePreview },
  { id: "steam-blocked", labelKey: "thermalPreview.scenarios.steam", create: showSteamBlockedPreview },
  { id: "pumping", labelKey: "thermalPreview.scenarios.pumping", create: startCooldownPreview },
  { id: "stabilizing-target", labelKey: "thermalPreview.scenarios.target", create: showTargetReachedPreview },
  { id: "stabilizing-cutoff", labelKey: "thermalPreview.scenarios.cutoff", create: showCutoffPreview },
  { id: "rejected", labelKey: "thermalPreview.scenarios.rejected", create: showRejectedPreview },
  { id: "failed", labelKey: "thermalPreview.scenarios.failed", create: showFailurePreview },
  { id: "disconnected", labelKey: "thermalPreview.scenarios.disconnected", create: showDisconnectedPreview },
];

function ScenarioControls({
  onChange,
  state,
}: {
  onChange: (state: ThermalWorkflowPreviewState) => void;
  state: ThermalWorkflowPreviewState;
}) {
  return (
    <View style={styles.scenarioCard}>
      <Text selectable style={styles.actionEyebrow}>
        {translate("thermalPreview.debugStates")}
      </Text>
      <Text selectable style={styles.bodyText}>
        {translate("thermalPreview.debugStatesDetail")}
      </Text>
      <View accessibilityRole="radiogroup" style={styles.scenarioGrid}>
        {scenarioActions.map((action) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: state.scenario === action.id }}
            key={action.id}
            onPress={() => onChange(action.create())}
            style={({ pressed }) => [
              styles.scenarioButton,
              state.scenario === action.id && styles.scenarioButtonSelected,
              pressed && styles.pressed,
            ]}>
            <Text
              style={[
                styles.scenarioButtonText,
                state.scenario === action.id && styles.scenarioButtonTextSelected,
              ]}>
              {translate(action.labelKey)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function StatusHeader({
  dark = false,
  label,
  status,
}: {
  dark?: boolean;
  label: string;
  status: string;
}) {
  return (
    <View style={styles.statusHeader}>
      <Text selectable style={[styles.statusLabel, dark && styles.statusLabelDark]}>
        {label}
      </Text>
      <View style={[styles.statusPill, dark && styles.statusPillDark]}>
        <Text selectable style={[styles.statusPillText, dark && styles.statusPillTextDark]}>
          {status}
        </Text>
      </View>
    </View>
  );
}

function Metric({
  dark = false,
  label,
  value,
}: {
  dark?: boolean;
  label: string;
  value: string;
}) {
  return (
    <View style={[styles.metric, dark && styles.metricDark]}>
      <Text selectable style={[styles.metricLabel, dark && styles.metricLabelDark]}>
        {label}
      </Text>
      <Text selectable style={[styles.metricValue, dark && styles.metricValueDark]}>
        {value}
      </Text>
    </View>
  );
}

function WarningRow({ text }: { text: string }) {
  return (
    <View style={styles.warningRow}>
      <Text selectable style={styles.warningMark}>!</Text>
      <Text selectable style={styles.warningText}>{text}</Text>
    </View>
  );
}

function PrimaryButton({
  destructive = false,
  disabled = false,
  label,
  onPress,
}: {
  destructive?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        destructive && styles.stopButton,
        disabled && styles.disabledButton,
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.primaryButtonText, destructive && styles.stopButtonText]}>
        {label}
      </Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
      <Text style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function outcomeLabel(outcome: CooldownOutcome): string {
  const keys: Record<CooldownOutcome, string> = {
    "target-reached": "thermalPreview.outcomes.target",
    cutoff: "thermalPreview.outcomes.cutoff",
    stopped: "thermalPreview.outcomes.stopped",
    failed: "thermalPreview.outcomes.failed",
  };
  return translate(keys[outcome]);
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  previewBanner: {
    backgroundColor: "#2F2722",
    borderColor: "#5D4B40",
    borderCurve: "continuous",
    borderRadius: 22,
    borderWidth: 1,
    gap: 6,
    padding: 18,
  },
  previewEyebrow: { color: "#F2B66D", fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  previewTitle: { color: "#FFFFFF", fontSize: 23, fontWeight: "900" },
  previewWarning: { color: "#E7D9CE", fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: "#FFFCF7",
    borderColor: "#DDD3C7",
    borderCurve: "continuous",
    borderRadius: 20,
    borderWidth: 1,
    gap: 9,
    padding: 18,
  },
  statusHeader: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "space-between" },
  statusLabel: { color: "#8B3A2B", fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  statusLabelDark: { color: "#F2B66D" },
  statusPill: { backgroundColor: "#EAE2D7", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  statusPillDark: { backgroundColor: "#4A3C34" },
  statusPillText: { color: "#4A3E37", fontSize: 12, fontWeight: "900" },
  statusPillTextDark: { color: "#FFFFFF" },
  cardTitle: { color: "#241B17", fontSize: 21, fontWeight: "800" },
  bodyText: { color: "#5B4D44", fontSize: 15, lineHeight: 22 },
  cooldownActionCard: {
    backgroundColor: "#8B3A2B",
    borderCurve: "continuous",
    borderRadius: 22,
    gap: 10,
    padding: 20,
  },
  actionEyebrow: { color: "#8B3A2B", fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  cooldownEyebrow: { color: "#F2B66D", fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  actionTitle: { color: "#FFFFFF", fontSize: 25, fontWeight: "900" },
  actionDetail: { color: "#F6DED8", fontSize: 15, lineHeight: 22 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#F7E6D4",
    borderColor: "#F7E6D4",
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 52,
    minWidth: 150,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  primaryButtonText: { color: "#5E2118", fontSize: 16, fontWeight: "900", textAlign: "center" },
  stopButton: { backgroundColor: "#C63F32", borderColor: "#FF9A8F", minHeight: 60 },
  stopButtonText: { color: "#FFFFFF" },
  disabledButton: { opacity: 0.45 },
  activeCooldownCard: {
    backgroundColor: "#241B17",
    borderColor: "#4B3A31",
    borderCurve: "continuous",
    borderRadius: 22,
    borderWidth: 1,
    gap: 14,
    padding: 20,
  },
  activeTitle: { color: "#FFF9F1", fontSize: 25, fontWeight: "900" },
  activeOutcome: { color: "#F2B66D", fontSize: 15, fontWeight: "800" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: { backgroundColor: "#F5EEE5", borderCurve: "continuous", borderRadius: 14, flexBasis: 130, flexGrow: 1, gap: 4, padding: 12 },
  metricDark: { backgroundColor: "#3C312C" },
  metricLabel: { color: "#76675D", fontSize: 11, fontWeight: "800" },
  metricLabelDark: { color: "#CDBFB5" },
  metricValue: { color: "#241B17", fontSize: 18, fontVariant: ["tabular-nums"], fontWeight: "900" },
  metricValueDark: { color: "#FFFFFF" },
  commandBoundary: { color: "#5B4037", fontSize: 13, lineHeight: 19 },
  commandBoundaryDark: { color: "#D9CBC1", fontSize: 13, lineHeight: 19 },
  secondaryActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderColor: "#BDAA9D",
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 130,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: { color: "#8B3A2B", fontSize: 15, fontWeight: "800", textAlign: "center" },
  confirmationCard: {
    backgroundColor: "#FFF8EC",
    borderColor: "#C98B3C",
    borderCurve: "continuous",
    borderRadius: 22,
    borderWidth: 2,
    gap: 12,
    padding: 20,
  },
  confirmationTitle: { color: "#241B17", fontSize: 26, fontWeight: "900" },
  warningRow: { alignItems: "flex-start", flexDirection: "row", gap: 10 },
  warningMark: { color: "#8B3A2B", fontSize: 17, fontWeight: "900", width: 14 },
  warningText: { color: "#4A3E37", flex: 1, fontSize: 14, lineHeight: 21 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  warningCard: {
    backgroundColor: "#F5E8C9",
    borderColor: "#D4B86F",
    borderCurve: "continuous",
    borderRadius: 20,
    borderWidth: 1,
    gap: 9,
    padding: 18,
  },
  warningEyebrow: { color: "#7A4C00", fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  failureCard: {
    backgroundColor: "#F8DDD7",
    borderColor: "#CC7766",
    borderCurve: "continuous",
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  failureEyebrow: { color: "#8C2F24", fontSize: 11, fontWeight: "900", letterSpacing: 1.1 },
  failureTitle: { color: "#6F211A", fontSize: 22, fontWeight: "900" },
  failureText: { color: "#6F2F28", fontSize: 15, lineHeight: 22 },
  failureSafety: { color: "#6F211A", fontSize: 14, fontWeight: "800", lineHeight: 20 },
  outcomeSummary: { backgroundColor: "#FCEEDC", borderCurve: "continuous", borderRadius: 16, gap: 4, padding: 14 },
  outcomeEyebrow: { color: "#7A4C00", fontSize: 11, fontWeight: "900" },
  outcomeTitle: { color: "#4A2B00", fontSize: 18, fontWeight: "900" },
  outcomeDetail: { color: "#6A4A22", fontSize: 13, lineHeight: 19 },
  scenarioCard: {
    backgroundColor: "#FFFCF7",
    borderColor: "#D7C9B8",
    borderCurve: "continuous",
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  scenarioGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  scenarioButton: { backgroundColor: "#F5EEE5", borderColor: "#D8C9BA", borderCurve: "continuous", borderRadius: 14, borderWidth: 1, flexGrow: 1, minHeight: 46, minWidth: 120, paddingHorizontal: 12, paddingVertical: 10, justifyContent: "center" },
  scenarioButtonSelected: { backgroundColor: "#8B3A2B", borderColor: "#8B3A2B" },
  scenarioButtonText: { color: "#4A3E37", fontSize: 13, fontWeight: "800", textAlign: "center" },
  scenarioButtonTextSelected: { color: "#FFFFFF" },
  pressed: { opacity: 0.72 },
});
