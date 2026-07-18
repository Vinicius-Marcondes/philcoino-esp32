import {
  BREW_TARGET_MAX_C,
  BREW_TARGET_MIN_C,
  STEAM_TARGET_MAX_C,
  STEAM_TARGET_MIN_C,
  type MachineState,
  type Mode,
  type TemperatureSettingsRequest,
} from "@philcoino/protocol";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { DashboardMutationState } from "@/src/dashboard/dashboard-mutation-session";
import {
  MUTATION_FEEDBACK_DISMISS_MS,
  mutationFeedbackIsVisible,
  mutationFeedbackShouldAutoDismiss,
  type MutationFeedbackVisibility,
} from "@/src/dashboard/mutation-feedback";
import { translate } from "@/src/localization/i18n";

interface MachineControlsProps {
  faultMutation: DashboardMutationState;
  heaterMutation: DashboardMutationState;
  modeMutation: DashboardMutationState;
  onSetMode: (mode: Mode) => void;
  onUpdateTemperatureSettings: (
    settings: TemperatureSettingsRequest,
  ) => void;
  snapshot: MachineState;
  steamWorkflowBlocked?: boolean;
  temperatureMutation: DashboardMutationState;
}

export function MachineControls({
  faultMutation,
  heaterMutation,
  modeMutation,
  onSetMode,
  onUpdateTemperatureSettings,
  snapshot,
  steamWorkflowBlocked = false,
  temperatureMutation,
}: MachineControlsProps) {
  const [brewTargetC, setBrewTargetC] = useState(snapshot.brewTargetC);
  const [confirmingTargets, setConfirmingTargets] = useState(false);
  const [steamTargetC, setSteamTargetC] = useState(snapshot.steamTargetC);
  const mutationPending =
    faultMutation.status === "pending" ||
    heaterMutation.status === "pending" ||
    modeMutation.status === "pending" ||
    temperatureMutation.status === "pending";
  const targetsChanged =
    brewTargetC !== snapshot.brewTargetC ||
    steamTargetC !== snapshot.steamTargetC;

  useEffect(() => {
    setBrewTargetC(snapshot.brewTargetC);
    setSteamTargetC(snapshot.steamTargetC);
    setConfirmingTargets(false);
  }, [snapshot.brewTargetC, snapshot.steamTargetC]);

  const requestTargetConfirmation = () => {
    if (targetsChanged && !mutationPending) {
      setConfirmingTargets(true);
    }
  };

  const confirmTargets = () => {
    if (!targetsChanged || mutationPending) {
      return;
    }

    setConfirmingTargets(false);
    onUpdateTemperatureSettings({ brewTargetC, steamTargetC });
  };

  return (
    <View style={styles.controlsSection}>
      <View style={styles.controlCard}>
        <Text selectable style={styles.eyebrow}>
          {translate("controls.activeMode")}
        </Text>
        <Text selectable style={styles.sectionTitle}>
          {translate("controls.firmwareControl")}
        </Text>
        <View style={styles.modeRow}>
          <ModeButton
            active={snapshot.activeMode === "brew"}
            disabled={mutationPending}
            mode="brew"
            onPress={onSetMode}
          />
          <ModeButton
            active={snapshot.activeMode === "steam"}
            disabled={mutationPending || steamWorkflowBlocked}
            mode="steam"
            onPress={onSetMode}
          />
        </View>
        <Text selectable style={styles.helpText}>
          {translate("controls.modeHelp")}
        </Text>
        {steamWorkflowBlocked ? (
          <Text accessibilityLiveRegion="polite" selectable style={styles.blockedText}>
            {translate("controls.steamWorkflowBlocked")}
          </Text>
        ) : null}
      </View>

      <View style={styles.controlCard}>
        <View style={styles.sectionHeading}>
          <View style={styles.headingCopy}>
            <Text selectable style={styles.eyebrow}>
              {translate("controls.temperatureTargets")}
            </Text>
            <Text selectable style={styles.sectionTitle}>
              {translate("controls.wholeDegreeSettings")}
            </Text>
          </View>
          <Text
            selectable
            style={[styles.persistedPill, targetsChanged && styles.draftPill]}>
            {targetsChanged ? translate("controls.draft") : translate("controls.saved")}
          </Text>
        </View>

        <TargetStepper
          disabled={mutationPending || confirmingTargets}
          label={translate("controls.brew")}
          maximum={BREW_TARGET_MAX_C}
          minimum={BREW_TARGET_MIN_C}
          onChange={setBrewTargetC}
          value={brewTargetC}
        />
        <TargetStepper
          disabled={mutationPending || confirmingTargets}
          label={translate("controls.steam")}
          maximum={STEAM_TARGET_MAX_C}
          minimum={STEAM_TARGET_MIN_C}
          onChange={setSteamTargetC}
          value={steamTargetC}
        />

        <Text selectable style={styles.helpText}>
          {translate("controls.targetsHelp")}
        </Text>

        {confirmingTargets ? (
          <View accessibilityLiveRegion="polite" style={styles.confirmationCard}>
            <Text selectable style={styles.confirmationTitle}>
              {translate("controls.confirmTargets")}
            </Text>
            <Text selectable style={styles.confirmationText}>
              {translate("controls.targetChanges", {
                newBrew: brewTargetC,
                newSteam: steamTargetC,
                oldBrew: snapshot.brewTargetC,
                oldSteam: snapshot.steamTargetC,
              })}
            </Text>
            <Text selectable style={styles.confirmationText}>
              {translate("controls.acknowledgementHelp")}
            </Text>
            <View style={styles.actionRow}>
              <ControlButton
                label={translate("controls.cancel")}
                onPress={() => setConfirmingTargets(false)}
                secondary
              />
              <ControlButton
                label={translate("controls.confirmAndSave")}
                onPress={confirmTargets}
              />
            </View>
          </View>
        ) : (
          <ControlButton
            disabled={!targetsChanged || mutationPending}
            label={targetsChanged ? translate("controls.reviewChanges") : translate("controls.unchanged")}
            onPress={requestTargetConfirmation}
          />
        )}
      </View>

    </View>
  );
}

