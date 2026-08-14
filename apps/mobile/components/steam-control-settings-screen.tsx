import {
  STEAM_COMPENSATION_DECAY_MAX_MS,
  STEAM_COMPENSATION_DECAY_MIN_MS,
  STEAM_COMPENSATION_INITIAL_MAX_C,
  STEAM_COMPENSATION_INITIAL_MIN_C,
  STEAM_READY_TIMEOUT_MAX_MS,
  STEAM_READY_TIMEOUT_MIN_MS,
  type SteamControlSettings,
  type SteamControlSettingsRequest,
  type MachineStateV3,
} from "@philcoino/protocol";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { translate } from "@/src/localization/i18n";

export interface SteamControlSettingsClient {
  getState(options?: {
    signal?: AbortSignal;
  }): Promise<MachineStateV3>;
  updateSteamControlSettings(
    request: SteamControlSettingsRequest,
    options?: { signal?: AbortSignal },
  ): Promise<MachineStateV3>;
}

interface SteamControlSettingsScreenProps {
  client: SteamControlSettingsClient;
  deviceName: string;
  onClose: () => void;
  visible: boolean;
}

export function SteamControlSettingsScreen({
  client,
  deviceName,
  onClose,
  visible,
}: SteamControlSettingsScreenProps) {
  const insets = useSafeAreaInsets();
  const [saved, setSaved] = useState<SteamControlSettings | null>(null);
  const [draft, setDraft] = useState<SteamControlSettings | null>(null);
  const [status, setStatus] =
    useState<"idle" | "loading" | "saving" | "error">("idle");

  useEffect(() => {
    if (!visible) {
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    setSaved(null);
    setDraft(null);
    setStatus("loading");
    void client
      .getState({ signal: controller.signal })
      .then((state) => {
        setSaved(state.machine.steamControl.settings);
        setDraft(state.machine.steamControl.settings);
        setStatus("idle");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [client, visible]);

  const changed =
    draft !== null &&
    saved !== null &&
    (draft.initialCompensationC !== saved.initialCompensationC ||
      draft.decayDurationMs !== saved.decayDurationMs ||
      draft.readyTimeoutMs !== saved.readyTimeoutMs);
  const pending = status === "loading" || status === "saving";

  const save = () => {
    if (draft === null || !changed || pending) {
      return;
    }
    setStatus("saving");
    void client
      .updateSteamControlSettings(draft)
      .then((state) => {
        setSaved(state.machine.steamControl.settings);
        setDraft(state.machine.steamControl.settings);
        setStatus("idle");
      })
      .catch(() => setStatus("error"));
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={visible}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: Math.max(24, insets.bottom + 12),
            paddingLeft: Math.max(16, insets.left + 8),
            paddingRight: Math.max(16, insets.right + 8),
            paddingTop: Math.max(12, insets.top),
          },
        ]}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.secondaryButtonText}>
              {translate("steamControl.close")}
            </Text>
          </Pressable>
          <View style={styles.headerCopy}>
            <Text selectable style={styles.title}>
              {translate("steamControl.title")}
            </Text>
            <Text numberOfLines={1} selectable style={styles.device}>
              {deviceName}
            </Text>
          </View>
        </View>

        <View style={styles.notice}>
          <Text selectable style={styles.eyebrow}>
            {translate("steamControl.firmwareOwned")}
          </Text>
          <Text selectable style={styles.noticeText}>
            {translate("steamControl.detail")}
          </Text>
        </View>

        {status === "loading" || draft === null ? (
          <View style={styles.loading}>
            <ActivityIndicator />
            <Text selectable style={styles.help}>
              {translate("steamControl.loading")}
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            <SettingStepper
              disabled={pending}
              label={translate("steamControl.initial")}
              maximum={STEAM_COMPENSATION_INITIAL_MAX_C}
              minimum={STEAM_COMPENSATION_INITIAL_MIN_C}
              onChange={(initialCompensationC) =>
                setDraft({ ...draft, initialCompensationC })
              }
              suffix="°C"
              value={draft.initialCompensationC}
            />
            <SettingStepper
              disabled={pending}
              label={translate("steamControl.decay")}
              maximum={STEAM_COMPENSATION_DECAY_MAX_MS / 60_000}
              minimum={STEAM_COMPENSATION_DECAY_MIN_MS / 60_000}
              onChange={(minutes) =>
                setDraft({ ...draft, decayDurationMs: minutes * 60_000 })
              }
              suffix={translate("steamControl.minutesShort")}
              value={draft.decayDurationMs / 60_000}
            />
            <SettingStepper
              disabled={pending}
              label={translate("steamControl.timeout")}
              maximum={STEAM_READY_TIMEOUT_MAX_MS / 60_000}
              minimum={STEAM_READY_TIMEOUT_MIN_MS / 60_000}
              onChange={(minutes) =>
                setDraft({ ...draft, readyTimeoutMs: minutes * 60_000 })
              }
              suffix={translate("steamControl.minutesShort")}
              value={draft.readyTimeoutMs / 60_000}
            />
            <Text selectable style={styles.help}>
              {translate("steamControl.timingDetail")}
            </Text>
            {status === "error" ? (
              <Text accessibilityLiveRegion="assertive" selectable style={styles.error}>
                {translate("steamControl.error")}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !changed || pending }}
              disabled={!changed || pending}
              onPress={save}
              style={({ pressed }) => [
                styles.saveButton,
                (!changed || pending) && styles.disabled,
                pressed && changed && !pending && styles.pressed,
              ]}>
              {status === "saving" ? (
                <ActivityIndicator color="#fff" />
              ) : null}
              <Text style={styles.saveButtonText}>
                {status === "saving"
                  ? translate("steamControl.saving")
                  : changed
                    ? translate("steamControl.save")
                    : translate("steamControl.saved")}
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </Modal>
  );
}

function SettingStepper({
  disabled,
  label,
  maximum,
  minimum,
  onChange,
  suffix,
  value,
}: {
  disabled: boolean;
  label: string;
  maximum: number;
  minimum: number;
  onChange: (value: number) => void;
  suffix: string;
  value: number;
}) {
  return (
    <View style={styles.setting}>
      <View style={styles.settingCopy}>
        <Text selectable style={styles.settingLabel}>{label}</Text>
        <Text selectable style={styles.range}>
          {minimum}–{maximum} {suffix}
        </Text>
      </View>
      <View style={styles.stepper}>
        <StepButton
          disabled={disabled || value <= minimum}
          label="−"
          onPress={() => onChange(Math.max(minimum, value - 1))}
        />
        <Text selectable style={styles.value}>
          {value} {suffix}
        </Text>
        <StepButton
          disabled={disabled || value >= maximum}
          label="+"
          onPress={() => onChange(Math.min(maximum, value + 1))}
        />
      </View>
    </View>
  );
}

function StepButton({
  disabled,
  label,
  onPress,
}: {
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
        styles.stepButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text style={styles.stepButtonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderColor: "#d7d2ca",
    borderRadius: 18,
    borderWidth: 1,
    gap: 18,
    padding: 18,
  },
  content: { backgroundColor: "#f4f0e9", flexGrow: 1, gap: 16 },
  device: { color: "#6d6258", fontSize: 13 },
  disabled: { opacity: 0.45 },
  error: { color: "#a32929", fontSize: 14, fontWeight: "600" },
  eyebrow: {
    color: "#8c4d25",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  header: { alignItems: "center", flexDirection: "row", gap: 14 },
  headerCopy: { flex: 1 },
  help: { color: "#6d6258", fontSize: 14, lineHeight: 20 },
  loading: {
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 18,
    flexDirection: "row",
    gap: 12,
    padding: 20,
  },
  notice: {
    backgroundColor: "#fff4e8",
    borderColor: "#e9c7a8",
    borderRadius: 16,
    borderWidth: 1,
    gap: 7,
    padding: 16,
  },
  noticeText: { color: "#43392f", fontSize: 15, lineHeight: 22 },
  pressed: { opacity: 0.72 },
  range: { color: "#766b61", fontSize: 12 },
  saveButton: {
    alignItems: "center",
    backgroundColor: "#8c4d25",
    borderRadius: 12,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
  },
  saveButtonText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  secondaryButton: {
    borderColor: "#b9afa4",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryButtonText: { color: "#43392f", fontWeight: "700" },
  setting: {
    alignItems: "center",
    borderBottomColor: "#eee8df",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingBottom: 18,
  },
  settingCopy: { flex: 1, gap: 4 },
  settingLabel: { color: "#2f2924", fontSize: 15, fontWeight: "700" },
  stepButton: {
    alignItems: "center",
    backgroundColor: "#eee8df",
    borderRadius: 10,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  stepButtonText: { color: "#2f2924", fontSize: 24, fontWeight: "700" },
  stepper: { alignItems: "center", flexDirection: "row", gap: 8 },
  title: { color: "#251f1a", fontSize: 22, fontWeight: "800" },
  value: {
    color: "#251f1a",
    fontSize: 16,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
    minWidth: 72,
    textAlign: "center",
  },
});
