import type {
  ExtractionSelection,
  ExtractionState,
  MachineState,
  ProfileSlotId,
  ScaleState,
  WeightControl,
} from "@philcoino/protocol";
import type { Dispatch, SetStateAction } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WeightedTraceChart } from "@/components/extraction-telemetry-chart";
import { TELEMETRY_COLORS } from "@/components/telemetry-surface";
import { WeightModeCard } from "@/components/weight-mode-card";
import {
  canStartPreview,
  selectPreview,
  startExtractionPreview,
  stopExtractionPreview,
  type ExtractionPreviewState,
} from "@/src/debug/extraction-preview-model";
import {
  extractionConsoleReadouts,
  extractionConsoleTrace,
  type ExtractionConsolePhase,
} from "@/src/dashboard/extraction-console-model";
import type { StoredExtractionTrace } from "@/src/history/extraction-trace";
import { translate } from "@/src/localization/i18n";
import type { ExtractionStreamStatus } from "@/src/telemetry/extraction-stream-session";
import { formatWeightReadout } from "@/src/telemetry/telemetry-readouts";

export interface ExtractionConsoleScreenProps {
  brewControlMode: "timed" | "weight";
  cutoffDecigrams: number | null;
  deviceName: string;
  extraction: ExtractionState | null;
  landscape: boolean;
  live: boolean;
  onBrewControlModeChange: (mode: "timed" | "weight") => void;
  onClose: () => void;
  onStateChange: Dispatch<SetStateAction<ExtractionPreviewState>>;
  onWeightControlChange: (value: WeightControl) => void;
  scale: ScaleState | null;
  shotWeightControl: WeightControl;
  snapshot: MachineState | null;
  startPending: boolean;
  state: ExtractionPreviewState;
  stopPending: boolean;
  streamStatus: ExtractionStreamStatus;
  trace: StoredExtractionTrace | null;
  visible: boolean;
  workflowBlock: "cooldown" | "steam" | null;
}