export function MutationFeedback({
  onDismiss,
  state,
  visibility = "all",
}: {
  onDismiss: () => void;
  state: DashboardMutationState;
  visibility?: MutationFeedbackVisibility;
}) {
  useEffect(() => {
    if (!mutationFeedbackShouldAutoDismiss(state.status)) {
      return;
    }

    const timer = setTimeout(onDismiss, MUTATION_FEEDBACK_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss, state.message, state.status]);

  if (!mutationFeedbackIsVisible(state.status, visibility)) {
    return null;
  }

  return (
    <View
      accessibilityLiveRegion={
        state.status === "rejected" || state.status === "disconnected"
          ? "assertive"
          : "polite"
      }
      style={[
        styles.feedback,
        state.status === "pending" && styles.feedbackPending,
        state.status === "acknowledged" && styles.feedbackAcknowledged,
        state.status === "rejected" && styles.feedbackRejected,
        state.status === "disconnected" && styles.feedbackDisconnected,
      ]}>
      <View style={styles.feedbackHeader}>
        <Text selectable style={styles.feedbackTitle}>
          {feedbackTitle(state.status)}
        </Text>
        <Pressable
          accessibilityLabel={translate("controls.dismissNotification")}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onDismiss}
          style={({ pressed }) => [
            styles.feedbackDismissButton,
            pressed && styles.pressed,
          ]}>
          <Text style={styles.feedbackDismissText}>x</Text>
        </Pressable>
      </View>
      <Text selectable style={styles.feedbackMessage}>
        {state.message}
      </Text>
    </View>
  );
}

function TargetStepper({
  disabled,
  label,
  maximum,
  minimum,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  maximum: number;
  minimum: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <View style={styles.stepperRow}>
      <View style={styles.stepperCopy}>
        <Text selectable style={styles.stepperLabel}>
          {label}
        </Text>
        <Text selectable style={styles.rangeText}>
          {minimum}–{maximum}°C
        </Text>
      </View>
      <View style={styles.stepperControls}>
        <StepButton
          accessibilityLabel={translate("controls.decreaseTarget", { label })}
          disabled={disabled || value <= minimum}
          label="−"
          onPress={() => onChange(Math.max(minimum, value - 1))}
        />
        <Text
          accessibilityLabel={translate("controls.targetAccessibility", { label, value })}
          selectable
          style={styles.stepperValue}>
          {value}°C
        </Text>
        <StepButton
          accessibilityLabel={translate("controls.increaseTarget", { label })}
          disabled={disabled || value >= maximum}
          label="+"
          onPress={() => onChange(Math.min(maximum, value + 1))}
        />
      </View>
    </View>
  );
}

function StepButton({
  accessibilityLabel,
  disabled,
  label,
  onPress,
}: {
  accessibilityLabel: string;
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stepButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text style={styles.stepButtonText}>{label}</Text>
    </Pressable>
  );
}

function ModeButton({
  active,
  disabled,
  mode,
  onPress,
}: {
  active: boolean;
  disabled: boolean;
  mode: Mode;
  onPress: (mode: Mode) => void;
}) {
  const label = translate(mode === "brew" ? "controls.brew" : "controls.steam");
  return (
    <Pressable
      accessibilityLabel={translate("controls.temperatureMode", { label })}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || active, selected: active }}
      disabled={disabled || active}
      onPress={() => onPress(mode)}
      style={({ pressed }) => [
        styles.modeButton,
        active && styles.modeButtonActive,
        disabled && !active && styles.disabled,
        pressed && !disabled && !active && styles.pressed,
      ]}>
      <Text style={[styles.modeLabel, active && styles.modeLabelActive]}>
        {label}
      </Text>
      <Text style={[styles.modeState, active && styles.modeStateActive]}>
        {active ? translate("controls.active") : translate("controls.switch")}
      </Text>
    </Pressable>
  );
}

