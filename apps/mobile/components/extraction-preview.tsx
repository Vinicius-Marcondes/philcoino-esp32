import {
  EXTRACTION_MAX_DURATION_SECONDS,
  ExtractionProfileSchema,
  type ExtractionPhase,
  type ExtractionProfile,
  type ProfileSlotId,
} from "@philcoino/protocol";
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  advanceExtractionPreview,
  canStartPreview,
  createExtractionPreviewState,
  exportProfilesPreview,
  profileDurationSeconds,
  profilesAreSynchronized,
  saveMobileProfile,
  selectPreview,
  selectedProfile,
  startExtractionPreview,
  stopExtractionPreview,
  type ExtractionPreviewState,
} from "@/src/debug/extraction-preview-model";
import { extractionPresentation } from "@/src/dashboard/extraction-presentation";
import { translate } from "@/src/localization/i18n";

interface ExtractionPreviewProps {
  debugPreview?: boolean;
  initialState?: ExtractionPreviewState;
  onStateChange?: Dispatch<SetStateAction<ExtractionPreviewState>>;
  state?: ExtractionPreviewState;
  view?: "all" | "profiles" | "quick";
  workflowBlock?: "cooldown" | "steam" | null;
  workflowMutationPending?: boolean;
}

export function ExtractionPreview({
  debugPreview = true,
  initialState,
  onStateChange,
  state: controlledState,
  view = "all",
  workflowBlock = null,
  workflowMutationPending = false,
}: ExtractionPreviewProps) {
  const [localState, setLocalState] = useState(
    () => initialState ?? createExtractionPreviewState(),
  );
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);
  const state = controlledState ?? localState;
  const setState = onStateChange ?? setLocalState;
  const interactivePreview = controlledState === undefined;
  const synchronized = profilesAreSynchronized(state);
  const startEnabled =
    canStartPreview(state) && workflowBlock === null && !workflowMutationPending;
  const active = state.extraction.status === "running";
  const extractionStatus = extractionPresentation(state.extraction);
  const customStartBlocked =
    !active && state.selected.kind === "profile" && !canStartPreview(state);
  const workflowStartBlocked = !active && workflowBlock !== null;
  const activeProfile = selectedProfile(state);
  const selectedProfileId =
    state.selected.kind === "profile" ? state.selected.profileId : null;
  const selectedProfileLabel =
    state.selected.kind === "manual"
      ? translate("extractionPreview.manual")
      : activeProfile?.name ?? translate("extractionPreview.emptySlot");

  useEffect(() => {
    if (active) {
      setProfilePickerOpen(false);
    }
  }, [active]);

  return (
    <View style={styles.section}>
      {debugPreview ? <View accessibilityLiveRegion="assertive" style={styles.previewBanner}>
        <Text selectable style={styles.previewEyebrow}>
          {translate("extractionPreview.eyebrow")}
        </Text>
        <Text selectable style={styles.previewWarning}>
          {translate("extractionPreview.warning")}
        </Text>
        <Text selectable style={styles.previewDetail}>
          {translate("extractionPreview.warningDetail")}
        </Text>
      </View> : null}

      {view === "profiles" ? <ProfileSyncCard
        active={active}
        onExport={() => setState(exportProfilesPreview)}
        state={state}
        synchronized={synchronized}
        workflowBlock={workflowBlock}
        workflowMutationPending={workflowMutationPending}
      /> : null}

      {view !== "quick" ? <View style={styles.card}>
        <SectionHeading
          eyebrow={translate(
            view === "profiles"
              ? "extractionPreview.profileConfiguration"
              : "extractionPreview.profiles",
          )}
          title={translate(
            view === "profiles"
              ? "extractionPreview.chooseProfileToEdit"
              : "extractionPreview.title",
          )}
        />
        <View accessibilityRole="radiogroup" style={styles.profileGrid}>
          {view !== "profiles" ? (
            <ProfileButton
              detail={translate("extractionPreview.manualDetail")}
              disabled={active}
              label={translate("extractionPreview.manual")}
              onPress={() =>
                setState((current) =>
                  selectPreview(current, { kind: "manual" }),
                )
              }
              selected={state.selected.kind === "manual"}
            />
          ) : null}
          {state.mobileProfiles.profiles.map((slot) => (
            <ProfileButton
              detail={slot.id}
              disabled={active}
              key={slot.id}
              label={
                slot.profile?.name ?? translate("extractionPreview.emptySlot")
              }
              onPress={() =>
                setState((current) =>
                  selectPreview(current, {
                    kind: "profile",
                    profileId: slot.id,
                  }),
                )
              }
              selected={
                state.selected.kind === "profile" &&
                state.selected.profileId === slot.id
              }
            />
          ))}
        </View>
      </View> : null}

      {view !== "quick" && view !== "profiles" ? <ProfileSyncCard
        active={active}
        onExport={() => setState(exportProfilesPreview)}
        state={state}
        synchronized={synchronized}
        workflowBlock={workflowBlock}
        workflowMutationPending={workflowMutationPending}
      /> : null}

      {view !== "quick" && selectedProfileId !== null ? (
        <ProfileEditor
          debugPreview={debugPreview}
          disabled={active}
          key={selectedProfileId}
          onClear={() =>
            setState((current) =>
              saveMobileProfile(current, selectedProfileId, null),
            )
          }
          onSave={(profile) =>
            setState((current) =>
              saveMobileProfile(current, selectedProfileId, profile),
            )
          }
          profile={activeProfile}
          profileId={selectedProfileId}
        />
      ) : null}

      {view !== "profiles" ? <View style={styles.extractionCard}>
        <SectionHeading
          eyebrow={translate("extractionPreview.extractionState")}
          title={extractionPresentationTitle(extractionStatus.title)}
        />
        {view === "quick" ? (
          <QuickProfilePicker
            active={active}
            expanded={profilePickerOpen}
            onExpandedChange={setProfilePickerOpen}
            onSelect={(selection) => {
              setState((current) => selectPreview(current, selection));
              setProfilePickerOpen(false);
            }}
            selectedLabel={selectedProfileLabel}
            state={state}
          />
        ) : null}
        <View style={styles.metricGrid}>
          <PreviewMetric
            label={translate("extractionPreview.phase")}
            value={phaseLabel(state.extraction.phase)}
          />
          <PreviewMetric
            label={translate("extractionPreview.elapsed")}
            value={formatPreviewTime(state.extraction.elapsedMs)}
          />
          <PreviewMetric
            label={translate("extractionPreview.remaining")}
            value={
              state.extraction.remainingMs === null
                ? "—"
                : formatPreviewTime(state.extraction.remainingMs)
            }
          />
        </View>
        <Text selectable style={styles.commandStatus}>
          {translate("extractionPreview.pumpCommand", {
            command: translate(
              extractionStatus.pumpCommand === "running"
                ? "extractionPreview.commandRunning"
                : "extractionPreview.commandOff",
            ),
          })}
        </Text>
        <Text selectable style={styles.commandBoundary}>
          {translate("extractionPreview.pumpBoundary")}
        </Text>
        {customStartBlocked ? (
          <Text accessibilityLiveRegion="polite" selectable style={styles.blockedText}>
            {activeProfile === null
              ? translate("extractionPreview.emptyStartBlocked")
              : translate("extractionPreview.startBlocked")}
          </Text>
        ) : null}
        {workflowStartBlocked ? (
          <Text accessibilityLiveRegion="polite" selectable style={styles.blockedText}>
            {translate(
              workflowBlock === "steam"
                ? "extractionPreview.steamStartBlocked"
                : "extractionPreview.cooldownStartBlocked",
            )}
          </Text>
        ) : null}
        <View style={styles.actionRow}>
          <ActionButton
            disabled={!startEnabled}
            label={translate("extractionPreview.start")}
            onPress={() => setState(startExtractionPreview)}
          />
          <ActionButton
            destructive
            disabled={!active}
            label={translate("extractionPreview.stop")}
            onPress={() => setState(stopExtractionPreview)}
          />
        </View>
        {active && debugPreview && interactivePreview ? (
          <ActionButton
            label={translate("extractionPreview.advance")}
            onPress={() => setState(advanceExtractionPreview)}
            secondary
          />
        ) : null}
        {state.notice === "started" ? (
          <Notice text={translate("extractionPreview.started")} />
        ) : null}
        {state.notice === "stopped" ? (
          <Notice text={translate("extractionPreview.stopped")} />
        ) : null}
      </View> : null}
    </View>
  );
}