export function ExtractionConsoleScreen({
  brewControlMode,
  cutoffDecigrams,
  deviceName,
  extraction,
  landscape,
  live,
  onBrewControlModeChange,
  onClose,
  onStateChange,
  onWeightControlChange,
  scale,
  shotWeightControl,
  snapshot,
  startPending,
  state,
  stopPending,
  streamStatus,
  trace,
  visible,
  workflowBlock,
}: ExtractionConsoleScreenProps) {
  const safeAreaInsets = useSafeAreaInsets();
  const consoleTrace = extractionConsoleTrace(trace, extraction);
  const displayedTrace = consoleTrace;
  const heaterCommand =
    displayedTrace?.samples.at(-1)?.heaterActive ??
    snapshot?.heaterActive;
  const readouts = extractionConsoleReadouts({
    extraction,
    scale,
    snapshot,
    trace: consoleTrace,
  });
  const running = readouts.running;
  const mutationPending = startPending || stopPending;
  const startDisabled =
    !live || mutationPending || workflowBlock !== null || !canStartPreview(state);
  const controlsDisabled = !live || running || mutationPending;

  const chart = (
    <WeightedTraceChart
      compact={landscape}
      cutoffDecigrams={cutoffDecigrams}
      key={displayedTrace?.extractionId ?? "awaiting-stream"}
      streamStatus={streamStatus}
      trace={displayedTrace}
      variant="console"
    />
  );

  const controls = (
    <View style={styles.controls}>
      <ProfileStrip
        disabled={controlsDisabled}
        onSelect={(selected) =>
          onStateChange((current) => selectPreview(current, selected))
        }
        state={state}
      />
      {state.selected.kind === "profile" ? (
        <View style={styles.controlPanel}>
          <WeightModeCard
            compact
            disabled={controlsDisabled}
            embedded
            mode={brewControlMode}
            onModeChange={onBrewControlModeChange}
            onWeightChange={onWeightControlChange}
            scale={scale}
            startPending={startPending}
            value={shotWeightControl}
          />
        </View>
      ) : null}
      {workflowBlock === null ? null : (
        <Text selectable style={styles.blockedText}>
          {translate(
            workflowBlock === "cooldown"
              ? "extractionConsole.blockedCooldown"
              : "extractionConsole.blockedSteam",
          )}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: running ? !live || mutationPending : startDisabled }}
        disabled={running ? !live || mutationPending : startDisabled}
        onPress={() =>
          onStateChange((current) =>
            running
              ? stopExtractionPreview(current)
              : startExtractionPreview(current),
          )
        }
        style={({ pressed }) => [
          styles.action,
          running && styles.actionStop,
          (running ? !live || mutationPending : startDisabled) &&
            styles.actionDisabled,
          pressed && styles.pressed,
        ]}>
        <Text selectable style={styles.actionText}>
          {translate(
            running
              ? stopPending
                ? "extractionConsole.stopping"
                : "extractionConsole.stop"
              : startPending
                ? "extractionConsole.starting"
                : "extractionConsole.start",
          )}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent={false}
      visible={visible}>
      <View
        style={[
          styles.screen,
          {
            paddingBottom: Math.max(12, safeAreaInsets.bottom),
            paddingLeft: Math.max(16, safeAreaInsets.left),
            paddingRight: Math.max(16, safeAreaInsets.right),
            paddingTop: Math.max(12, safeAreaInsets.top),
          },
        ]}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={translate("extractionConsole.close")}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <Text selectable style={styles.closeText}>
              {translate("extractionConsole.close")}
            </Text>
          </Pressable>
          <Text numberOfLines={1} selectable style={styles.headerTitle}>
            {translate("extractionConsole.eyebrow")} · {deviceName}
          </Text>
        </View>
        <View style={styles.timerRow}>
          <Text selectable style={styles.timer}>
            {readouts.elapsed}
          </Text>
          <View style={styles.statusPills}>
            <Text selectable style={[styles.pill, running && styles.pillActive]}>
              {consolePhaseLabel(readouts.phase)}
            </Text>
            <Text
              selectable
              style={[styles.pill, readouts.pumpRunning && styles.pillActive]}>
              {translate(
                readouts.pumpRunning
                  ? "extractionConsole.pumpRunning"
                  : "extractionConsole.pumpOff",
              )}
            </Text>
            <Text
              selectable
              style={[
                styles.pill,
                heaterCommand && styles.pillActive,
              ]}>
              {translate(
                heaterCommand === undefined
                  ? "scale.heaterCommandUnavailable"
                  : heaterCommand
                    ? "scale.heaterCommandOn"
                    : "scale.heaterCommandOff",
              )}
            </Text>
          </View>
        </View>
        <View style={styles.readoutRow}>
          <Readout
            color={TELEMETRY_COLORS.temperature}
            label={translate("scale.telemetryTemperature")}
            value={readouts.temperature}
          />
          <Readout
            color={TELEMETRY_COLORS.target}
            label={translate("dashboard.telemetryTarget")}
            value={readouts.target}
          />
          <Readout
            color={TELEMETRY_COLORS.weight}
            label={translate("scale.telemetryWeight")}
            value={readouts.weight}
          />
          <Readout
            color={TELEMETRY_COLORS.flow}
            label={translate("scale.telemetryFlow")}
            value={readouts.flow}
          />
        </View>
        {landscape ? (
          <View style={styles.landscapeBody}>
            <View style={styles.landscapeChart}>{chart}</View>
            <ScrollView
              contentContainerStyle={styles.landscapeControls}
              style={styles.landscapeControlColumn}>
              {controls}
            </ScrollView>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.portraitBody}
            keyboardShouldPersistTaps="handled">
            {chart}
            {controls}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/** Dashboard tile that opens the console and reports what it would show. */
export function ExtractionConsoleEntry({
  compact = false,
  extraction,
  onPress,
  scale,
  snapshot,
  trace,
}: {
  compact?: boolean;
  extraction: ExtractionState | null;
  onPress: () => void;
  scale: ScaleState | null;
  snapshot: MachineState | null;
  trace: StoredExtractionTrace | null;
}) {
  const readouts = extractionConsoleReadouts({
    extraction,
    scale,
    snapshot,
    trace: extractionConsoleTrace(trace, extraction),
  });
  const finalWeightDecigrams = scale?.terminalExtraction?.finalWeightDecigrams;
  const status = readouts.running
    ? translate("extractionConsole.running", {
        phase: consolePhaseLabel(readouts.phase),
      })
    : finalWeightDecigrams === undefined || finalWeightDecigrams === null
      ? translate("extractionConsole.idle")
      : translate("extractionConsole.lastShot", {
          weight: formatWeightReadout(finalWeightDecigrams),
        });
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.entry,
        compact && styles.entryCompact,
        readouts.running && styles.entryRunning,
        pressed && styles.pressed,
      ]}>
      <Text selectable style={styles.entryEyebrow}>
        {translate("extractionConsole.eyebrow")}
      </Text>
      <View style={styles.entryRow}>
        <Text selectable style={styles.entryValue}>
          {readouts.running ? readouts.elapsed : readouts.weight}
        </Text>
        <Text numberOfLines={2} selectable style={styles.entryStatus}>
          {status}
        </Text>
      </View>
      <Text selectable style={styles.entryAction}>
        {translate("extractionConsole.open")}
      </Text>
      {compact ? null : (
        <Text selectable style={styles.entryDetail}>
          {translate("extractionConsole.openDetail")}
        </Text>
      )}
    </Pressable>
  );
}

