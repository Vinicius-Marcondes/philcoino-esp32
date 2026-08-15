import {
  TEMPERATURE_CALIBRATION_CANDIDATE_MAX_C,
  TEMPERATURE_CALIBRATION_CANDIDATE_MIN_C,
} from "@philcoino/protocol";
import type { TemperatureSensor } from "@philcoino/protocol";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTemperatureCalibration } from "@/hooks/use-temperature-calibration";
import {
  signedTemperature,
  temperatureCalibrationPresentation,
  temperatureReadout,
} from "@/src/dashboard/temperature-calibration-presentation";
import type { TemperatureCalibrationClient } from "@/src/dashboard/temperature-calibration-session";
import { mobileLayoutMode } from "@/src/layout/responsive-layout";
import { translate } from "@/src/localization/i18n";

interface TemperatureCalibrationScreenProps {
  client: TemperatureCalibrationClient;
  deviceName: string;
  onClose: () => void;
  sensor: TemperatureSensor;
  visible: boolean;
}

export function TemperatureCalibrationScreen({
  client,
  deviceName,
  onClose,
  sensor,
  visible,
}: TemperatureCalibrationScreenProps) {
  const safeAreaInsets = useSafeAreaInsets();
  const windowSize = useWindowDimensions();
  const landscape = mobileLayoutMode(windowSize) === "landscape";
  const calibration = useTemperatureCalibration({
    active: visible,
    client,
    sensor,
  });
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [closeAfterCancel, setCloseAfterCancel] = useState(false);
  const { state } = calibration;
  const snapshot = state.snapshot;
  const presentation = temperatureCalibrationPresentation(snapshot);
  const active = snapshot?.status === "calibrating" ? snapshot : null;
  const pending = state.status === "pending";

  useEffect(() => {
    if (!visible) {
      setConfirmingSave(false);
      setCloseAfterCancel(false);
    }
  }, [visible]);

  useEffect(() => {
    if (state.status === "cancelled" && closeAfterCancel) {
      setCloseAfterCancel(false);
      onClose();
    }
    if (state.status === "saved") {
      setConfirmingSave(false);
    }
  }, [closeAfterCancel, onClose, state.status]);

  const cancelAndClose = () => {
    if (active === null) {
      onClose();
      return;
    }
    setCloseAfterCancel(true);
    void calibration.cancel();
  };

  const statusText = calibrationStatusText(state.status);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent={false}
      supportedOrientations={[
        "portrait",
        "landscape-left",
        "landscape-right",
      ]}
      visible={visible}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          landscape && styles.contentLandscape,
          {
            paddingBottom: Math.max(20, safeAreaInsets.bottom + 12),
            paddingLeft: Math.max(16, safeAreaInsets.left + 8),
            paddingRight: Math.max(16, safeAreaInsets.right + 8),
            paddingTop: Math.max(12, safeAreaInsets.top),
          },
        ]}>
        <View style={[styles.header, landscape && styles.headerLandscape]}>
          <Pressable
            accessibilityLabel={translate("temperatureCalibration.close")}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              pressed && styles.pressed,
            ]}>
            <Text selectable style={styles.closeButtonText}>
              {translate("temperatureCalibration.close")}
            </Text>
          </Pressable>
          <Text numberOfLines={1} selectable style={styles.headerTitle}>
            {translate("temperatureCalibration.title")} · {sensor === "boiler" ? "Boiler" : "Steam"} · {deviceName}
          </Text>
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.statusPill,
              state.status === "disconnected" ||
              state.status === "rejected"
                ? styles.statusPillError
                : null,
            ]}>
            {state.status === "loading" || pending ? (
              <ActivityIndicator size="small" />
            ) : null}
            <Text selectable style={styles.statusPillText}>
              {statusText}
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.safetyCard,
            landscape && styles.safetyCardLandscape,
          ]}>
          <Text selectable style={styles.eyebrow}>
            {translate("temperatureCalibration.manualStep")}
          </Text>
          <Text selectable style={styles.safetyTitle}>
            {translate("temperatureCalibration.openWandTitle")}
          </Text>
          <Text selectable style={styles.bodyText}>
            {translate("temperatureCalibration.openWandDetail")}
          </Text>
          <Text selectable style={styles.warningText}>
            {translate("temperatureCalibration.noDetection")}
          </Text>
        </View>

        {state.error !== null ? (
          <View
            accessibilityLiveRegion="assertive"
            style={styles.errorCard}>
            <Text selectable style={styles.errorTitle}>
              {translate("temperatureCalibration.errorTitle")}
            </Text>
            <Text selectable style={styles.errorText}>
              {calibrationErrorText(state.error.code)}
            </Text>
          </View>
        ) : null}

        {state.status === "loading" ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="small" />
            <Text selectable style={styles.bodyText}>
              {translate("temperatureCalibration.loading")}
            </Text>
          </View>
        ) : null}

        {snapshot !== null && active === null ? (
          <View style={styles.summaryCard}>
            <Text selectable style={styles.eyebrow}>
              {translate("temperatureCalibration.currentCalibration")}
            </Text>
            <Text selectable style={styles.summaryValue}>
              {signedTemperature(snapshot.savedOffsetC)}
            </Text>
            <Text selectable style={styles.bodyText}>
              {translate(
                snapshot.status === "calibrated"
                  ? "temperatureCalibration.savedDetail"
                  : "temperatureCalibration.defaultDetail",
              )}
            </Text>
            {state.status === "saved" ? (
              <Text
                accessibilityLiveRegion="polite"
                selectable
                style={styles.successText}>
                {translate("temperatureCalibration.savedSuccess")}
              </Text>
            ) : null}
            <PrimaryButton
              disabled={pending}
              label={
                state.status === "saved"
                  ? translate("temperatureCalibration.done")
                  : translate(
                      snapshot.status === "calibrated"
                        ? "temperatureCalibration.recalibrate"
                        : "temperatureCalibration.start",
                    )
              }
              onPress={
                state.status === "saved"
                  ? onClose
                  : () => void calibration.start()
              }
            />
          </View>
        ) : null}

        {active !== null ? (
          <View
            style={[
              styles.activeLayout,
              landscape && styles.activeLayoutLandscape,
            ]}>
            <View
              style={[
                styles.activeColumn,
                landscape && styles.activeColumnLandscape,
              ]}>
              <View
                style={[
                  styles.candidateCard,
                  landscape && styles.candidateCardLandscape,
                ]}>
                <Text selectable style={styles.eyebrow}>
                  {translate("temperatureCalibration.rawTarget")}
                </Text>
                <Text
                  accessibilityLabel={translate(
                    "temperatureCalibration.candidateAccessibility",
                    { value: active.candidateRawTargetC },
                  )}
                  selectable
                  style={[
                    styles.candidateValue,
                    landscape && styles.candidateValueLandscape,
                  ]}>
                  {active.candidateRawTargetC}°C
                </Text>
                <View
                  style={[
                    styles.stepperRow,
                    landscape && styles.stepperRowLandscape,
                  ]}>
                  <StepButton
                    accessibilityLabel={translate(
                      "temperatureCalibration.decrease",
                    )}
                    compact={landscape}
                    disabled={!presentation.canDecrease || pending}
                    label="−"
                    onPress={() =>
                      void calibration.updateCandidate(
                        active.candidateRawTargetC - 1,
                      )
                    }
                  />
                  <Text
                    selectable
                    style={[
                      styles.rangeText,
                      landscape && styles.rangeTextLandscape,
                    ]}>
                    {TEMPERATURE_CALIBRATION_CANDIDATE_MIN_C}–
                    {TEMPERATURE_CALIBRATION_CANDIDATE_MAX_C}°C · 1°C
                  </Text>
                  <StepButton
                    accessibilityLabel={translate(
                      "temperatureCalibration.increase",
                    )}
                    compact={landscape}
                    disabled={!presentation.canIncrease || pending}
                    label="+"
                    onPress={() =>
                      void calibration.updateCandidate(
                        active.candidateRawTargetC + 1,
                      )
                    }
                  />
                </View>
                <Text selectable style={styles.bodyText}>
                  {translate("temperatureCalibration.adjustHelp")}
                </Text>
              </View>

              <View
                style={[
                  styles.instructionCard,
                  landscape && styles.instructionCardLandscape,
                ]}>
                <Text selectable style={styles.eyebrow}>
                  {translate("temperatureCalibration.observe")}
                </Text>
                <Instruction
                  compact={landscape}
                  index="1"
                  text={translate(
                    "temperatureCalibration.instructionOpen",
                  )}
                />
                <Instruction
                  compact={landscape}
                  index="2"
                  text={translate(
                    "temperatureCalibration.instructionDecide",
                  )}
                />
                <Instruction
                  compact={landscape}
                  index="3"
                  text={translate(
                    "temperatureCalibration.instructionAdjust",
                  )}
                />
              </View>
            </View>

            <View
              style={[
                styles.activeColumn,
                landscape && styles.activeColumnLandscape,
              ]}>
              <View style={styles.metricGrid}>
                <Metric
                  compact={landscape}
                  label={translate("temperatureCalibration.rawReading")}
                  value={temperatureReadout(
                    presentation.rawTemperatureC,
                  )}
                />
                <Metric
                  compact={landscape}
                  label={translate(
                    "temperatureCalibration.effectivePreview",
                  )}
                  value={temperatureReadout(
                    presentation.effectivePreviewC,
                  )}
                />
                <Metric
                  compact={landscape}
                  label={translate("temperatureCalibration.offsetPreview")}
                  value={signedTemperature(
                    presentation.offsetPreviewC ?? 0,
                  )}
                />
                <Metric
                  compact={landscape}
                  label={translate("temperatureCalibration.heaterCommand")}
                  value={translate(
                    active.heaterActive
                      ? "temperatureCalibration.heaterOn"
                      : "temperatureCalibration.heaterOff",
                  )}
                />
                <Metric
                  compact={landscape}
                  label={translate("temperatureCalibration.readiness")}
                  value={translate(
                    active.ready
                      ? "temperatureCalibration.ready"
                      : "temperatureCalibration.notReady",
                  )}
                />
                <Metric
                  compact={landscape}
                  label={translate("temperatureCalibration.stableTime")}
                  value={translate(
                    "temperatureCalibration.seconds",
                    {
                      value:
                        presentation.advisoryStableSeconds ?? 0,
                    },
                  )}
                />
              </View>

              <View
                style={[
                  styles.boundsCard,
                  landscape && styles.boundsCardLandscape,
                ]}>
                <Text selectable style={styles.eyebrow}>
                  {translate("temperatureCalibration.safeBounds")}
                </Text>
                <Text selectable style={styles.bodyText}>
                  {translate("temperatureCalibration.sensorBoundsDetail", {
                    maximum: active.previewSafeTargetBounds.maximumC,
                    minimum: active.previewSafeTargetBounds.minimumC,
                  })}
                </Text>
                <Text selectable style={styles.secondaryText}>
                  {translate("temperatureCalibration.leaseDetail", {
                    seconds: presentation.leaseSeconds ?? 0,
                  })}
                </Text>
              </View>

              {confirmingSave ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={styles.confirmationCard}>
                  <Text selectable style={styles.confirmationTitle}>
                    {translate("temperatureCalibration.confirmTitle")}
                  </Text>
                  <Text selectable style={styles.bodyText}>
                    {translate("temperatureCalibration.confirmDetail", {
                      candidate: active.candidateRawTargetC,
                      offset: signedTemperature(active.offsetPreviewC),
                    })}
                  </Text>
                  <Text selectable style={styles.warningText}>
                    {translate("temperatureCalibration.confirmWarning")}
                  </Text>
                  <View style={styles.actionRow}>
                    <SecondaryButton
                      compact={landscape}
                      disabled={pending}
                      label={translate(
                        "temperatureCalibration.back",
                      )}
                      onPress={() => setConfirmingSave(false)}
                    />
                    <PrimaryButton
                      compact={landscape}
                      disabled={pending}
                      label={translate(
                        pending
                          ? "temperatureCalibration.saving"
                          : "temperatureCalibration.confirmSave",
                      )}
                      onPress={() => void calibration.save()}
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.actionRow}>
                  <SecondaryButton
                    compact={landscape}
                    disabled={pending}
                    label={translate("temperatureCalibration.cancel")}
                    onPress={cancelAndClose}
                  />
                  <PrimaryButton
                    compact={landscape}
                    disabled={pending}
                    label={translate(
                      "temperatureCalibration.reviewSave",
                    )}
                    onPress={() => setConfirmingSave(true)}
                  />
                </View>
              )}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Modal>
  );
}

