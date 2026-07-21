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
import {
  idleProfileImportState,
  profileImportChanges,
  type ProfileImportState,
} from "@/src/profiles/profile-import";
import { cloneProfileSet } from "@/src/profiles/profile-set";

interface ExtractionPreviewProps {
  compact?: boolean;
  debugPreview?: boolean;
  initialState?: ExtractionPreviewState;
  onCancelProfileImport?: () => void;
  onConfirmProfileImport?: () => void;
  onImportProfiles?: () => void;
  onOpenMachine?: () => void;
  onOpenProfiles?: () => void;
  onStateChange?: Dispatch<SetStateAction<ExtractionPreviewState>>;
  profileActionsDisabled?: boolean;
  profileImportState?: ProfileImportState;
  profilesSynchronized?: boolean;
  profileWritePending?: boolean;
  state?: ExtractionPreviewState;
  view?: "all" | "profiles" | "quick";
  workflowBlock?: "cooldown" | "steam" | null;
  workflowMutationPending?: boolean;
}

export function ExtractionPreview({
  compact = false,
  debugPreview = true,
  initialState,
  onCancelProfileImport,
  onConfirmProfileImport,
  onImportProfiles,
  onOpenMachine,
  onOpenProfiles,
  onStateChange,
  profileActionsDisabled = false,
  profileImportState: controlledProfileImportState,
  profilesSynchronized: controlledProfilesSynchronized,
  profileWritePending = false,
  state: controlledState,
  view = "all",
  workflowBlock = null,
  workflowMutationPending = false,
}: ExtractionPreviewProps) {
  const [localState, setLocalState] = useState(
    () => initialState ?? createExtractionPreviewState(),
  );
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);
  const [localProfileImportState, setLocalProfileImportState] =
    useState<ProfileImportState>(idleProfileImportState);
  const state = controlledState ?? localState;
  const setState = onStateChange ?? setLocalState;
  const interactivePreview = controlledState === undefined;
  const profileImportState =
    controlledProfileImportState ?? localProfileImportState;
  const synchronized =
    controlledProfilesSynchronized ?? profilesAreSynchronized(state);
  const selectionCanStart =
    canStartPreview(state) &&
    (state.selected.kind === "manual" || synchronized);
  const startEnabled =
    selectionCanStart && workflowBlock === null && !workflowMutationPending;
  const active = state.extraction.status === "running";
  const extractionStatus = extractionPresentation(state.extraction);
  const customStartBlocked =
    !active && state.selected.kind === "profile" && !selectionCanStart;
  const workflowStartBlocked = !active && workflowBlock !== null;
  const activeProfile = selectedProfile(state);
  const compactQuickAction = workflowStartBlocked
    ? {
        accessibilityHint: translate(
          workflowBlock === "steam"
            ? "extractionPreview.steamStartBlocked"
            : "extractionPreview.cooldownStartBlocked",
        ),
        label: translate(
          workflowBlock === "steam"
            ? "extractionPreview.steamModeCompact"
            : "extractionPreview.cooldownActiveCompact",
        ),
        onPress: onOpenMachine,
      }
    : customStartBlocked
      ? {
          accessibilityHint: translate(
            activeProfile === null
              ? "extractionPreview.emptyStartBlocked"
              : "extractionPreview.startBlocked",
          ),
          label: translate(
            activeProfile === null
              ? "extractionPreview.completeProfileCompact"
              : "extractionPreview.exportProfilesCompact",
          ),
          onPress: onOpenProfiles,
        }
      : {
          accessibilityHint: translate(
            "extractionPreview.openProfilesCompactHint",
          ),
          label: translate("extractionPreview.exportProfilesCompact"),
          onPress: onOpenProfiles,
        };
  const selectedProfileId =
    state.selected.kind === "profile" ? state.selected.profileId : null;
  const selectedProfileLabel =
    state.selected.kind === "manual"
      ? translate("extractionPreview.manual")
      : activeProfile?.name ?? translate("extractionPreview.emptySlot");
  const profileEditorKey = `${selectedProfileId}:${JSON.stringify(activeProfile)}`;
  const profileReviewOpen =
    profileImportState.status === "reviewing" ||
    (profileImportState.status === "rejected" &&
      profileImportState.changes.length > 0);
  const requestProfileImport = () => {
    if (onImportProfiles !== undefined) {
      onImportProfiles();
      return;
    }
    const changes = profileImportChanges(
      state.mobileProfiles,
      state.machineProfiles,
    );
    setLocalProfileImportState(
      changes.length === 0
        ? {
            changes: [],
            outcome: "already-matches",
            status: "acknowledged",
          }
        : { changes, outcome: null, status: "reviewing" },
    );
  };
  const confirmProfileImport = () => {
    if (onConfirmProfileImport !== undefined) {
      onConfirmProfileImport();
      return;
    }
    setState((current) => ({
      ...current,
      mobileProfiles: cloneProfileSet(current.machineProfiles),
      notice: null,
    }));
    setLocalProfileImportState({
      changes: [],
      outcome: "imported",
      status: "acknowledged",
    });
  };
  const cancelProfileImport = () => {
    if (onCancelProfileImport !== undefined) {
      onCancelProfileImport();
      return;
    }
    setLocalProfileImportState(idleProfileImportState);
  };

  useEffect(() => {
    if (active) {
      setProfilePickerOpen(false);
    }
  }, [active]);

  return (
    <View
      style={[
        styles.section,
        compact && view === "profiles" && styles.sectionLandscape,
        compact && view === "quick" && styles.sectionCompactQuick,
      ]}>
      {debugPreview ? <View
        accessibilityLiveRegion="assertive"
        style={[
          styles.previewBanner,
          compact && view === "profiles" && styles.previewBannerLandscape,
        ]}>
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

      {view === "profiles" && compact ? (
        <View style={styles.profileWorkspaceRow}>
          {selectedProfileId !== null ? (
            <ProfileEditor
              compact
              debugPreview={debugPreview}
              disabled={active || profileWritePending || profileReviewOpen}
              key={profileEditorKey}
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
          <View style={styles.profileSidebar}>
            <ProfileSelectionCard
              active={active}
              compact
              onSelect={(selection) =>
                setState((current) => selectPreview(current, selection))
              }
              state={state}
              view={view}
            />
            <ProfileSyncCard
              active={active}
              compact
              importState={profileImportState}
              onCancelImport={cancelProfileImport}
              onConfirmImport={confirmProfileImport}
              onExport={() => setState(exportProfilesPreview)}
              onImport={requestProfileImport}
              profileActionsDisabled={profileActionsDisabled}
              profileWritePending={profileWritePending}
              state={state}
              synchronized={synchronized}
              workflowBlock={workflowBlock}
              workflowMutationPending={workflowMutationPending}
            />
          </View>
        </View>
      ) : (
        <>
          {view === "profiles" ? (
            <ProfileSyncCard
              active={active}
              compact={compact}
              importState={profileImportState}
              onCancelImport={cancelProfileImport}
              onConfirmImport={confirmProfileImport}
              onExport={() => setState(exportProfilesPreview)}
              onImport={requestProfileImport}
              profileActionsDisabled={profileActionsDisabled}
              profileWritePending={profileWritePending}
              state={state}
              synchronized={synchronized}
              workflowBlock={workflowBlock}
              workflowMutationPending={workflowMutationPending}
            />
          ) : null}
          {view !== "quick" ? (
            <ProfileSelectionCard
              active={active}
              compact={compact}
              onSelect={(selection) =>
                setState((current) => selectPreview(current, selection))
              }
              state={state}
              view={view}
            />
          ) : null}
        </>
      )}

      {view !== "quick" && view !== "profiles" ? <ProfileSyncCard
        active={active}
        compact={compact}
        importState={profileImportState}
        onCancelImport={cancelProfileImport}
        onConfirmImport={confirmProfileImport}
        onExport={() => setState(exportProfilesPreview)}
        onImport={requestProfileImport}
        profileActionsDisabled={profileActionsDisabled}
        profileWritePending={profileWritePending}
        state={state}
        synchronized={synchronized}
        workflowBlock={workflowBlock}
        workflowMutationPending={workflowMutationPending}
      /> : null}

      {view !== "quick" &&
      selectedProfileId !== null &&
      !(view === "profiles" && compact) ? (
        <ProfileEditor
          compact={compact}
          debugPreview={debugPreview}
          disabled={active || profileWritePending || profileReviewOpen}
          key={profileEditorKey}
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

      {view !== "profiles" ? <View style={[styles.extractionCard, compact && styles.extractionCardCompact]}>
      <SectionHeading
        compact={compact}
        eyebrow={translate("extractionPreview.extractionState")}
          title={extractionPresentationTitle(extractionStatus.title)}
        />
        {view === "quick" ? (
          <View style={compact && styles.quickControlRow}>
            <View style={compact && styles.compactSelectorColumn}>
              <QuickProfilePicker
                active={active}
                compact={compact}
                expanded={profilePickerOpen}
                onExpandedChange={setProfilePickerOpen}
                onSelect={(selection) => {
                  setState((current) => selectPreview(current, selection));
                  setProfilePickerOpen(false);
                }}
                selectedLabel={selectedProfileLabel}
                state={state}
              />
              {compact ? (
                <CompactBlockStatus {...compactQuickAction} />
              ) : null}
            </View>
            {compact ? (
              <View style={styles.compactAction}>
                {active ? (
                  <ActionButton
                    compact
                    destructive
                    grow
                    label={translate("extractionPreview.stop")}
                    onPress={() => setState(stopExtractionPreview)}
                  />
                ) : (
                  <ActionButton
                    compact
                    disabled={!startEnabled}
                    grow
                    label={translate("extractionPreview.start")}
                    onPress={() => setState(startExtractionPreview)}
                  />
                )}
              </View>
            ) : null}
          </View>
        ) : null}
        {!compact || view !== "quick" ? (
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
        ) : null}
        {!compact || view !== "quick" ? (
          <>
            <Text
              accessibilityHint={translate("extractionPreview.pumpBoundary")}
              selectable
              style={styles.commandStatus}>
              {translate("extractionPreview.pumpCommand", {
                command: translate(
                  extractionStatus.pumpCommand === "running"
                    ? "extractionPreview.commandRunning"
                    : "extractionPreview.commandOff",
                ),
              })}
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
          </>
        ) : null}
        {!compact || view !== "quick" ? (
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
        ) : null}
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
  compact,
  importState,
  onCancelImport,
  onConfirmImport,
  onExport,
  onImport,
  profileActionsDisabled,
  profileWritePending,
  state,
  synchronized,
  workflowBlock,
  workflowMutationPending,
}: {
  active: boolean;
  compact: boolean;
  importState: ProfileImportState;
  onCancelImport: () => void;
  onConfirmImport: () => void;
  onExport: () => void;
  onImport: () => void;
  profileActionsDisabled: boolean;
  profileWritePending: boolean;
  state: ExtractionPreviewState;
  synchronized: boolean;
  workflowBlock: "cooldown" | "steam" | null;
  workflowMutationPending: boolean;
}) {
  return (
    <View style={[styles.card, compact && styles.landscapePanel]}>
      <SectionHeading
        compact={compact}
        eyebrow={translate("extractionPreview.sync")}
        title={
          synchronized
            ? translate("extractionPreview.synchronized")
            : translate("extractionPreview.different")
        }
      />
      <Text
        numberOfLines={compact ? 1 : undefined}
        selectable
        style={[styles.helpText, compact && styles.helpTextCompact]}>
        {translate(
          compact
            ? "extractionPreview.syncHelpCompact"
            : "extractionPreview.syncHelp",
        )}
      </Text>
      <ActionButton
        compact={compact}
        disabled={
          active ||
          synchronized ||
          workflowBlock === "cooldown" ||
          workflowMutationPending ||
          profileActionsDisabled ||
          profileWritePending ||
          importState.status === "loading" ||
          importState.status === "reviewing" ||
          importState.status === "saving"
        }
        label={translate("extractionPreview.export")}
        onPress={onExport}
      />
      <ActionButton
        compact={compact}
        disabled={
          active ||
          workflowMutationPending ||
          profileActionsDisabled ||
          profileWritePending ||
          importState.status === "loading" ||
          importState.status === "reviewing" ||
          importState.status === "saving"
        }
        label={
          importState.status === "loading"
            ? translate("extractionPreview.importingProfiles")
            : translate("extractionPreview.importProfiles")
        }
        onPress={onImport}
        secondary
      />
      {importState.changes.length > 0 &&
      (importState.status === "reviewing" ||
        importState.status === "saving" ||
        importState.status === "rejected") ? (
        <View
          accessibilityLiveRegion="polite"
          style={styles.importReview}>
          <Text selectable style={styles.importReviewTitle}>
            {translate("extractionPreview.importReviewTitle")}
          </Text>
          <Text selectable style={styles.helpText}>
            {translate("extractionPreview.importReviewHelp")}
          </Text>
          {importState.changes.map((change) => (
            <View key={change.id} style={styles.importChange}>
              <Text selectable style={styles.slotId}>{change.id}</Text>
              <ProfileImportValue
                label={translate("extractionPreview.localProfileValue")}
                profile={change.localProfile}
              />
              <Text style={styles.importArrow}>↓</Text>
              <ProfileImportValue
                label={translate("extractionPreview.machineProfileValue")}
                profile={change.machineProfile}
              />
            </View>
          ))}
          {importState.outcome === "save-failed" ? (
            <Notice
              text={translate("extractionPreview.importSaveFailed")}
              warning
            />
          ) : null}
          <View style={styles.actionRow}>
            <ActionButton
              compact={compact}
              disabled={importState.status === "saving"}
              label={
                importState.status === "saving"
                  ? translate("extractionPreview.importSaving")
                  : translate("extractionPreview.confirmImport")
              }
              onPress={onConfirmImport}
            />
            <ActionButton
              compact={compact}
              disabled={importState.status === "saving"}
              label={translate("extractionPreview.cancelImport")}
              onPress={onCancelImport}
              secondary
            />
          </View>
        </View>
      ) : null}
      {importState.status === "acknowledged" ? (
        <Notice
          text={translate(
            importState.outcome === "already-matches"
              ? "extractionPreview.importAlreadyMatches"
              : "extractionPreview.importedProfiles",
          )}
        />
      ) : null}
      {importState.status === "rejected" &&
      importState.changes.length === 0 ? (
        <Notice
          text={translate(
            importState.outcome === "stale-review"
              ? "extractionPreview.importReviewStale"
              : importState.outcome === "local-unavailable"
                ? "extractionPreview.importLocalUnavailable"
                : "extractionPreview.importReadFailed",
          )}
          warning
        />
      ) : null}
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

function ProfileImportValue({
  label,
  profile,
}: {
  label: string;
  profile: ExtractionProfile | null;
}) {
  return (
    <View style={styles.importValue}>
      <Text selectable style={styles.importValueLabel}>{label}</Text>
      <Text selectable style={styles.importValueName}>
        {profile?.name ?? translate("extractionPreview.emptySlot")}
      </Text>
      {profile !== null ? (
        <Text selectable style={styles.importValueTiming}>
          {translate("extractionPreview.profileTiming", {
            main: profile.mainExtractionSeconds,
            pre: profile.preInfusionSeconds,
            soak: profile.soakSeconds,
          })}
        </Text>
      ) : null}
    </View>
  );
}

function ProfileSelectionCard({
  active,
  compact,
  onSelect,
  state,
  view,
}: {
  active: boolean;
  compact: boolean;
  onSelect: (selection: ExtractionPreviewState["selected"]) => void;
  state: ExtractionPreviewState;
  view: "all" | "profiles";
}) {
  return (
    <View style={[styles.card, compact && styles.landscapePanel]}>
      <SectionHeading
        compact={compact}
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
      <View
        accessibilityRole="radiogroup"
        style={[styles.profileGrid, compact && styles.profileGridCompact]}>
        {view !== "profiles" ? (
          <ProfileButton
            compact={compact}
            detail={translate("extractionPreview.manualDetail")}
            disabled={active}
            label={translate("extractionPreview.manual")}
            onPress={() => onSelect({ kind: "manual" })}
            selected={state.selected.kind === "manual"}
          />
        ) : null}
        {state.mobileProfiles.profiles.map((slot) => (
          <ProfileButton
            compact={compact}
            detail={slot.id}
            disabled={active}
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
    </View>
  );
}

function QuickProfilePicker({
  active,
  compact,
  expanded,
  onExpandedChange,
  onSelect,
  selectedLabel,
  state,
}: {
  active: boolean;
  compact: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (selection: ExtractionPreviewState["selected"]) => void;
  selectedLabel: string;
  state: ExtractionPreviewState;
}) {
  return (
    <View style={[styles.profilePicker, compact && styles.profilePickerCompact]}>
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
            {translate(
              compact
                ? "extractionPreview.profileCompact"
                : "extractionPreview.profiles",
            )}
          </Text>
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.72}
            numberOfLines={1}
            selectable
            style={styles.profilePickerValue}>
            {selectedLabel}
          </Text>
        </View>
        <Text style={styles.profilePickerChevron}>{expanded ? "⌃" : "⌄"}</Text>
      </Pressable>

      {expanded ? (
        <View
          accessibilityRole="radiogroup"
          style={[
            styles.profilePickerMenu,
            compact && styles.profilePickerMenuCompact,
          ]}>
          <CompactProfileOption
            compact={compact}
            detail={translate("extractionPreview.manualDetail")}
            fullRow={compact}
            label={translate("extractionPreview.manual")}
            onPress={() => onSelect({ kind: "manual" })}
            selected={state.selected.kind === "manual"}
          />
          {state.mobileProfiles.profiles.map((slot) => (
            <CompactProfileOption
              compact={compact}
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
  compact,
  detail,
  fullRow = false,
  label,
  onPress,
  selected,
}: {
  compact: boolean;
  detail: string;
  fullRow?: boolean;
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
        compact && styles.profilePickerOptionCompact,
        fullRow && styles.profilePickerOptionFullRow,
        selected && styles.profilePickerOptionSelected,
        pressed && styles.pressed,
      ]}>
      <View style={styles.profilePickerCopy}>
        <Text
          numberOfLines={compact ? 1 : undefined}
          style={[
            styles.profilePickerOptionName,
            compact && styles.profilePickerOptionNameCompact,
            selected && styles.profilePickerOptionNameSelected,
          ]}>
          {label}
        </Text>
        <Text
          numberOfLines={compact ? 1 : undefined}
          style={[
            styles.profilePickerOptionDetail,
            compact && styles.profilePickerOptionDetailCompact,
          ]}>
          {selected ? translate("extractionPreview.selected") : detail}
        </Text>
      </View>
      {selected ? (
        <Text
          style={[
            styles.profilePickerCheck,
            compact && styles.profilePickerCheckCompact,
          ]}>
          ✓
        </Text>
      ) : null}
    </Pressable>
  );
}

function ProfileEditor({
  compact,
  debugPreview,
  disabled,
  onClear,
  onSave,
  profile,
  profileId,
}: {
  compact: boolean;
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
    <View
      style={[
        styles.card,
        compact && styles.profileEditorLandscapePanel,
      ]}>
      <View style={compact && styles.profileEditorHeadingColumn}>
        <SectionHeading
          compact={compact}
          eyebrow={translate("extractionPreview.editor")}
          title={profile?.name ?? translate("extractionPreview.emptySlot")}
        />
        {!compact ? (
          <>
            <Text selectable style={styles.slotId}>{profileId}</Text>
            <Text selectable style={styles.helpText}>
              {translate("extractionPreview.editorHelp")}
            </Text>
          </>
        ) : (
          <Text selectable style={styles.durationTotal}>
            {translate("extractionPreview.durationRange")} · {profileDurationSeconds(draft)}s
          </Text>
        )}
      </View>
      <View style={compact && styles.profileEditorNameColumn}>
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
          style={[styles.nameInput, compact && styles.nameInputCompact]}
          value={draft.name}
        />
      </View>
      <View
        style={[
          styles.profileEditorStepperList,
          compact && styles.profileEditorStepperGrid,
        ]}>
        <DurationStepper
          compact={compact}
          disabled={disabled}
          label={translate("extractionPreview.preInfusion")}
          onChange={(preInfusionSeconds) =>
            setDraft((current) => ({ ...current, preInfusionSeconds }))
          }
          value={draft.preInfusionSeconds}
        />
        <DurationStepper
          compact={compact}
          disabled={disabled}
          label={translate("extractionPreview.soak")}
          onChange={(soakSeconds) =>
            setDraft((current) => ({ ...current, soakSeconds }))
          }
          value={draft.soakSeconds}
        />
        <DurationStepper
          compact={compact}
          disabled={disabled}
          label={translate("extractionPreview.mainExtraction")}
          minimum={1}
          onChange={(mainExtractionSeconds) =>
            setDraft((current) => ({ ...current, mainExtractionSeconds }))
          }
          value={draft.mainExtractionSeconds}
        />
      </View>
      {!compact ? (
        <Text selectable style={styles.durationTotal}>
          {translate("extractionPreview.durationRange")} · {profileDurationSeconds(draft)}s
        </Text>
      ) : null}
      <View style={[styles.actionRow, compact && styles.profileEditorActions]}>
        <ActionButton
          compact={compact}
          disabled={disabled || !parsed.success}
          grow={compact}
          label={translate("extractionPreview.saveLocal")}
          onPress={() => {
            if (parsed.success) {
              onSave(parsed.data);
              setSaved(true);
            }
          }}
        />
        <ActionButton
          compact={compact}
          disabled={disabled || profile === null}
          grow={compact}
          label={translate("extractionPreview.clearSlot")}
          onPress={onClear}
          secondary
        />
      </View>
      {!parsed.success ? (
        <View style={compact && styles.profileEditorFeedback}>
          <Text accessibilityLiveRegion="polite" selectable style={styles.validationText}>
            {translate("extractionPreview.invalidProfile")}
          </Text>
        </View>
      ) : null}
      {saved && debugPreview ? (
        <View style={compact && styles.profileEditorFeedback}>
          <Notice text={translate("extractionPreview.localSaved")} />
        </View>
      ) : null}
    </View>
  );
}

function DurationStepper({
  compact,
  disabled,
  label,
  minimum = 0,
  onChange,
  value,
}: {
  compact: boolean;
  disabled: boolean;
  label: string;
  minimum?: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <View style={[styles.stepperRow, compact && styles.stepperRowCompact]}>
      <Text
        numberOfLines={compact ? 1 : undefined}
        selectable
        style={[styles.stepperLabel, compact && styles.stepperLabelCompact]}>
        {label}
      </Text>
      <View style={[styles.stepperActions, compact && styles.stepperActionsCompact]}>
        <RoundButton
          accessibilityLabel={translate("extractionPreview.decreaseSeconds", { label })}
          compact={compact}
          disabled={disabled || value <= minimum}
          label="−"
          onPress={() => onChange(Math.max(minimum, value - 1))}
        />
        <Text
          selectable
          style={[
            styles.stepperValue,
            compact && styles.stepperValueCompact,
          ]}>
          {translate("extractionPreview.seconds", { value })}
        </Text>
        <RoundButton
          accessibilityLabel={translate("extractionPreview.increaseSeconds", { label })}
          compact={compact}
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
  compact,
  detail,
  disabled,
  label,
  onPress,
  selected,
}: {
  compact: boolean;
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
        compact && styles.profileButtonCompact,
        selected && styles.profileButtonSelected,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        numberOfLines={1}
        style={[
          styles.profileName,
          compact && styles.profileNameCompact,
          selected && styles.profileNameSelected,
        ]}>
        {label}
      </Text>
      <Text style={[styles.profileDetail, selected && styles.profileDetailSelected]}>
        {selected ? translate("extractionPreview.selected") : detail}
      </Text>
    </Pressable>
  );
}

function SectionHeading({
  compact = false,
  eyebrow,
  title,
}: {
  compact?: boolean;
  eyebrow: string;
  title: string;
}) {
  return (
    <View style={[styles.heading, compact && styles.headingCompact]}>
      <Text selectable style={[styles.eyebrow, compact && styles.eyebrowCompact]}>{eyebrow}</Text>
      <Text selectable style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
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
  compact = false,
  destructive = false,
  disabled = false,
  grow = false,
  label,
  onPress,
  secondary = false,
}: {
  compact?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  grow?: boolean;
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
        compact && styles.actionButtonCompact,
        grow && styles.actionButtonGrow,
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
        styles.roundButton,
        compact && styles.roundButtonCompact,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text
        style={[
          styles.roundButtonText,
          compact && styles.roundButtonTextCompact,
        ]}>
        {label}
      </Text>
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

function CompactBlockStatus({
  accessibilityHint,
  label,
  onPress,
}: {
  accessibilityHint: string;
  label: string;
  onPress?: () => void;
}) {
  if (onPress === undefined) {
    return (
      <View
        accessibilityHint={accessibilityHint}
        accessibilityLabel={label}
        accessibilityLiveRegion="polite"
        accessible
        style={styles.compactBlockStatus}>
        <Text numberOfLines={1} style={styles.compactBlockLabel}>
          {label}
        </Text>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="button"
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [
        styles.compactBlockStatus,
        pressed && styles.pressed,
      ]}>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        numberOfLines={1}
        style={styles.compactBlockLabel}>
        {label}
      </Text>
      <Text style={styles.compactBlockChevron}>›</Text>
    </Pressable>
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
  sectionLandscape: { gap: 12 },
  sectionCompactQuick: { flex: 1, minWidth: 0 },
  profileWorkspaceRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 12,
  },
  profileSidebar: { flex: 1, gap: 12, minWidth: 0 },
  landscapePanel: {
    borderRadius: 18,
    flexBasis: 0,
    flexGrow: 1,
    gap: 8,
    minWidth: 0,
    padding: 12,
  },
  profileEditorLandscapePanel: {
    borderRadius: 18,
    flex: 1,
    gap: 8,
    minWidth: 0,
    padding: 12,
  },
  profileEditorHeadingColumn: { gap: 4, minWidth: 0 },
  profileEditorNameColumn: { gap: 5, minWidth: 0 },
  profileEditorStepperList: { gap: 10 },
  profileEditorStepperGrid: {
    flexDirection: "row",
    gap: 6,
    minWidth: 0,
  },
  profileEditorActions: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 6,
    minWidth: 0,
  },
  profileEditorFeedback: { width: "100%" },
  previewBanner: {
    backgroundColor: "#2F2722",
    borderColor: "#5D4B40",
    borderCurve: "continuous",
    borderRadius: 22,
    borderWidth: 1,
    gap: 6,
    padding: 18,
  },
  previewBannerLandscape: { width: "100%" },
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
  extractionCardCompact: { gap: 6, padding: 10 },
  heading: { gap: 4 },
  headingCompact: { gap: 2 },
  eyebrow: {
    color: "#8B3A2B",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  eyebrowCompact: { fontSize: 9, letterSpacing: 0.9 },
  title: { color: "#241B17", fontSize: 21, fontWeight: "800" },
  titleCompact: { fontSize: 18, lineHeight: 20 },
  profileGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  profileGridCompact: { gap: 8 },
  profilePicker: { gap: 8 },
  profilePickerCompact: {
    minWidth: 0,
    position: "relative",
    zIndex: 20,
  },
  compactSelectorColumn: { flex: 1.2, gap: 6, minWidth: 0, zIndex: 20 },
  quickControlRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 8,
  },
  compactAction: { alignSelf: "stretch", flex: 1, minWidth: 0 },
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
  profilePickerCopy: { flex: 1, gap: 2, minWidth: 0 },
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
  profilePickerMenuCompact: {
    boxShadow: "0 8px 24px rgba(61, 42, 32, 0.2)",
    flexDirection: "row",
    flexWrap: "wrap",
    left: 0,
    position: "absolute",
    top: 66,
    width: "170%",
    zIndex: 30,
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
  profilePickerOptionCompact: {
    borderRightColor: "#E2D3C5",
    borderRightWidth: 1,
    flexBasis: "50%",
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  profilePickerOptionFullRow: {
    borderRightWidth: 0,
    flexBasis: "100%",
  },
  profilePickerOptionSelected: { backgroundColor: "#F1DED3" },
  profilePickerOptionName: { color: "#332A25", fontSize: 15, fontWeight: "800" },
  profilePickerOptionNameCompact: { fontSize: 13 },
  profilePickerOptionNameSelected: { color: "#7D3024" },
  profilePickerOptionDetail: { color: "#76675D", fontSize: 11, fontWeight: "700" },
  profilePickerOptionDetailCompact: { fontSize: 9 },
  profilePickerCheck: { color: "#8B3A2B", fontSize: 18, fontWeight: "900" },
  profilePickerCheckCompact: { fontSize: 15 },
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
  profileButtonCompact: {
    flexBasis: "47%",
    gap: 2,
    minHeight: 48,
    padding: 7,
  },
  profileButtonSelected: { backgroundColor: "#8B3A2B", borderColor: "#8B3A2B" },
  profileName: { color: "#332A25", fontSize: 17, fontWeight: "800" },
  profileNameCompact: { fontSize: 14 },
  profileNameSelected: { color: "#FFFFFF" },
  profileDetail: { color: "#76675D", fontSize: 11, fontWeight: "700" },
  profileDetailSelected: { color: "#F3D9D2" },
  helpText: { color: "#695A50", fontSize: 14, lineHeight: 20 },
  helpTextCompact: { fontSize: 12, lineHeight: 16 },
  importReview: {
    backgroundColor: "#F5EEE5",
    borderCurve: "continuous",
    borderRadius: 16,
    gap: 10,
    padding: 12,
  },
  importReviewTitle: { color: "#332A25", fontSize: 16, fontWeight: "900" },
  importChange: {
    backgroundColor: "#FFFCF7",
    borderColor: "#D8C9BA",
    borderRadius: 14,
    borderWidth: 1,
    gap: 5,
    padding: 10,
  },
  importArrow: { color: "#8B3A2B", fontSize: 18, fontWeight: "900" },
  importValue: { gap: 2 },
  importValueLabel: {
    color: "#76675D",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  importValueName: { color: "#241B17", fontSize: 14, fontWeight: "800" },
  importValueTiming: { color: "#695A50", fontSize: 11 },
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
  nameInputCompact: { fontSize: 15, minHeight: 44, paddingVertical: 7 },
  stepperRow: {
    alignItems: "center",
    backgroundColor: "#F5EEE5",
    borderCurve: "continuous",
    borderRadius: 16,
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 12,
    justifyContent: "space-between",
    padding: 12,
  },
  stepperRowCompact: {
    alignItems: "stretch",
    flex: 1,
    flexDirection: "column",
    flexWrap: "nowrap",
    gap: 6,
    minWidth: 0,
    padding: 10,
  },
  stepperLabel: {
    color: "#332A25",
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "800",
    minWidth: 0,
  },
  stepperLabelCompact: { flexGrow: 0, flexShrink: 1, fontSize: 12 },
  stepperActions: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 9,
  },
  stepperActionsCompact: {
    backgroundColor: "#FFF9F3",
    borderColor: "#D8C9BA",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
    gap: 0,
    overflow: "hidden",
  },
  stepperValue: {
    color: "#241B17",
    fontSize: 18,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
    minWidth: 50,
    textAlign: "center",
  },
  stepperValueCompact: { flex: 1, fontSize: 14, minWidth: 0 },
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
  roundButtonCompact: {
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderRadius: 0,
    borderWidth: 0,
    flex: 1,
    height: 44,
    minWidth: 0,
    width: "auto",
  },
  roundButtonText: { color: "#8B3A2B", fontSize: 25, fontWeight: "700" },
  roundButtonTextCompact: { fontSize: 21 },
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
  compactBlockStatus: {
    alignSelf: "stretch",
    alignItems: "center",
    backgroundColor: "#F5E8C9",
    borderColor: "#D4B86F",
    borderCurve: "continuous",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    flexShrink: 1,
    gap: 3,
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  compactBlockLabel: {
    color: "#7A3A25",
    flexShrink: 1,
    fontSize: 11,
    fontWeight: "900",
  },
  compactBlockChevron: { color: "#7A3A25", fontSize: 14, fontWeight: "900" },
  blockedText: { color: "#9E2E24", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  actionButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#8B3A2B",
    borderColor: "#8B3A2B",
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 130,
    paddingHorizontal: 16,
  },
  actionButtonCompact: {
    borderCurve: "continuous",
    borderRadius: 16,
    minHeight: 44,
    minWidth: 0,
    paddingHorizontal: 8,
  },
  actionButtonGrow: { flexGrow: 1 },
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