const PHASE_LABEL_KEYS: Record<ExtractionConsolePhase, string> = {
  idle: "extractionPreview.phaseIdle",
  manual: "extractionPreview.phaseManual",
  "main-extraction": "extractionPreview.phaseMain",
  "pre-infusion": "extractionPreview.phasePreInfusion",
  settling: "extractionConsole.phaseSettling",
  soak: "extractionPreview.phaseSoak",
};

function consolePhaseLabel(phase: ExtractionConsolePhase | null): string {
  return phase === null
    ? translate("extractionConsole.phaseUnknown")
    : translate(PHASE_LABEL_KEYS[phase]).toUpperCase();
}

function Readout({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.readout}>
      <Text selectable style={[styles.readoutLabel, { color }]}>
        {label}
      </Text>
      <Text
        adjustsFontSizeToFit
        numberOfLines={1}
        selectable
        style={styles.readoutValue}>
        {value}
      </Text>
    </View>
  );
}

function ProfileStrip({
  disabled,
  onSelect,
  state,
}: {
  disabled: boolean;
  onSelect: (selected: ExtractionSelection) => void;
  state: ExtractionPreviewState;
}) {
  const selected = state.selected;
  return (
    <View style={styles.profileStrip}>
      <Text selectable style={styles.stripLabel}>
        {translate("extractionPreview.profileCompact")}
      </Text>
      <View style={styles.profileChips}>
        {state.mobileProfiles.profiles.map((slot) => (
          <ProfileChip
            active={
              selected.kind === "profile" && selected.profileId === slot.id
            }
            disabled={disabled || slot.profile === null}
            key={slot.id}
            label={
              slot.profile?.name ?? translate("extractionPreview.emptySlot")
            }
            onPress={() => {
              if (slot.profile !== null) {
                onSelect({
                  kind: "profile",
                  profileId: slot.id as ProfileSlotId,
                  profile: { ...slot.profile },
                });
              }
            }}
          />
        ))}
        <ProfileChip
          active={selected.kind === "manual"}
          disabled={disabled}
          label={translate("extractionPreview.manual")}
          onPress={() => onSelect({ kind: "manual" })}
        />
      </View>
    </View>
  );
}