function ProfileSyncCard({
  active,
  onExport,
  state,
  synchronized,
  workflowBlock,
  workflowMutationPending,
}: {
  active: boolean;
  onExport: () => void;
  state: ExtractionPreviewState;
  synchronized: boolean;
  workflowBlock: "cooldown" | "steam" | null;
  workflowMutationPending: boolean;
}) {
  return (
    <View style={styles.card}>
      <SectionHeading
        eyebrow={translate("extractionPreview.sync")}
        title={
          synchronized
            ? translate("extractionPreview.synchronized")
            : translate("extractionPreview.different")
        }
      />
      <Text selectable style={styles.helpText}>
        {translate("extractionPreview.syncHelp")}
      </Text>
      <ActionButton
        disabled={
          active ||
          synchronized ||
          workflowBlock === "cooldown" ||
          workflowMutationPending
        }
        label={translate("extractionPreview.export")}
        onPress={onExport}
      />
      {state.notice === "exported" ? (
        <Notice text={translate("extractionPreview.exported")} />
      ) : null}
      {state.notice === "export-blocked" ? (
        <Notice text={translate("extractionPreview.exportBlocked")} warning />
      ) : null}
      {workflowBlock === "cooldown" ? (
        <Notice
          text={translate("extractionPreview.cooldownExportBlocked")}
          warning
        />
      ) : null}
    </View>
  );
}

