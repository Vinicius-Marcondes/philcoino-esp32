import type {
  CompensationState,
  ExtractionSelection,
  MachineState,
  MachineStateV2,
} from "@philcoino/protocol";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
import { CompensationIndicator } from "@/components/compensation-indicator";
import {
  ExtractionPreview,
  phaseLabel,
} from "@/components/extraction-preview";
import {
  ThermalWorkflowPreview,
  ThermalWorkflowStatus,
} from "@/components/thermal-workflow-preview";
import { useMachineDashboard } from "@/hooks/use-machine-dashboard";
import { useTemperatureHistory } from "@/hooks/use-temperature-history";
import {
  boilerTargetC,
  boilerTemperatureC,
  connectionCopy,
  faultDetail,
  faultLabel,
  formatSteamCountdown,
  formatTarget,
  formatTemperature,
  formatUptime,
  machineActivityLabel,
  modeLabel,
  steamCountdownContext,
} from "@/src/dashboard/dashboard-view-model";
import {
  idleMutationState,
  type DashboardMutationState,
} from "@/src/dashboard/dashboard-mutation-session";
import { isDebugDeviceModeEnabled } from "@/src/debug-device-mode";
import { debugMobileProfileRepository } from "@/src/debug/debug-mobile-profile-repository";
import {
  createExtractionPreviewState,
  type ExtractionPreviewState,
} from "@/src/debug/extraction-preview-model";
import {
  temperatureHistoryExporter,
  type TemperatureHistoryExporter,
} from "@/src/history/temperature-history-export";
import {
  downsampleTemperatureHistory,
  formatHistoryDurationMs,
  isTemperatureHistoryGap,
  isLatestHistoryPageOffset,
  LIVE_HISTORY_WINDOW_MS,
  temperatureHistoryWindows,
  type TemperatureHistorySample,
  type TemperatureHistoryWindow,
} from "@/src/history/temperature-history";
import {
  temperatureHistoryRepository,
  type TemperatureHistoryRepository,
} from "@/src/history/temperature-history-repository";
import { translate } from "@/src/localization/i18n";
import { createDebugDeviceApiClient } from "@/src/networking/debug-device-api-client";
import { createDeviceApiClient } from "@/src/networking/expo-device-api-client";
import { profileSetsEqual } from "@/src/profiles/profile-set";
import type { SelectedDevice } from "@/src/storage/selected-device-repository";
import { mobileProfileRepository } from "@/src/storage/secure-mobile-profile-repository";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type DashboardPage = "dashboard" | "profiles" | "machine";

interface DashboardScreenProps {
  deviceName: string;
  historyExporter?: TemperatureHistoryExporter;
  historyRepository?: TemperatureHistoryRepository;
  initialNote: string;
  onForget: () => void;
  selectedDevice: SelectedDevice;
}