function ProfileChip({
  active,
  disabled,
  label,
  onPress,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        disabled && styles.chipDisabled,
        pressed && styles.pressed,
      ]}>
      <Text
        numberOfLines={1}
        selectable
        style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    backgroundColor: "#8B3A2B",
    borderCurve: "continuous",
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 52,
  },
  actionDisabled: { opacity: 0.42 },
  actionStop: { backgroundColor: "#C63F32" },
  actionText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  blockedText: {
    color: "#7A4C00",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  chip: {
    backgroundColor: "#F5EEE5",
    borderColor: "#D8C9BA",
    borderCurve: "continuous",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 40,
    minWidth: 74,
    paddingHorizontal: 10,
  },
  chipActive: { backgroundColor: "#8B3A2B", borderColor: "#8B3A2B" },
  chipDisabled: { opacity: 0.42 },
  chipText: {
    color: "#332A25",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    textAlign: "center",
  },
  chipTextActive: { color: "#FFFFFF" },
  close: {
    borderColor: "#8B3A2B",
    borderCurve: "continuous",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: 10,
  },
  closeText: {
    color: "#8B3A2B",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  controlPanel: {
    backgroundColor: "#FFFCF7",
    borderColor: "#DDD3C7",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  contextText: { color: "#5D5048", fontSize: 12, lineHeight: 17 },
  contextTitle: { color: "#332A25", fontSize: 13, fontWeight: "800" },
  controls: { gap: 10 },
  historyRow: { borderTopColor: "#DDD3C7", borderTopWidth: StyleSheet.hairlineWidth, gap: 2, paddingVertical: 8 },
  entry: {
    backgroundColor: "#FFFCF7",
    borderColor: "#DDD3C7",
    borderCurve: "continuous",
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    padding: 14,
  },
  entryAction: {
    color: "#8B3A2B",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  entryCompact: { gap: 4, padding: 11 },
  entryDetail: { color: "#5D5048", fontSize: 13, lineHeight: 19 },
  entryEyebrow: {
    color: "#76675D",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  entryRow: { alignItems: "baseline", flexDirection: "row", gap: 10 },
  entryRunning: { borderColor: "#A14B37", borderWidth: 2 },
  entryStatus: {
    color: "#332A25",
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    minWidth: 0,
  },
  entryValue: {
    color: "#241B17",
    fontSize: 28,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  header: { alignItems: "center", flexDirection: "row", gap: 10 },
  headerTitle: {
    color: "#6B5B51",
    flex: 1,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
    minWidth: 0,
  },
  landscapeBody: { flexDirection: "row", flex: 1, gap: 12, minHeight: 0 },
  landscapeChart: { flex: 1.9, minWidth: 0 },
  landscapeControlColumn: { flex: 1, minWidth: 0 },
  landscapeControls: { gap: 10, paddingBottom: 12 },
  pill: {
    backgroundColor: "#EAE2D7",
    borderCurve: "continuous",
    borderRadius: 999,
    color: "#5D5048",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pillActive: { backgroundColor: "#241B17", color: "#F2B66D" },
  portraitBody: { gap: 12, paddingBottom: 16 },
  pressed: { opacity: 0.7 },
  profileChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  profileStrip: { gap: 6 },
  readout: {
    borderLeftColor: "#DCCFC0",
    borderLeftWidth: StyleSheet.hairlineWidth,
    flex: 1,
    minWidth: 0,
    paddingLeft: 8,
  },
  readoutLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.9 },
  readoutValue: {
    color: "#211D19",
    fontSize: 19,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
  },
  readoutRow: {
    borderBottomColor: "#DCCFC0",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#DCCFC0",
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 6,
    paddingVertical: 8,
  },
  screen: { backgroundColor: "#F4F0E8", flex: 1, gap: 10 },
  statusPills: { alignItems: "center", flexDirection: "row", gap: 6 },
  stripLabel: {
    color: "#76675D",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  timer: {
    color: "#241B17",
    fontSize: 46,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
    letterSpacing: -1.5,
  },
  timerRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
});