function QuickProfilePicker({
  active,
  expanded,
  onExpandedChange,
  onSelect,
  selectedLabel,
  state,
}: {
  active: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (selection: ExtractionPreviewState["selected"]) => void;
  selectedLabel: string;
  state: ExtractionPreviewState;
}) {
  return (
    <View style={styles.profilePicker}>
      <Pressable
        accessibilityLabel={translate("extractionPreview.selectProfile", {
          name: selectedLabel,
        })}
        accessibilityRole="button"
        accessibilityState={{ disabled: active, expanded }}
        disabled={active}
        onPress={() => onExpandedChange(!expanded)}
        style={({ pressed }) => [
          styles.profilePickerButton,
          active && styles.disabled,
          pressed && !active && styles.pressed,
        ]}>
        <View style={styles.profilePickerCopy}>
          <Text selectable style={styles.profilePickerLabel}>
            {translate("extractionPreview.profiles")}
          </Text>
          <Text selectable style={styles.profilePickerValue}>
            {selectedLabel}
          </Text>
        </View>
        <Text style={styles.profilePickerChevron}>{expanded ? "⌃" : "⌄"}</Text>
      </Pressable>

      {expanded ? (
        <View accessibilityRole="radiogroup" style={styles.profilePickerMenu}>
          <CompactProfileOption
            detail={translate("extractionPreview.manualDetail")}
            label={translate("extractionPreview.manual")}
            onPress={() => onSelect({ kind: "manual" })}
            selected={state.selected.kind === "manual"}
          />
          {state.mobileProfiles.profiles.map((slot) => (
            <CompactProfileOption
              detail={slot.id}
              key={slot.id}
              label={
                slot.profile?.name ?? translate("extractionPreview.emptySlot")
              }
              onPress={() =>
                onSelect({ kind: "profile", profileId: slot.id })
              }
              selected={
                state.selected.kind === "profile" &&
                state.selected.profileId === slot.id
              }
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CompactProfileOption({
  detail,
  label,
  onPress,
  selected,
}: {
  detail: string;
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={translate("extractionPreview.selectProfile", {
        name: label,
      })}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.profilePickerOption,
        selected && styles.profilePickerOptionSelected,
        pressed && styles.pressed,
      ]}>
      <View style={styles.profilePickerCopy}>
        <Text
          style={[
            styles.profilePickerOptionName,
            selected && styles.profilePickerOptionNameSelected,
          ]}>
          {label}
        </Text>
        <Text style={styles.profilePickerOptionDetail}>
          {selected ? translate("extractionPreview.selected") : detail}
        </Text>
      </View>
      {selected ? <Text style={styles.profilePickerCheck}>✓</Text> : null}
    </Pressable>
  );
}

function ProfileEditor({
  debugPreview,
  disabled,
  onClear,
  onSave,
  profile,
  profileId,
}: {
  debugPreview: boolean;
  disabled: boolean;
  onClear: () => void;
  onSave: (profile: ExtractionProfile) => void;
  profile: ExtractionProfile | null;
  profileId: ProfileSlotId;
}) {
  const [draft, setDraft] = useState<ExtractionProfile>(
    profile ?? {
      name: translate("extractionPreview.newProfileName"),
      preInfusionSeconds: 0,
      soakSeconds: 0,
      mainExtractionSeconds: 30,
    },
  );
  const [saved, setSaved] = useState(false);
  const parsed = useMemo(() => ExtractionProfileSchema.safeParse(draft), [draft]);

  useEffect(() => setSaved(false), [draft]);

  return (
    <View style={styles.card}>
      <SectionHeading
        eyebrow={translate("extractionPreview.editor")}
        title={profile?.name ?? translate("extractionPreview.emptySlot")}
      />
      <Text selectable style={styles.slotId}>{profileId}</Text>
      <Text selectable style={styles.helpText}>
        {translate("extractionPreview.editorHelp")}
      </Text>
      <Text selectable style={styles.inputLabel}>
        {translate("extractionPreview.profileName")}
      </Text>
      <TextInput
        accessibilityLabel={translate("extractionPreview.profileName")}
        autoCapitalize="words"
        editable={!disabled}
        maxLength={13}
        onChangeText={(name) => setDraft((current) => ({ ...current, name }))}
        placeholder={translate("extractionPreview.namePlaceholder")}
        style={styles.nameInput}
        value={draft.name}
      />
      <DurationStepper
        disabled={disabled}
        label={translate("extractionPreview.preInfusion")}
        onChange={(preInfusionSeconds) =>
          setDraft((current) => ({ ...current, preInfusionSeconds }))
        }
        value={draft.preInfusionSeconds}
      />
      <DurationStepper
        disabled={disabled}
        label={translate("extractionPreview.soak")}
        onChange={(soakSeconds) =>
          setDraft((current) => ({ ...current, soakSeconds }))
        }
        value={draft.soakSeconds}
      />
      <DurationStepper
        disabled={disabled}
        label={translate("extractionPreview.mainExtraction")}
        minimum={1}
        onChange={(mainExtractionSeconds) =>
          setDraft((current) => ({ ...current, mainExtractionSeconds }))
        }
        value={draft.mainExtractionSeconds}
      />
      <Text selectable style={styles.durationTotal}>
        {translate("extractionPreview.durationRange")} · {profileDurationSeconds(draft)}s
      </Text>
      {!parsed.success ? (
        <Text accessibilityLiveRegion="polite" selectable style={styles.validationText}>
          {translate("extractionPreview.invalidProfile")}
        </Text>
      ) : null}
      <View style={styles.actionRow}>
        <ActionButton
          disabled={disabled || !parsed.success}
          label={translate("extractionPreview.saveLocal")}
          onPress={() => {
            if (parsed.success) {
              onSave(parsed.data);
              setSaved(true);
            }
          }}
        />
        <ActionButton
          disabled={disabled || profile === null}
          label={translate("extractionPreview.clearSlot")}
          onPress={onClear}
          secondary
        />
      </View>
      {saved && debugPreview ? (
        <Notice text={translate("extractionPreview.localSaved")} />
      ) : null}
    </View>
  );
}

function DurationStepper({
  disabled,
  label,
  minimum = 0,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  minimum?: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text selectable style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperActions}>
        <RoundButton
          accessibilityLabel={translate("extractionPreview.decreaseSeconds", { label })}
          disabled={disabled || value <= minimum}
          label="−"
          onPress={() => onChange(Math.max(minimum, value - 1))}
        />
        <Text selectable style={styles.stepperValue}>
          {translate("extractionPreview.seconds", { value })}
        </Text>
        <RoundButton
          accessibilityLabel={translate("extractionPreview.increaseSeconds", { label })}
          disabled={disabled || value >= EXTRACTION_MAX_DURATION_SECONDS}
          label="+"
          onPress={() =>
            onChange(Math.min(EXTRACTION_MAX_DURATION_SECONDS, value + 1))
          }
        />
      </View>
    </View>
  );
}

function ProfileButton({
  detail,
  disabled,
  label,
  onPress,
  selected,
}: {
  detail: string;
  disabled: boolean;
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={translate("extractionPreview.selectProfile", { name: label })}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.profileButton,
        selected && styles.profileButtonSelected,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text style={[styles.profileName, selected && styles.profileNameSelected]}>
        {label}
      </Text>
      <Text style={[styles.profileDetail, selected && styles.profileDetailSelected]}>
        {selected ? translate("extractionPreview.selected") : detail}
      </Text>
    </Pressable>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View style={styles.heading}>
      <Text selectable style={styles.eyebrow}>{eyebrow}</Text>
      <Text selectable style={styles.title}>{title}</Text>
    </View>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text selectable style={styles.metricLabel}>{label}</Text>
      <Text selectable style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function ActionButton({
  destructive = false,
  disabled = false,
  label,
  onPress,
  secondary = false,
}: {
  destructive?: boolean;
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
        destructive && styles.stopButton,
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

function RoundButton({
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
        styles.roundButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text style={styles.roundButtonText}>{label}</Text>
    </Pressable>
  );
}

function Notice({ text, warning = false }: { text: string; warning?: boolean }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.notice, warning && styles.noticeWarning]}>
      <Text selectable style={styles.noticeText}>{text}</Text>
    </View>
  );
}

export function phaseLabel(phase: ExtractionPhase): string {
  const keys: Record<ExtractionPhase, string> = {
    idle: "extractionPreview.phaseIdle",
    manual: "extractionPreview.phaseManual",
    "pre-infusion": "extractionPreview.phasePreInfusion",
    soak: "extractionPreview.phaseSoak",
    "main-extraction": "extractionPreview.phaseMain",
  };
  return translate(keys[phase]);
}

export function extractionPresentationTitle(
  title: "completed" | "failed" | "idle" | "running" | "stopped",
): string {
  const keys = {
    completed: "extractionPreview.terminalCompleted",
    failed: "extractionPreview.terminalFailed",
    idle: "extractionPreview.idle",
    running: "extractionPreview.running",
    stopped: "extractionPreview.terminalStopped",
  } as const;
  return translate(keys[title]);
}

export function formatPreviewTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `0:${totalSeconds.toString().padStart(2, "0")}`;
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
  previewEyebrow: {
    color: "#F2B66D",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  previewWarning: { color: "#FFFFFF", fontSize: 19, fontWeight: "900" },
  previewDetail: { color: "#E7D9CE", fontSize: 14, lineHeight: 20 },
  card: {
    backgroundColor: "#FFFCF7",
    borderColor: "#DDD3C7",
    borderCurve: "continuous",
    borderRadius: 22,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  extractionCard: {
    backgroundColor: "#F3E6DC",
    borderColor: "#D3B9A7",
    borderCurve: "continuous",
    borderRadius: 22,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  heading: { gap: 4 },
  eyebrow: {
    color: "#8B3A2B",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  title: { color: "#241B17", fontSize: 21, fontWeight: "800" },
  profileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  profilePicker: { gap: 8 },
  profilePickerButton: {
    alignItems: "center",
    backgroundColor: "#FFF9F3",
    borderColor: "#D3B9A7",
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  profilePickerCopy: { flex: 1, gap: 2 },
  profilePickerLabel: {
    color: "#8B3A2B",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  profilePickerValue: { color: "#241B17", fontSize: 17, fontWeight: "800" },
  profilePickerChevron: { color: "#8B3A2B", fontSize: 22, fontWeight: "800" },
  profilePickerMenu: {
    backgroundColor: "#FFF9F3",
    borderColor: "#D3B9A7",
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  profilePickerOption: {
    alignItems: "center",
    borderBottomColor: "#E2D3C5",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  profilePickerOptionSelected: { backgroundColor: "#F1DED3" },
  profilePickerOptionName: { color: "#332A25", fontSize: 15, fontWeight: "800" },
  profilePickerOptionNameSelected: { color: "#7D3024" },
  profilePickerOptionDetail: { color: "#76675D", fontSize: 11, fontWeight: "700" },
  profilePickerCheck: { color: "#8B3A2B", fontSize: 18, fontWeight: "900" },
  profileButton: {
    backgroundColor: "#F5EEE5",
    borderColor: "#D8C9BA",
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    flexBasis: 145,
    flexGrow: 1,
    gap: 4,
    minHeight: 78,
    padding: 14,
  },
  profileButtonSelected: { backgroundColor: "#8B3A2B", borderColor: "#8B3A2B" },
  profileName: { color: "#332A25", fontSize: 17, fontWeight: "800" },
  profileNameSelected: { color: "#FFFFFF" },
  profileDetail: { color: "#76675D", fontSize: 11, fontWeight: "700" },
  profileDetailSelected: { color: "#F3D9D2" },
  helpText: { color: "#695A50", fontSize: 14, lineHeight: 20 },
  slotId: { color: "#8B3A2B", fontSize: 12, fontWeight: "800" },
  inputLabel: { color: "#332A25", fontSize: 14, fontWeight: "800" },
  nameInput: {
    backgroundColor: "#FFFFFF",
    borderColor: "#BBAEA1",
    borderRadius: 14,
    borderWidth: 1,
    color: "#241B17",
    fontSize: 17,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  stepperRow: {
    alignItems: "center",
    backgroundColor: "#F5EEE5",
    borderCurve: "continuous",
    borderRadius: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    padding: 12,
  },
  stepperLabel: { color: "#332A25", flexGrow: 1, fontSize: 15, fontWeight: "800" },
  stepperActions: { alignItems: "center", flexDirection: "row", gap: 9 },
  stepperValue: {
    color: "#241B17",
    fontSize: 18,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
    minWidth: 50,
    textAlign: "center",
  },
  roundButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#BBAEA1",
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  roundButtonText: { color: "#8B3A2B", fontSize: 25, fontWeight: "700" },
  durationTotal: { color: "#695A50", fontSize: 13, fontVariant: ["tabular-nums"] },
  validationText: { color: "#9E2E24", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: {
    backgroundColor: "#FFF9F3",
    borderCurve: "continuous",
    borderRadius: 14,
    flexBasis: 88,
    flexGrow: 1,
    gap: 3,
    minWidth: 88,
    padding: 12,
  },
  metricLabel: { color: "#76675D", fontSize: 11, fontWeight: "800" },
  metricValue: {
    color: "#241B17",
    fontSize: 18,
    fontVariant: ["tabular-nums"],
    fontWeight: "900",
  },
  commandStatus: { color: "#6F2F28", fontSize: 13, fontWeight: "800" },
  commandBoundary: { color: "#5B4037", fontSize: 13, lineHeight: 19 },
  blockedText: { color: "#9E2E24", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  actionButton: {
    alignItems: "center",
    backgroundColor: "#8B3A2B",
    borderColor: "#8B3A2B",
    borderRadius: 999,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 130,
    paddingHorizontal: 16,
  },
  stopButton: { backgroundColor: "#47211B", borderColor: "#47211B" },
  secondaryButton: { backgroundColor: "transparent" },
  actionButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
  secondaryButtonText: { color: "#8B3A2B" },
  notice: {
    backgroundColor: "#E5F1E8",
    borderColor: "#A9C9B0",
    borderCurve: "continuous",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  noticeWarning: { backgroundColor: "#F5E8C9", borderColor: "#D4B86F" },
  noticeText: { color: "#3E4E42", fontSize: 13, fontWeight: "700", lineHeight: 19 },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.7 },
});