export function DashboardScreen({
  deviceName,
  historyExporter = temperatureHistoryExporter,
  historyRepository = temperatureHistoryRepository,
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
    compensation,
    cooldown,
    cooldownStartMutation,
    cooldownStopMutation,
    dismissMutation,
    dismissOverTemperature,
    faultMutation,
    extraction,
    extractionStartMutation,
    extractionStopMutation,
    exportProfiles,
    freshness,
    heaterMutation,
    modeMutation,
    machineProfiles,
    mobileProfiles,
    profileMutation,
    profileStorageError,
    saveMobileProfiles,
    setHeaterEnabled,
    setMode,
    snapshot,
    snapshotRevision,
    startCooldown,
    startExtraction,
    stopCooldown,
    stopExtraction,
    temperatureMutation,
    updateTemperatureSettings,
  } = useMachineDashboard(
    client,
    debugDeviceMode
      ? debugMobileProfileRepository
      : mobileProfileRepository,
  );
  const { width } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const navigationVerticalPadding = Math.max(
    4,
    (safeAreaInsets.bottom + 4) / 2,
  );
  const refreshing = freshness === "refreshing" && snapshot !== null;
  const connectionContent = refreshing
    ? {
        detail: translate("dashboard.refreshingDetail"),
        label: translate("dashboard.refreshing"),
      }
    : connectionCopy(connection);
  const metricWidth = width >= 700 ? "48.5%" : "100%";
  const temperatureHistory = useTemperatureHistory(
    selectedDevice.deviceId,
    snapshot,
    extraction,
    snapshotRevision,
    freshness,
    historyRepository,
    historyExporter,
    client,
  );
  const clearTemperatureHistory = temperatureHistory.clear;
  const [dashboardPage, setDashboardPage] =
    useState<DashboardPage>("dashboard");
  const dashboardScrollView = useRef<ScrollView>(null);
  const pageScrollOffsets = useRef<Record<DashboardPage, number>>({
    dashboard: 0,
    machine: 0,
    profiles: 0,
  });
  const pendingScrollRestore = useRef<{
    offset: number;
    page: DashboardPage;
  } | null>(null);
  const [selectedExtraction, setSelectedExtraction] =
    useState<ExtractionSelection>({ kind: "manual" });
  const [localProfileMutation, setLocalProfileMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const localProfileSaveGeneration = useRef(0);
  const idlePreviewState = useMemo(createExtractionPreviewState, []);
  const extractionUiState: ExtractionPreviewState = useMemo(
    () => ({
      extraction: extraction ?? idlePreviewState.extraction,
      machineProfiles: machineProfiles ?? idlePreviewState.machineProfiles,
      mobileProfiles: mobileProfiles ?? idlePreviewState.mobileProfiles,
      notice: null,
      selected: selectedExtraction,
    }),
    [
      extraction,
      idlePreviewState,
      machineProfiles,
      mobileProfiles,
      selectedExtraction,
    ],
  );
  const thermalSnapshot: MachineStateV2 | null = useMemo(
    () =>
      snapshot !== null &&
      extraction !== null &&
      compensation !== null &&
      cooldown !== null
        ? {
            machine: snapshot,
            extraction,
            compensation,
            cooldown,
          }
        : null,
    [compensation, cooldown, extraction, snapshot],
  );
  const cooldownActive = cooldown !== null && cooldown.status !== "idle";
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
  const dismissExtractionStartMutation = useCallback(
    () => dismissMutation("extraction-start"),
    [dismissMutation],
  );
  const dismissExtractionStopMutation = useCallback(
    () => dismissMutation("extraction-stop"),
    [dismissMutation],
  );
  const dismissCooldownStartMutation = useCallback(
    () => dismissMutation("cooldown-start"),
    [dismissMutation],
  );
  const dismissCooldownStopMutation = useCallback(
    () => dismissMutation("cooldown-stop"),
    [dismissMutation],
  );
  const dismissProfileMutation = useCallback(
    () => dismissMutation("profiles"),
    [dismissMutation],
  );
  const dismissLocalProfileMutation = useCallback(
    () => setLocalProfileMutation(idleMutationState),
    [],
  );
  const mutationPending =
    freshness !== "live" ||
    cooldownStartMutation.status === "pending" ||
    cooldownStopMutation.status === "pending" ||
    extractionStartMutation.status === "pending" ||
    extractionStopMutation.status === "pending" ||
    faultMutation.status === "pending" ||
    heaterMutation.status === "pending" ||
    modeMutation.status === "pending" ||
    profileMutation.status === "pending" ||
    temperatureMutation.status === "pending";

  const applyExtractionUiState = useCallback(
    (update: SetStateAction<ExtractionPreviewState>) => {
      if (freshness !== "live") {
        return;
      }
      const next =
        typeof update === "function" ? update(extractionUiState) : update;
      if (JSON.stringify(next.selected) !== JSON.stringify(extractionUiState.selected)) {
        setSelectedExtraction(next.selected);
      }
      if (!profileSetsEqual(next.mobileProfiles, extractionUiState.mobileProfiles)) {
        const generation = ++localProfileSaveGeneration.current;
        setLocalProfileMutation({
          message: translate("mutation.profileSavePending"),
          status: "pending",
        });
        void saveMobileProfiles(next.mobileProfiles).then((saved) => {
          if (localProfileSaveGeneration.current !== generation) {
            return;
          }
          setLocalProfileMutation({
            message: saved
              ? translate("mutation.profileSavedLocally")
              : translate("extractionPreview.profileSaveError"),
            status: saved ? "acknowledged" : "rejected",
          });
        });
      }
      if (!profileSetsEqual(next.machineProfiles, extractionUiState.machineProfiles)) {
        localProfileSaveGeneration.current += 1;
        setLocalProfileMutation(idleMutationState);
        exportProfiles();
      }
      if (
        extractionUiState.extraction.status === "idle" &&
        next.extraction.status === "running"
      ) {
        startExtraction(next.selected);
      } else if (
        extractionUiState.extraction.status === "running" &&
        next.extraction.status === "idle"
      ) {
        stopExtraction();
      }
    },
    [
      exportProfiles,
      extractionUiState,
      freshness,
      saveMobileProfiles,
      startExtraction,
      stopExtraction,
    ],
  );

  const forgetMachine = useCallback(() => {
    const clearingHistory = clearTemperatureHistory();
    onForget();
    void clearingHistory.catch(() => undefined);
  }, [clearTemperatureHistory, onForget]);

  const openDashboardPage = useCallback(
    (page: DashboardPage) => {
      if (page === "profiles") {
        setSelectedExtraction((current) =>
          current.kind === "manual"
            ? { kind: "profile", profileId: "profile-1" }
            : current,
        );
      }
      if (page === dashboardPage) {
        return;
      }
      pendingScrollRestore.current = {
        offset: pageScrollOffsets.current[page],
        page,
      };
      setDashboardPage(page);
    },
    [dashboardPage],
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={styles.content}
        key={dashboardPage}
        onContentSizeChange={() => {
          const pending = pendingScrollRestore.current;
          if (pending === null || pending.page !== dashboardPage) {
            return;
          }
          dashboardScrollView.current?.scrollTo({
            animated: false,
            y: pending.offset,
          });
          pendingScrollRestore.current = null;
        }}
        onScroll={(event) => {
          if (pendingScrollRestore.current?.page === dashboardPage) {
            return;
          }
          pageScrollOffsets.current[dashboardPage] = Math.max(
            0,
            event.nativeEvent.contentOffset.y,
          );
        }}
        ref={dashboardScrollView}
        scrollEventThrottle={16}>
        <View style={styles.pageHeader}>
          <Text selectable style={styles.pageTitle}>{deviceName}</Text>
        </View>
        <View style={styles.intro}>
          <View style={styles.introHeading}>
            <Text selectable style={styles.eyebrow}>
              {translate(
                `dashboard.navigation.${dashboardPage}.eyebrow`,
              )}
            </Text>
            <View
              accessibilityLiveRegion="polite"
              style={styles.connectionPill}>
              <View
                style={[
                  styles.statusDot,
                  connection.status === "online" && freshness === "live"
                    ? styles.statusDotOnline
                    : styles.statusDotUnavailable,
                ]}
              />
              <Text selectable style={styles.connectionPillLabel}>
                {connectionContent.label}
              </Text>
              {connection.status === "connecting" || refreshing ? (
                <ActivityIndicator
                  accessibilityLabel={translate("dashboard.connecting")}
                  size="small"
                />
              ) : null}
            </View>
          </View>
          <Text selectable style={styles.lead}>
            {translate(
              `dashboard.navigation.${dashboardPage}.lead`,
            )}
          </Text>
        </View>

        {refreshing ? (
          <View accessibilityLiveRegion="polite" style={styles.refreshingCard}>
            <ActivityIndicator size="small" />
            <View style={styles.refreshingCopy}>
              <Text selectable style={styles.refreshingTitle}>
                {translate("dashboard.refreshing")}
              </Text>
              <Text selectable style={styles.refreshingDetail}>
                {translate("dashboard.refreshingDetail")}
              </Text>
            </View>
          </View>
        ) : null}

        {dashboardPage === "dashboard" ? (
          <>
            <MutationFeedback
              onDismiss={dismissFaultMutation}
              state={faultMutation}
              visibility="errors-only"
            />
            <MutationFeedback
              onDismiss={dismissExtractionStartMutation}
              state={extractionStartMutation}
              visibility="errors-only"
            />
            <MutationFeedback
              onDismiss={dismissExtractionStopMutation}
              state={extractionStopMutation}
              visibility="errors-only"
            />
            <MutationFeedback
              onDismiss={dismissCooldownStartMutation}
              state={cooldownStartMutation}
              visibility="errors-only"
            />
            <MutationFeedback
              onDismiss={dismissCooldownStopMutation}
              state={cooldownStopMutation}
              visibility="errors-only"
            />

            {connection.status === "online" && snapshot !== null ? (
              <>
                <MachineStatus
                  disabled={freshness !== "live"}
                  faultMutation={faultMutation}
                  onDismissOverTemperature={dismissOverTemperature}
                  snapshot={snapshot}
                />
                <View style={styles.metricGrid}>
                  <TemperatureCard
                    compensation={compensation}
                    mode={snapshot.activeMode}
                    targetC={boilerTargetC(snapshot)}
                    temperatureC={boilerTemperatureC(snapshot)}
                    width="100%"
                  />
                </View>
                <TemperatureCurve
                  error={temperatureHistory.error}
                  exporting={temperatureHistory.exporting}
                  history={temperatureHistory.samples}
                  loading={temperatureHistory.status === "loading"}
                  onExport={() => void temperatureHistory.exportAll()}
                  syncStatus={temperatureHistory.syncStatus}
                />
                {mobileProfiles !== null && machineProfiles !== null ? (
                  <ExtractionPreview
                    debugPreview={debugDeviceMode}
                    onStateChange={applyExtractionUiState}
                    state={extractionUiState}
                    view="quick"
                    workflowBlock={
                      cooldownActive
                        ? "cooldown"
                        : snapshot.activeMode === "steam"
                          ? "steam"
                          : null
                    }
                    workflowMutationPending={
                      freshness !== "live" ||
                      cooldownStartMutation.status === "pending" ||
                      cooldownStopMutation.status === "pending"
                    }
                  />
                ) : (
                  <ProfileLoadingCard error={profileStorageError} />
                )}
                {debugDeviceMode ? (
                  <ThermalWorkflowPreview
                    onOpenMachine={() => openDashboardPage("machine")}
                  />
                ) : thermalSnapshot !== null ? (
                  <ThermalWorkflowStatus
                    mutationPending={mutationPending}
                    onOpenMachine={() => openDashboardPage("machine")}
                    onStartCooldown={startCooldown}
                    onStopCooldown={stopCooldown}
                    snapshot={thermalSnapshot}
                  />
                ) : null}
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
            {connection.status !== "online" || snapshot === null ? (
              <TemperatureCurve
                error={temperatureHistory.error}
                exporting={temperatureHistory.exporting}
                history={temperatureHistory.samples}
                loading={temperatureHistory.status === "loading"}
                onExport={() => void temperatureHistory.exportAll()}
                syncStatus={temperatureHistory.syncStatus}
              />
            ) : null}
          </>
        ) : null}

        {dashboardPage === "profiles" ? (
          <>
            {profileStorageError !== null ? (
              <ProfileLoadingCard error={profileStorageError} />
            ) : null}
            <MutationFeedback
              onDismiss={
                profileMutation.status === "idle"
                  ? dismissLocalProfileMutation
                  : dismissProfileMutation
              }
              state={
                profileMutation.status === "idle"
                  ? localProfileMutation
                  : profileMutation
              }
            />
            {mobileProfiles !== null && machineProfiles !== null ? (
              <ExtractionPreview
                debugPreview={debugDeviceMode}
                onStateChange={applyExtractionUiState}
                state={extractionUiState}
                view="profiles"
                workflowBlock={cooldownActive ? "cooldown" : null}
                workflowMutationPending={
                  freshness !== "live" ||
                  cooldownStartMutation.status === "pending" ||
                  cooldownStopMutation.status === "pending"
                }
              />
            ) : (
              <ProfileLoadingCard error={profileStorageError} />
            )}
          </>
        ) : null}

        {dashboardPage === "machine" ? (
          <>
            <MutationFeedback
              onDismiss={dismissModeMutation}
              state={modeMutation}
              visibility="errors-only"
            />
            <MutationFeedback
              onDismiss={dismissTemperatureMutation}
              state={temperatureMutation}
            />
            <MutationFeedback
              onDismiss={dismissHeaterMutation}
              state={heaterMutation}
            />

            {connection.status === "online" && snapshot !== null ? (
              <>
                <MachineControls
                  disabled={freshness !== "live"}
                  faultMutation={faultMutation}
                  heaterMutation={heaterMutation}
                  modeMutation={modeMutation}
                  onSetMode={setMode}
                  onUpdateTemperatureSettings={updateTemperatureSettings}
                  snapshot={snapshot}
                  steamWorkflowBlocked={
                    extraction?.status === "running" ||
                    extractionStartMutation.status === "pending" ||
                    cooldownActive ||
                    cooldownStartMutation.status === "pending"
                  }
                  temperatureMutation={temperatureMutation}
                />
                <HeaterToggleBar
                  disabled={mutationPending}
                  mutation={heaterMutation}
                  onSetHeaterEnabled={setHeaterEnabled}
                  snapshot={snapshot}
                />
                <View style={styles.metricGrid}>
                  <ContextMetric
                    label={translate("dashboard.machineUptime")}
                    value={formatUptime(snapshot.uptimeMs)}
                    detail={translate("dashboard.uptimeDetail")}
                    width={metricWidth}
                  />
                  <ContextMetric
                    label={translate("dashboard.steamTimer")}
                    value={formatSteamCountdown(
                      snapshot.steamTimeoutRemainingMs,
                    )}
                    detail={steamCountdownContext(snapshot)}
                    width={metricWidth}
                  />
                </View>
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

            <View style={styles.contextCard}>
              <Text selectable style={styles.contextTitle}>
                {translate("dashboard.savedMachine")}
              </Text>
              <Text selectable style={styles.contextText}>{initialNote}</Text>
              <Text selectable style={styles.deviceId}>
                {selectedDevice.deviceId}
              </Text>
              <Text selectable style={styles.address}>
                {selectedDevice.lastSuccessfulAddress}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={forgetMachine}
                style={({ pressed }) => [
                  styles.forgetButton,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.forgetButtonText}>
                  {translate("dashboard.forgetMachine")}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.bottomNavigation,
          {
            paddingBottom: navigationVerticalPadding,
            paddingTop: navigationVerticalPadding,
          },
        ]}>
          {extraction?.status === "running" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => openDashboardPage("dashboard")}
              style={({ pressed }) => [
                styles.activeExtractionBar,
                pressed && styles.pressed,
              ]}>
              <Text selectable style={styles.activeExtractionTitle}>
                {translate("dashboard.navigation.extractionRunning", {
                  phase: phaseLabel(extraction.phase),
                })}
              </Text>
              <Text selectable style={styles.activeExtractionAction}>
                {translate("dashboard.navigation.openControls")}
              </Text>
            </Pressable>
          ) : null}
          <View accessibilityRole="tablist" style={styles.bottomNavigationRow}>
            <DashboardTab
              active={dashboardPage === "dashboard"}
              label={translate("dashboard.navigation.dashboard.tab")}
              onPress={() => openDashboardPage("dashboard")}
            />
            <DashboardTab
              active={dashboardPage === "profiles"}
              label={translate("dashboard.navigation.profiles.tab")}
              onPress={() => openDashboardPage("profiles")}
            />
            <DashboardTab
              active={dashboardPage === "machine"}
              label={translate("dashboard.navigation.machine.tab")}
              onPress={() => openDashboardPage("machine")}
            />
          </View>
        </View>
    </View>
  );
}

function ProfileLoadingCard({ error }: { error: string | null }) {
  return (
    <View
      accessibilityLiveRegion={error === null ? "polite" : "assertive"}
      style={styles.unavailableCard}>
      <Text selectable style={styles.unavailableTitle}>
        {error === null
          ? translate("extractionPreview.loadingProfiles")
          : translate("extractionPreview.profileLoadFailed")}
      </Text>
      <Text selectable style={styles.unavailableText}>
        {error ?? translate("extractionPreview.loadingProfilesDetail")}
      </Text>
    </View>
  );
}

function DashboardTab({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bottomNavigationTab,
        active && styles.bottomNavigationTabActive,
        pressed && styles.pressed,
      ]}>
      <Text
        style={[
          styles.bottomNavigationLabel,
          active && styles.bottomNavigationLabelActive,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

function TemperatureCurve({
  error,
  exporting,
  history,
  loading,
  onExport,
  syncStatus,
}: {
  error: "export" | "storage" | null;
  exporting: boolean;
  history: TemperatureHistorySample[];
  loading: boolean;
  onExport: () => void;
  syncStatus: "idle" | "restoring" | "warning";
}) {
  const [view, setView] = useState<"live" | "today">("live");
  const displayHistory = useMemo(
    () => (view === "live" ? history : downsampleTemperatureHistory(history)),
    [history, view],
  );
  const values = displayHistory.flatMap((sample) => [
    sample.boilerTemperatureC,
    sample.activeTargetC,
  ]);
  const minimumValue =
    values.length === 0 ? 0 : Math.floor(Math.min(...values) - 1);
  const maximumValue =
    values.length === 0 ? 1 : Math.ceil(Math.max(...values) + 1);
  const first = displayHistory[0];
  const last = displayHistory.at(-1);
  const duration =
    first === undefined || last === undefined
      ? translate("viewModel.collecting")
      : formatHistoryDurationMs(
          view === "live"
            ? LIVE_HISTORY_WINDOW_MS
            : last.recordedAtMs - first.recordedAtMs,
        );
  const mode = history.at(-1)?.activeMode;
  const canScrollHistory =
    view === "live" &&
    first !== undefined &&
    last !== undefined &&
    last.recordedAtMs - first.recordedAtMs > LIVE_HISTORY_WINDOW_MS;

  return (
    <View style={styles.curveCard}>
      <View style={styles.curveHeading}>
        <View style={styles.curveTitleGroup}>
          <Text selectable style={styles.cardLabel}>{translate("dashboard.temperatureCurve")}</Text>
          <Text selectable style={styles.curveTitle}>
            {mode === undefined
              ? translate("dashboard.historyTitle")
              : translate("dashboard.controlTrend", { mode: modeLabel(mode) })}
          </Text>
        </View>
        <View style={styles.curveWindowPill}>
          <Text selectable style={styles.curveWindowText}>
            {duration}
          </Text>
        </View>
      </View>

      <View style={styles.curveActions}>
        <View accessibilityRole="tablist" style={styles.curveTabs}>
          <CurveTab
            active={view === "live"}
            label={translate("dashboard.historyLive")}
            onPress={() => setView("live")}
          />
          <CurveTab
            active={view === "today"}
            label={translate("dashboard.historyToday")}
            onPress={() => setView("today")}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: exporting || history.length === 0 }}
          disabled={exporting || history.length === 0}
          onPress={onExport}
          style={({ pressed }) => [
            styles.exportButton,
            (exporting || history.length === 0) && styles.disabled,
            pressed && styles.pressed,
          ]}>
          <Text style={styles.exportButtonText}>
            {exporting
              ? translate("dashboard.historyExporting")
              : translate("dashboard.historyExport")}
          </Text>
        </Pressable>
      </View>

      <View style={styles.curveLegend}>
        <LegendItem color="#8B3A2B" label={translate("dashboard.boiler")} />
        <LegendItem color="#D39A42" label={translate("dashboard.target")} />
        <LegendItem color="#F29A52" label={translate("dashboard.heater")} />
        <LegendItem color="#3D7B80" label={translate("dashboard.pump")} />
      </View>

      {canScrollHistory ? (
        <Text selectable style={styles.historyScrollHint}>
          {translate("dashboard.historyScrollHint")}
        </Text>
      ) : null}

      {syncStatus !== "idle" ? (
        <Text
          accessibilityLiveRegion="polite"
          selectable
          style={
            syncStatus === "warning"
              ? styles.historyError
              : styles.historyScrollHint
          }>
          {translate(
            syncStatus === "warning"
              ? "dashboard.historySyncWarning"
              : "dashboard.historySyncRestoring",
          )}
        </Text>
      ) : null}

      {error !== null ? (
        <Text accessibilityLiveRegion="polite" selectable style={styles.historyError}>
          {translate(
            error === "storage"
              ? "dashboard.historyStorageError"
              : "dashboard.historyExportError",
          )}
        </Text>
      ) : null}

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
        {displayHistory.length > 0 ? (
          view === "live" ? (
            <PaginatedLineGraph
              maximumValue={maximumValue}
              minimumValue={minimumValue}
              samples={displayHistory}
            />
          ) : (
            <LineGraph
              maximumValue={maximumValue}
              minimumValue={minimumValue}
              samples={displayHistory}
            />
          )
        ) : (
          <View style={styles.historyEmpty}>
            {loading ? <ActivityIndicator size="small" /> : null}
            <Text selectable style={styles.historyEmptyText}>
              {translate(
                loading
                  ? "dashboard.historyLoading"
                  : "dashboard.historyEmpty",
              )}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function CurveTab({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.curveTab,
        active && styles.curveTabActive,
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.curveTabText, active && styles.curveTabTextActive]}>
        {label}
      </Text>
    </Pressable>
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

function PaginatedLineGraph({
  maximumValue,
  minimumValue,
  samples,
}: {
  maximumValue: number;
  minimumValue: number;
  samples: TemperatureHistorySample[];
}) {
  const list = useRef<FlatList<TemperatureHistoryWindow>>(null);
  const followsLatest = useRef(true);
  const hasPositionedInitialWindow = useRef(false);
  const viewedWindowStartMs = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const windows = useMemo(() => temperatureHistoryWindows(samples), [samples]);

  return (
    <View
      accessibilityHint={translate("dashboard.historyScrollHint")}
      onLayout={(event) => {
        setViewportWidth(event.nativeEvent.layout.width);
      }}
      style={styles.curveCanvas}>
      {viewportWidth > 0 ? (
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
          keyExtractor={(item) => `history-window-${item.startMs}`}
          maxToRenderPerBatch={3}
          onContentSizeChange={() => {
            if (
              !hasPositionedInitialWindow.current ||
              followsLatest.current
            ) {
              list.current?.scrollToEnd({ animated: false });
              hasPositionedInitialWindow.current = true;
              viewedWindowStartMs.current = windows.at(-1)?.startMs ?? null;
              return;
            }
            const viewedIndex = windows.findIndex(
              (window) => window.startMs === viewedWindowStartMs.current,
            );
            if (viewedIndex >= 0) {
              list.current?.scrollToOffset({
                animated: false,
                offset: viewedIndex * viewportWidth,
              });
            }
          }}
          onScroll={(event) => {
            if (!hasPositionedInitialWindow.current) {
              return;
            }
            const { contentOffset, contentSize, layoutMeasurement } =
              event.nativeEvent;
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
            viewedWindowStartMs.current =
              windows[viewedIndex]?.startMs ?? null;
          }}
          pagingEnabled
          ref={list}
          renderItem={({ item }) => {
            const windowSamples = samples.filter(
              (sample) =>
                sample.recordedAtMs >= item.startMs &&
                sample.recordedAtMs < item.endMs,
            );
            return (
              <View style={{ height: "100%", width: viewportWidth }}>
                <LineGraph
                  endMs={item.endMs}
                  maximumValue={maximumValue}
                  minimumValue={minimumValue}
                  paginated
                  samples={windowSamples}
                  startMs={item.startMs}
                />
              </View>
            );
          }}
          scrollEnabled={windows.length > 1}
          scrollEventThrottle={32}
          showsHorizontalScrollIndicator={false}
          style={styles.historyPager}
          windowSize={3}
        />
      ) : null}
    </View>
  );
}

function LineGraph({
  endMs,
  maximumValue,
  minimumValue,
  paginated = false,
  samples,
  startMs,
}: {
  endMs?: number;
  maximumValue: number;
  minimumValue: number;
  paginated?: boolean;
  samples: TemperatureHistorySample[];
  startMs?: number;
}) {
  const [plotSize, setPlotSize] = useState({ height: 0, width: 0 });
  const linePlotSize = {
    height: Math.max(0, plotSize.height - 30),
    width: plotSize.width,
  };
  const readyToDraw = linePlotSize.width > 0 && linePlotSize.height > 0;
  const graphStartMs = startMs ?? samples[0]?.recordedAtMs ?? 0;
  const graphEndMs = endMs ?? samples.at(-1)?.recordedAtMs ?? graphStartMs;
  const points = readyToDraw
    ? samples.map((sample) =>
        samplePoint(
          sample.boilerTemperatureC,
          sample.recordedAtMs,
          graphStartMs,
          graphEndMs,
          minimumValue,
          maximumValue,
          linePlotSize,
        ),
      )
    : [];
  const targetPoints = readyToDraw
    ? samples.map((sample) =>
        samplePoint(
          sample.activeTargetC,
          sample.recordedAtMs,
          graphStartMs,
          graphEndMs,
          minimumValue,
          maximumValue,
          linePlotSize,
        ),
      )
    : [];
  const heaterBands = readyToDraw
    ? chartActivityBands(samples, points, (sample) => sample.heaterActive)
    : [];
  const pumpBands = readyToDraw
    ? chartActivityBands(samples, points, (sample) => sample.pumpActive === true)
    : [];
  return (
    <View
      accessibilityLabel={translate("dashboard.curveAccessibility", { count: samples.length })}
      onLayout={(event) => {
        const { height, width } = event.nativeEvent.layout;
        setPlotSize({ height, width });
      }}
      style={paginated ? styles.curvePageCanvas : styles.curveCanvas}>
      {heaterBands.map((band) => (
        <View
          key={`heater-${band.key}`}
          style={[
            styles.heaterPulseBand,
            { left: band.left, width: band.width },
          ]}
        />
      ))}
      {pumpBands.map((band) => (
        <View
          key={`pump-${band.key}`}
          style={[
            styles.pumpActivityBand,
            { left: band.left, width: band.width },
          ]}
        />
      ))}
      {targetPoints.slice(1).map((point, index) =>
        isTemperatureHistoryGap(samples[index], samples[index + 1]) ? null : (
          <LineSegment
            color="#D39A42"
            from={targetPoints[index]}
            key={`target-${samples[index + 1].recordedAtMs}`}
            thickness={2}
            to={point}
          />
        ),
      )}
      {points.slice(1).map((point, index) =>
        isTemperatureHistoryGap(samples[index], samples[index + 1]) ? null : (
          <LineSegment
            color="#8B3A2B"
            from={points[index]}
            key={`boiler-${samples[index + 1].recordedAtMs}`}
            thickness={4}
            to={point}
          />
        ),
      )}
    </View>
  );
}

function chartActivityBands(
  samples: TemperatureHistorySample[],
  points: ChartPoint[],
  isActive: (sample: TemperatureHistorySample) => boolean,
): { key: number; left: number; width: number }[] {
  const bands: { key: number; left: number; width: number }[] = [];
  let startIndex: number | null = null;

  for (let index = 0; index < samples.length; index += 1) {
    if (isActive(samples[index]) && startIndex === null) {
      startIndex = index;
    }
    if (startIndex === null) {
      continue;
    }

    const next = samples[index + 1];
    const continuous =
      next !== undefined &&
      isActive(next) &&
      !isTemperatureHistoryGap(samples[index], next);
    if (continuous) {
      continue;
    }

    const canExtendToNextSample =
      next !== undefined && !isTemperatureHistoryGap(samples[index], next);
    const right = canExtendToNextSample
      ? points[index + 1].x
      : points[index].x + 2;
    bands.push({
      key: samples[startIndex].recordedAtMs,
      left: points[startIndex].x,
      width: Math.max(2, right - points[startIndex].x),
    });
    startIndex = null;
  }

  return bands;
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
  recordedAtMs: number,
  startMs: number,
  endMs: number,
  minimumValue: number,
  maximumValue: number,
  plotSize: { height: number; width: number },
): ChartPoint {
  const x =
    endMs <= startMs
      ? plotSize.width / 2
      : ((recordedAtMs - startMs) / (endMs - startMs)) * plotSize.width;
  const topPercent = curvePointTop(value, minimumValue, maximumValue);
  return { x, y: (topPercent / 100) * plotSize.height };
}

function curvePointTop(value: number, minimumValue: number, maximumValue: number) {
  const range = Math.max(1, maximumValue - minimumValue);
  return Math.max(0, Math.min(100, ((maximumValue - value) / range) * 100));
}

function MachineStatus({
  disabled,
  faultMutation,
  onDismissOverTemperature,
  snapshot,
}: {
  disabled: boolean;
  faultMutation: DashboardMutationState;
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
          <Text selectable style={styles.faultMessage}>
            {faultDetail(snapshot.fault.code)}
          </Text>
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
                  disabled:
                    disabled || !canDismissOverTemperature || dismissPending,
                }}
                disabled={
                  disabled || !canDismissOverTemperature || dismissPending
                }
                onPress={confirmDismissOverTemperature}
                style={({ pressed }) => [
                  styles.faultRecoveryButton,
                  (disabled || !canDismissOverTemperature || dismissPending) &&
                    styles.disabled,
                  pressed &&
                    !disabled &&
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
  compensation,
  mode,
  targetC,
  temperatureC,
  width,
}: {
  compensation: CompensationState | null;
  mode: MachineState["activeMode"];
  targetC: number;
  temperatureC: number;
  width: "100%" | "48.5%";
}) {
  return (
    <View style={[styles.temperatureCard, { width }, styles.activeCard]}>
      <View style={styles.temperatureHeading}>
        <Text selectable style={styles.temperatureLabel}>{translate("dashboard.boiler")}</Text>
        <View style={styles.temperaturePills}>
          <Text selectable style={styles.activePill}>
            {modeLabel(mode).toUpperCase()}
          </Text>
          {compensation === null ? null : (
            <CompensationIndicator compensation={compensation} />
          )}
        </View>
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
    paddingBottom: 24,
    paddingTop: 72,
  },
  bottomNavigation: {
    backgroundColor: "#FFFCF7",
    borderColor: "#D8C9BA",
    borderTopWidth: 1,
    gap: 8,
    paddingHorizontal: 12,
  },
  bottomNavigationRow: { flexDirection: "row", gap: 8 },
  bottomNavigationTab: {
    alignItems: "center",
    borderCurve: "continuous",
    borderRadius: 14,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 8,
  },
  bottomNavigationTabActive: { backgroundColor: "#8B3A2B" },
  bottomNavigationLabel: {
    color: "#695A50",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  bottomNavigationLabelActive: { color: "#FFFFFF" },
  activeExtractionBar: {
    alignItems: "center",
    backgroundColor: "#2F2722",
    borderCurve: "continuous",
    borderRadius: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  activeExtractionTitle: {
    color: "#FFFFFF",
    flexGrow: 1,
    fontSize: 13,
    fontWeight: "800",
  },
  activeExtractionAction: {
    color: "#F2B66D",
    fontSize: 12,
    fontWeight: "900",
  },
  pageHeader: { alignItems: "center", minHeight: 34 },
  pageTitle: { color: "#241B17", fontSize: 22, fontWeight: "800" },
  intro: { gap: 7, paddingHorizontal: 2, paddingTop: 8 },
  introHeading: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  eyebrow: { color: "#8B3A2B", fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  lead: { color: "#332A25", fontSize: 17, lineHeight: 24 },
  connectionPill: {
    alignItems: "center",
    backgroundColor: "#EAE2D7",
    borderCurve: "continuous",
    borderRadius: 999,
    flexDirection: "row",
    gap: 7,
    minHeight: 30,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  statusDot: { borderRadius: 999, height: 9, width: 9 },
  statusDotOnline: { backgroundColor: "#2D7547" },
  statusDotUnavailable: { backgroundColor: "#A54B36" },
  connectionPillLabel: { color: "#4A3E37", fontSize: 12, fontWeight: "800" },
  refreshingCard: {
    alignItems: "center",
    backgroundColor: "#F5E8C9",
    borderColor: "#D4B86F",
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    padding: 14,
  },
  refreshingCopy: { flex: 1, gap: 3 },
  refreshingTitle: { color: "#604A15", fontSize: 15, fontWeight: "800" },
  refreshingDetail: { color: "#6F5B29", fontSize: 13, lineHeight: 18 },
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
  curveActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  curveTabs: {
    backgroundColor: "#EFE6DA",
    borderRadius: 12,
    flexDirection: "row",
    gap: 3,
    padding: 3,
  },
  curveTab: {
    borderCurve: "continuous",
    borderRadius: 9,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: 13,
  },
  curveTabActive: { backgroundColor: "#8B3A2B" },
  curveTabText: { color: "#695A50", fontSize: 13, fontWeight: "800" },
  curveTabTextActive: { color: "#FFFFFF" },
  exportButton: {
    alignItems: "center",
    borderColor: "#8B3A2B",
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 14,
  },
  exportButtonText: { color: "#7A3025", fontSize: 13, fontWeight: "800" },
  historyError: {
    color: "#8C2F24",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  historyScrollHint: {
    color: "#6B5B51",
    fontSize: 12,
    fontWeight: "700",
  },
  historyPager: { flex: 1 },
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
    bottom: 42,
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
    bottom: 10,
    left: 42,
    position: "absolute",
    right: 10,
    top: 10,
  },
  curvePageCanvas: {
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  historyEmpty: {
    alignItems: "center",
    bottom: 0,
    gap: 8,
    justifyContent: "center",
    left: 40,
    position: "absolute",
    right: 0,
    top: 0,
  },
  historyEmptyText: {
    color: "#6B5B51",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  lineSegment: {
    borderRadius: 999,
    position: "absolute",
  },
  heaterPulseBand: {
    backgroundColor: "#F29A52",
    borderRadius: 2,
    bottom: 14,
    height: 8,
    position: "absolute",
  },
  pumpActivityBand: {
    backgroundColor: "#3D7B80",
    borderRadius: 2,
    bottom: 0,
    height: 10,
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
  temperatureHeading: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" },
  temperatureLabel: { color: "#4A3E37", fontSize: 17, fontWeight: "800" },
  temperaturePills: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" },
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