function ControlButton({
  disabled = false,
  label,
  onPress,
  secondary = false,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        secondary && styles.secondaryButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text
        style={[
          styles.actionButtonText,
          secondary && styles.secondaryButtonText,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function feedbackTitle(status: DashboardMutationState["status"]): string {
  switch (status) {
    case "pending":
      return translate("controls.feedback.pending");
    case "acknowledged":
      return translate("controls.feedback.acknowledged");
    case "rejected":
      return translate("controls.feedback.rejected");
    case "disconnected":
      return translate("controls.feedback.disconnected");
    case "idle":
      return "";
  }
}

const styles = StyleSheet.create({
  controlsSection: { gap: 12 },
  controlCard: {
    backgroundColor: "#FFFCF7",
    borderColor: "#DDD3C7",
    borderCurve: "continuous",
    borderRadius: 22,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  sectionHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  headingCopy: { flex: 1, gap: 4 },
  eyebrow: {
    color: "#8B3A2B",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  sectionTitle: { color: "#241B17", fontSize: 21, fontWeight: "800" },
  persistedPill: {
    backgroundColor: "#E8DFD4",
    borderRadius: 999,
    color: "#62544B",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  draftPill: { backgroundColor: "#F5E8C9", color: "#765A17" },
  stepperRow: {
    alignItems: "center",
    backgroundColor: "#F5EEE5",
    borderCurve: "continuous",
    borderRadius: 16,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    padding: 12,
  },
  stepperCopy: { flex: 1, gap: 2 },
  stepperLabel: { color: "#332A25", fontSize: 16, fontWeight: "800" },
  rangeText: { color: "#76675D", fontSize: 12, fontWeight: "600" },
  stepperControls: { alignItems: "center", flexDirection: "row", gap: 9 },
  stepperValue: {
    color: "#241B17",
    fontSize: 21,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
    minWidth: 58,
    textAlign: "center",
  },
  stepButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#BBAEA1",
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  stepButtonText: { color: "#8B3A2B", fontSize: 25, fontWeight: "700" },
  helpText: { color: "#695A50", fontSize: 14, lineHeight: 20 },
  confirmationCard: {
    backgroundColor: "#F3E6DC",
    borderColor: "#D3B9A7",
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    gap: 9,
    padding: 14,
  },
  confirmationTitle: { color: "#462C24", fontSize: 17, fontWeight: "800" },
  confirmationText: { color: "#5B4037", fontSize: 14, lineHeight: 20 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  actionButton: {
    alignItems: "center",
    backgroundColor: "#8B3A2B",
    borderColor: "#8B3A2B",
    borderRadius: 999,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 16,
  },
  actionButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  secondaryButton: { backgroundColor: "transparent" },
  secondaryButtonText: { color: "#8B3A2B" },
  modeRow: { flexDirection: "row", gap: 10 },
  modeButton: {
    backgroundColor: "#F5EEE5",
    borderColor: "#D8C9BA",
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minHeight: 72,
    padding: 14,
  },
  modeButtonActive: { backgroundColor: "#8B3A2B", borderColor: "#8B3A2B" },
  modeLabel: { color: "#332A25", fontSize: 18, fontWeight: "800" },
  modeLabelActive: { color: "#FFFFFF" },
  modeState: {
    color: "#8B3A2B",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  modeStateActive: { color: "#F3D9D2" },
  feedback: {
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  feedbackPending: { backgroundColor: "#E9E0D4", borderColor: "#CBBBA8" },
  feedbackAcknowledged: { backgroundColor: "#E5F1E8", borderColor: "#A9C9B0" },
  feedbackRejected: { backgroundColor: "#F8DDD7", borderColor: "#CC7766" },
  feedbackDisconnected: { backgroundColor: "#F5E8C9", borderColor: "#D4B86F" },
  feedbackHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  feedbackTitle: {
    color: "#332A25",
    flex: 1,
    fontSize: 15,
    fontWeight: "900",
  },
  feedbackDismissButton: {
    alignItems: "center",
    borderRadius: 999,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  feedbackDismissText: {
    color: "#332A25",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 20,
  },
  feedbackMessage: { color: "#5B4D44", fontSize: 14, lineHeight: 20 },
  disabled: { opacity: 0.42 },
  blockedText: { color: "#8B3A2B", fontSize: 14, fontWeight: "800", lineHeight: 20 },
  pressed: { opacity: 0.7 },
});