function Metric({
  compact = false,
  label,
  value,
}: {
  compact?: boolean;
  label: string;
  value: string;
}) {
  return (
    <View style={[styles.metric, compact && styles.metricLandscape]}>
      <Text selectable style={styles.metricLabel}>{label}</Text>
      <Text
        selectable
        style={[
          styles.metricValue,
          compact && styles.metricValueLandscape,
        ]}>
        {value}
      </Text>
    </View>
  );
}

function Instruction({
  compact = false,
  index,
  text,
}: {
  compact?: boolean;
  index: string;
  text: string;
}) {
  return (
    <View style={styles.instruction}>
      <Text selectable style={styles.instructionIndex}>{index}</Text>
      <Text
        selectable
        style={[
          styles.instructionText,
          compact && styles.instructionTextLandscape,
        ]}>
        {text}
      </Text>
    </View>
  );
}

function StepButton({
  accessibilityLabel,
  compact = false,
  disabled,
  label,
  onPress,
}: {
  accessibilityLabel: string;
  compact?: boolean;
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
        compact && styles.stepButtonLandscape,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text selectable style={styles.stepButtonText}>{label}</Text>
    </Pressable>
  );
}

function PrimaryButton({
  compact = false,
  disabled = false,
  label,
  onPress,
}: {
  compact?: boolean;
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
        compact && styles.actionButtonLandscape,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text selectable style={styles.primaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({
  compact = false,
  disabled,
  label,
  onPress,
}: {
  compact?: boolean;
  disabled: boolean;
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
        styles.secondaryButton,
        compact && styles.actionButtonLandscape,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text selectable style={styles.secondaryButtonText}>{label}</Text>
    </Pressable>
  );
}

function calibrationStatusText(
  status:
    | "idle"
    | "loading"
    | "ready"
    | "pending"
    | "saved"
    | "cancelled"
    | "rejected"
    | "disconnected",
): string {
  return translate(`temperatureCalibration.status.${status}`);
}

function calibrationErrorText(code: string): string {
  switch (code) {
    case "temperature_calibration_expired":
      return translate("temperatureCalibration.errors.expired");
    case "temperature_calibration_active":
      return translate("temperatureCalibration.errors.active");
    case "temperature_calibration_inactive":
    case "temperature_calibration_session_mismatch":
      return translate("temperatureCalibration.errors.session");
    case "temperature_target_unsafe":
      return translate("temperatureCalibration.errors.unsafeTarget");
    case "persistence_failure":
      return translate("temperatureCalibration.errors.persistence");
    case "sensor_unavailable":
      return translate("temperatureCalibration.errors.sensor");
    case "heater_disabled":
      return translate("temperatureCalibration.errors.heaterDisabled");
    case "extraction_active":
      return translate("temperatureCalibration.errors.extraction");
    case "cooldown_active":
      return translate("temperatureCalibration.errors.cooldown");
    case "calibration_in_progress":
      return translate("temperatureCalibration.errors.scale");
    case "brew_mode_required":
      return translate("temperatureCalibration.errors.brewMode");
    case "machine_faulted":
      return translate("temperatureCalibration.errors.fault");
    case "offline":
    case "timeout":
    case "not-found":
      return translate("temperatureCalibration.errors.disconnected");
    case "unauthorized":
      return translate("temperatureCalibration.errors.unauthorized");
    case "protocol":
    case "invalid-request":
    case "malformed_request":
      return translate("temperatureCalibration.errors.protocol");
    default:
      return translate("temperatureCalibration.errors.generic");
  }
}

const styles = StyleSheet.create({
  actionButtonLandscape: {
    minHeight: 46,
    minWidth: 108,
    paddingHorizontal: 12,
  },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  activeColumn: { flex: 1, gap: 12, minWidth: 280 },
  activeColumnLandscape: { gap: 10, minWidth: 0 },
  activeLayout: { gap: 12 },
  activeLayoutLandscape: { flexDirection: "row" },
  bodyText: { color: "#443A34", fontSize: 16, lineHeight: 23 },
  boundsCard: {
    backgroundColor: "#F5EFE7",
    borderColor: "#D9CEC3",
    borderCurve: "continuous",
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  boundsCardLandscape: { gap: 6, padding: 12 },
  candidateCard: {
    backgroundColor: "#1D1714",
    borderCurve: "continuous",
    borderRadius: 24,
    gap: 14,
    padding: 20,
  },
  candidateCardLandscape: { gap: 9, padding: 14 },
  candidateValue: {
    color: "#FFF9F1",
    fontSize: 58,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
    letterSpacing: -1.5,
  },
  candidateValueLandscape: { fontSize: 44 },
  closeButton: {
    alignItems: "center",
    backgroundColor: "#EEE5DC",
    borderCurve: "continuous",
    borderRadius: 16,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  closeButtonText: { color: "#2F2520", fontSize: 15, fontWeight: "800" },
  confirmationCard: {
    backgroundColor: "#FFF1D9",
    borderColor: "#D99632",
    borderCurve: "continuous",
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  confirmationTitle: { color: "#4D2E0B", fontSize: 20, fontWeight: "800" },
  content: { backgroundColor: "#F4F0E8", flexGrow: 1, gap: 14 },
  contentLandscape: { gap: 10, paddingHorizontal: 16 },
  disabled: { opacity: 0.42 },
  errorCard: {
    backgroundColor: "#FCE6E1",
    borderColor: "#C4513F",
    borderCurve: "continuous",
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  errorText: { color: "#63281F", fontSize: 16, lineHeight: 22 },
  errorTitle: { color: "#63281F", fontSize: 17, fontWeight: "800" },
  eyebrow: {
    color: "#8E5B32",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  headerLandscape: { gap: 8 },
  headerTitle: {
    color: "#2F2520",
    flex: 1,
    fontSize: 18,
    fontWeight: "800",
    minWidth: 180,
  },
  instruction: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  instructionCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DDD3C9",
    borderCurve: "continuous",
    borderRadius: 20,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  instructionCardLandscape: { gap: 9, padding: 12 },
  instructionIndex: {
    backgroundColor: "#C66B2E",
    borderRadius: 14,
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  instructionText: {
    color: "#443A34",
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  instructionTextLandscape: { fontSize: 14, lineHeight: 19 },
  loadingCard: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderCurve: "continuous",
    borderRadius: 18,
    flexDirection: "row",
    gap: 12,
    padding: 18,
  },
  metric: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DDD3C9",
    borderCurve: "continuous",
    borderRadius: 18,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    gap: 6,
    minWidth: 145,
    padding: 16,
  },
  metricLandscape: { minWidth: 100, padding: 11 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricLabel: {
    color: "#75665C",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  metricValue: {
    color: "#2F2520",
    fontSize: 24,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
  },
  metricValueLandscape: { fontSize: 20 },
  pressed: { opacity: 0.72 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#C45F26",
    borderCurve: "continuous",
    borderRadius: 16,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 52,
    minWidth: 150,
    paddingHorizontal: 18,
  },
  primaryButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  rangeText: {
    color: "#DCCEC3",
    flex: 1,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
  },
  rangeTextLandscape: { fontSize: 12 },
  safetyCard: {
    backgroundColor: "#FFF7E8",
    borderColor: "#D99632",
    borderCurve: "continuous",
    borderRadius: 22,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  safetyCardLandscape: { gap: 5, padding: 12 },
  safetyTitle: { color: "#382619", fontSize: 23, fontWeight: "900" },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#E9E0D7",
    borderCurve: "continuous",
    borderRadius: 16,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 52,
    minWidth: 130,
    paddingHorizontal: 18,
  },
  secondaryButtonText: { color: "#382E28", fontSize: 16, fontWeight: "800" },
  secondaryText: { color: "#75665C", fontSize: 14, lineHeight: 20 },
  statusPill: {
    alignItems: "center",
    backgroundColor: "#E8E0D7",
    borderCurve: "continuous",
    borderRadius: 999,
    flexDirection: "row",
    gap: 7,
    minHeight: 36,
    paddingHorizontal: 12,
  },
  statusPillError: { backgroundColor: "#F4D5CF" },
  statusPillText: { color: "#443A34", fontSize: 13, fontWeight: "800" },
  stepButton: {
    alignItems: "center",
    backgroundColor: "#3B302A",
    borderColor: "#6A5B51",
    borderRadius: 18,
    borderWidth: 1,
    height: 52,
    justifyContent: "center",
    width: 64,
  },
  stepButtonLandscape: { height: 46, width: 52 },
  stepButtonText: { color: "#FFFFFF", fontSize: 28, fontWeight: "700" },
  stepperRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  stepperRowLandscape: { gap: 8 },
  successText: { color: "#17633A", fontSize: 16, fontWeight: "800" },
  summaryCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DDD3C9",
    borderCurve: "continuous",
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    padding: 20,
  },
  summaryValue: {
    color: "#2F2520",
    fontSize: 42,
    fontVariant: ["tabular-nums"],
    fontWeight: "900",
  },
  warningText: { color: "#7B3F15", fontSize: 15, fontWeight: "700", lineHeight: 21 },
});
