import type {
  CompensationState,
  ExtractionSelection,
  MachineState,
  ProfileSlotId,
  WeightControl,
} from "@philcoino/protocol";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import {
  MachineControls,
  MutationFeedback,
} from "@/components/machine-controls";
import { CompensationIndicator } from "@/components/compensation-indicator";
import { WeightedTraceChart } from "@/components/extraction-telemetry-chart";
import { TemperatureHistoryChart } from "@/components/temperature-history-chart";
import {
  ExtractionPreview,
  phaseLabel,
} from "@/components/extraction-preview";
import {
  ThermalWorkflowPreview,
  ThermalWorkflowStatus,
} from "@/components/thermal-workflow-preview";
import { useMachineDashboard } from "@/hooks/use-machine-dashboard";
import { useDisplayPreferences } from "@/hooks/use-display-preferences";
import { useLandscapeDirection } from "@/hooks/use-landscape-direction";
import { useTemperatureHistory } from "@/hooks/use-temperature-history";
import { useScale } from "@/hooks/use-scale";
import { PairedKeepAwake } from "@/components/paired-keep-awake";
import {
  ExtractionConsoleEntry,
  ExtractionConsoleScreen,
} from "@/components/extraction-console-screen";
import { TemperatureCalibrationScreen } from "@/components/temperature-calibration-screen";
import { SteamControlSettingsScreen } from "@/components/steam-control-settings-screen";
import { WeightControlEditor } from "@/components/weight-mode-card";
import { formatWeightReadout } from "@/src/telemetry/telemetry-readouts";
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
import type { ThermalWorkflowSnapshot } from "@/src/debug/thermal-workflow-preview-model";
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
  temperatureHistoryRepository,
  type TemperatureHistoryRepository,
} from "@/src/history/temperature-history-repository";
import { translate } from "@/src/localization/i18n";
import { mobileLayoutMode } from "@/src/layout/responsive-layout";
import {
  dashboardPageAfterVerticalSwipe,
  dashboardPageTransitionDirection,
  shouldNavigateDashboardPageSwipe,
  type DashboardPage,
  type DashboardPageTransitionDirection,
} from "@/src/layout/dashboard-page-navigation";
import { navigationRailLeadingInset } from "@/src/layout/navigation-rail-inset";
import { createDebugDeviceApiClient } from "@/src/networking/debug-device-api-client";
import { createNativeDeviceApiClient } from "@/src/networking/native-device-api-client";
import {
  profileSelection,
  profileSetsEqual,
} from "@/src/profiles/profile-set";
import type { SelectedDevice } from "@/src/storage/selected-device-repository";
import { mobileProfileRepository } from "@/src/storage/secure-mobile-profile-repository";
import {
  displayPreferencesRepository as defaultDisplayPreferencesRepository,
} from "@/src/storage/local-display-preferences-repository";
import type { DisplayPreferencesRepository } from "@/src/storage/display-preferences-repository";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  FadeInDown,
  FadeInUp,
  FadeOut,
} from "react-native-reanimated";

interface DashboardScreenProps {
  deviceName: string;
  displayPreferencesRepository?: DisplayPreferencesRepository;
  historyExporter?: TemperatureHistoryExporter;
  historyRepository?: TemperatureHistoryRepository;
  initialNote: string;
  onForget: () => void;
  selectedDevice: SelectedDevice;
}

export function DashboardScreen({
  deviceName,
  displayPreferencesRepository = defaultDisplayPreferencesRepository,
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
        : createNativeDeviceApiClient({
            origin: selectedDevice.httpsOrigin,
            certificateSpkiSha256:
              selectedDevice.certificateSpkiSha256,
            accessToken: selectedDevice.accessToken,
          }),
    [
      debugDeviceMode,
      selectedDevice.httpsOrigin,
      selectedDevice.certificateSpkiSha256,
      selectedDevice.accessToken,
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
    freshness,
    heaterMutation,
    modeMutation,
    mobileProfiles,
    profileStorageError,
    profileWritePending,
    saveMobileProfiles,
    scaleSnapshot,
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
  const windowSize = useWindowDimensions();
  const { width } = windowSize;
  const landscape = mobileLayoutMode(windowSize) === "landscape";
  const safeAreaInsets = useSafeAreaInsets();
  const landscapeDirection = useLandscapeDirection();
  const navigationRailInset = navigationRailLeadingInset(
    landscapeDirection,
    safeAreaInsets.left,
  );
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
  const metricWidth = landscape ? "100%" : width >= 700 ? "48.5%" : "100%";
  const displayPreferences = useDisplayPreferences(
    displayPreferencesRepository,
  );
  const temperatureHistory = useTemperatureHistory(
    selectedDevice.deviceId,
    snapshot,
    extraction,
    snapshotRevision,
    freshness,
    historyRepository,
    historyExporter,
  );
  const [dashboardPage, setDashboardPage] =
    useState<DashboardPage>("dashboard");
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [temperatureCalibrationOpen, setTemperatureCalibrationOpen] =
    useState(false);
  const [steamControlSettingsOpen, setSteamControlSettingsOpen] =
    useState(false);
  const scale = useScale({
    client,
    deviceId: selectedDevice.deviceId,
    extraction,
    stateScale: scaleSnapshot,
    streamClient: "streamExtractionTelemetry" in client ? client : null,
  });
  const traceCutoffDecigrams =
    scale.scale?.activeExtraction?.cutoffWeightDecigrams ??
    scale.scale?.terminalExtraction?.cutoffWeightDecigrams ??
    null;
  const clearTemperatureHistory = temperatureHistory.clear;
  const dashboardScrollView = useRef<ScrollView>(null);
  const dashboardContentHeight = useRef(0);
  const dashboardViewportHeight = useRef(0);
  const dashboardTransitionDirection =
    useRef<DashboardPageTransitionDirection>("forward");
  const pageScrollOffsets = useRef<Record<DashboardPage, number>>({
    dashboard: 0,
    machine: 0,
    profiles: 0,
    scale: 0,
    shots: 0,
  });
  const pendingScrollRestore = useRef<{
    offset: number;
    page: DashboardPage;
  } | null>(null);
  const [selectedExtraction, setSelectedExtraction] =
    useState<ExtractionSelection>({ kind: "manual" });
  const [brewControlMode, setBrewControlMode] =
    useState<"timed" | "weight">("timed");
  const previousExtractionStatus = useRef(extraction?.status ?? "idle");
  const selectedProfileId =
    selectedExtraction.kind === "profile"
      ? selectedExtraction.profileId
      : "profile-1";
  const [shotWeightControl, setShotWeightControl] = useState<WeightControl>({
    targetWeightDecigrams: 350,
    compensationDecigrams: 10,
  });
  useEffect(() => {
    setShotWeightControl({
      ...(scale.defaults?.[selectedProfileId] ?? {
        targetWeightDecigrams: 350,
        compensationDecigrams: 10,
      }),
    });
    setBrewControlMode("timed");
  }, [scale.defaults, selectedProfileId]);
  useEffect(() => {
    const previous = previousExtractionStatus.current;
    const current = extraction?.status ?? "idle";
    if (previous === "running" && current === "idle") {
      setBrewControlMode("timed");
    }
    previousExtractionStatus.current = current;
  }, [extraction?.status]);
  const [localProfileMutation, setLocalProfileMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const localProfileSaveGeneration = useRef(0);
  const idlePreviewState = useMemo(createExtractionPreviewState, []);
  const extractionUiState: ExtractionPreviewState = useMemo(
    () => ({
      extraction: extraction ?? idlePreviewState.extraction,
      mobileProfiles: mobileProfiles ?? idlePreviewState.mobileProfiles,
      notice: null,
      selected: selectedExtraction,
    }),
    [
      extraction,
      idlePreviewState,
      mobileProfiles,
      selectedExtraction,
    ],
  );
  const thermalSnapshot: ThermalWorkflowSnapshot | null = useMemo(
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
      if (
        extractionUiState.extraction.status === "idle" &&
        next.extraction.status === "running"
      ) {
        startExtraction(
          next.selected,
          brewControlMode === "weight" && next.selected.kind === "profile"
            ? shotWeightControl
            : undefined,
        );
      } else if (
        extractionUiState.extraction.status === "running" &&
        next.extraction.status === "idle"
      ) {
        stopExtraction();
      }
    },
    [
      extractionUiState,
      freshness,
      brewControlMode,
      saveMobileProfiles,
      shotWeightControl,
      startExtraction,
      stopExtraction,
    ],
  );

  const forgetMachine = useCallback(() => {
    void Promise.allSettled([
      clearTemperatureHistory(),
      scale.clearHistory(),
    ]).finally(onForget);
  }, [clearTemperatureHistory, onForget, scale]);

  const openDashboardPage = useCallback(
    (page: DashboardPage) => {
      if (page === "profiles") {
        setSelectedExtraction((current) =>
          current.kind === "manual" && mobileProfiles !== null
            ? profileSelection(mobileProfiles, "profile-1")
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
      dashboardTransitionDirection.current = dashboardPageTransitionDirection(
        dashboardPage,
        page,
      );
      setDashboardPage(page);
    },
    [dashboardPage, mobileProfiles],
  );
  const navigationSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gesture) => {
          const page = dashboardPageAfterVerticalSwipe(
            dashboardPage,
            gesture.dy,
          );
          return (
            page !== dashboardPage &&
            shouldNavigateDashboardPageSwipe({
              contentHeight: dashboardContentHeight.current,
              deltaX: gesture.dx,
              deltaY: gesture.dy,
              offsetY: pageScrollOffsets.current[dashboardPage],
              viewportHeight: dashboardViewportHeight.current,
            })
          );
        },
        onPanResponderRelease: (_, gesture) => {
          const page = dashboardPageAfterVerticalSwipe(
            dashboardPage,
            gesture.dy,
          );
          if (page !== dashboardPage) {
            openDashboardPage(page);
          }
        },
      }),
    [dashboardPage, openDashboardPage],
  );

  return (
    <View
      {...(landscape ? navigationSwipeResponder.panHandlers : {})}
      style={[styles.screen, landscape && styles.screenLandscape]}>
      <PairedKeepAwake
        enabled={displayPreferences.preferences.keepScreenAwake}
      />
      <ExtractionConsoleScreen
        brewControlMode={brewControlMode}
        cutoffDecigrams={traceCutoffDecigrams}
        deviceName={deviceName}
        extraction={extraction}
        landscape={landscape}
        live={freshness === "live"}
        onBrewControlModeChange={setBrewControlMode}
        onClose={() => setConsoleOpen(false)}
        onStateChange={applyExtractionUiState}
        onWeightControlChange={setShotWeightControl}
        scale={scale.scale}
        shotWeightControl={shotWeightControl}
        snapshot={snapshot}
        startPending={extractionStartMutation.status === "pending"}
        state={extractionUiState}
        stopPending={extractionStopMutation.status === "pending"}
        streamStatus={scale.streamStatus}
        trace={scale.trace}
        visible={consoleOpen}
        workflowBlock={
          cooldownActive
            ? "cooldown"
            : snapshot?.activeMode === "steam"
              ? "steam"
              : null
        }
      />
      <TemperatureCalibrationScreen
        client={client}
        deviceName={deviceName}
        onClose={() => setTemperatureCalibrationOpen(false)}
        visible={temperatureCalibrationOpen}
      />
      <SteamControlSettingsScreen
        client={client}
        deviceName={deviceName}
        onClose={() => setSteamControlSettingsOpen(false)}
        visible={steamControlSettingsOpen}
      />
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={landscape ? 0 : safeAreaInsets.top}
        style={styles.keyboardAvoidingContent}>
      <Animated.View
        entering={
          dashboardTransitionDirection.current === "forward"
            ? FadeInDown.duration(180)
            : FadeInUp.duration(180)
        }
        exiting={FadeOut.duration(90)}
        key={dashboardPage}
        style={styles.dashboardPageTransition}>
        <ScrollView
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustKeyboardInsets={process.env.EXPO_OS === "ios"}
          contentContainerStyle={[
            styles.content,
            landscape && styles.contentLandscape,
            {
              paddingRight: Math.max(20, safeAreaInsets.right + 12),
            },
          ]}
          onContentSizeChange={(_, contentHeight) => {
            dashboardContentHeight.current = contentHeight;
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
          onLayout={(event: LayoutChangeEvent) => {
            dashboardViewportHeight.current = event.nativeEvent.layout.height;
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
          keyboardDismissMode={
            process.env.EXPO_OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
          style={styles.dashboardScroll}
          scrollEventThrottle={16}>
        <View style={[styles.pageHeader, landscape && styles.pageHeaderLandscape]}>
          <Text selectable style={styles.pageTitle}>{deviceName}</Text>
        </View>
        <View style={[styles.intro, landscape && styles.introLandscape]}>
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
          {!landscape ? (
            <Text selectable style={styles.lead}>
              {translate(
                `dashboard.navigation.${dashboardPage}.lead`,
              )}
            </Text>
          ) : null}
        </View>

        {refreshing && !landscape ? (
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
            {scale.scale?.warning !== null && scale.scale?.warning !== undefined ? (
              <View style={styles.scaleWarningCard}>
                <Text selectable style={styles.unavailableTitle}>
                  {translate("scale.fallbackTitle")}
                </Text>
                <Text selectable style={styles.unavailableText}>
                  {translate("scale.fallbackDetail")}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={scale.mutation !== null}
                  onPress={() => void scale.acknowledgeWarning()}
                  style={({ pressed }) => [
                    styles.exportButton,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={styles.exportButtonText}>
                    {translate("scale.acknowledge")}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {connection.status === "online" && snapshot !== null ? (
              <>
                {landscape && !debugDeviceMode && thermalSnapshot !== null ? (
                  <Fragment key="dashboard-landscape-layout">
                    <View style={styles.dashboardLandscapeControlRow}>
                      <View style={styles.dashboardLandscapeControl}>
                        <MachineStatus
                          compact
                          disabled={freshness !== "live"}
                          faultMutation={faultMutation}
                          fillHeight
                          onDismissOverTemperature={dismissOverTemperature}
                          snapshot={snapshot}
                        />
                      </View>
                      <View style={styles.dashboardLandscapeControl}>
                        <ThermalWorkflowStatus
                          compact
                          fillHeight
                          mutationPending={mutationPending}
                          onOpenMachine={() => openDashboardPage("machine")}
                          onStartCooldown={startCooldown}
                          onStopCooldown={stopCooldown}
                          snapshot={thermalSnapshot}
                        />
                      </View>
                      <View style={styles.dashboardLandscapeControl}>
                        {mobileProfiles !== null ? (
                          <View style={styles.extractionControlGroup}>
                            <ExtractionConsoleEntry
                              compact
                              extraction={extraction}
                              onPress={() => setConsoleOpen(true)}
                              scale={scale.scale}
                              snapshot={snapshot}
                              trace={scale.trace}
                            />
                          </View>
                        ) : (
                          <ProfileLoadingCard error={profileStorageError} />
                        )}
                      </View>
                    </View>
                    <View style={styles.dashboardLandscapeDataRow}>
                      <View style={styles.dashboardLandscapeTemperature}>
                        <TemperatureCard
                          compact
                          compensation={compensation}
                          mode={snapshot.activeMode}
                          sensorTemperatureC={
                            snapshot.activeMode === "steam"
                              ? snapshot.boilerTemperatureC
                              : null
                          }
                          targetC={boilerTargetC(snapshot)}
                          temperatureC={
                            snapshot.steamControl.controlTemperatureC ??
                            boilerTemperatureC(snapshot)
                          }
                          width="100%"
                        />
                      </View>
                      <View style={styles.dashboardLandscapeGraph}>
                        <TemperatureHistoryChart
                          bands={1}
                          compact
                          error={temperatureHistory.error}
                          history={temperatureHistory.samples}
                          loading={temperatureHistory.status === "loading"}
                          scale={null}
                        />
                      </View>
                    </View>
                  </Fragment>
                ) : (
                  <Fragment key="dashboard-portrait-layout">
                    <View
                      style={[
                        styles.dashboardPrimary,
                        landscape && styles.dashboardPrimaryLandscape,
                      ]}>
                      <View
                        style={[
                          styles.dashboardLiveColumn,
                          landscape && styles.dashboardLiveColumnLandscape,
                        ]}>
                        <MachineStatus
                          compact={landscape}
                          disabled={freshness !== "live"}
                          faultMutation={faultMutation}
                          onDismissOverTemperature={dismissOverTemperature}
                          snapshot={snapshot}
                        />
                        <View style={styles.metricGrid}>
                          <TemperatureCard
                            compact={landscape}
                            compensation={compensation}
                            mode={snapshot.activeMode}
                            sensorTemperatureC={
                              snapshot.activeMode === "steam"
                                ? snapshot.boilerTemperatureC
                                : null
                            }
                            targetC={boilerTargetC(snapshot)}
                            temperatureC={
                              snapshot.steamControl.controlTemperatureC ??
                              boilerTemperatureC(snapshot)
                            }
                            width="100%"
                          />
                        </View>
                      </View>
                      <View
                        style={[
                          styles.dashboardActivityColumn,
                          landscape && styles.dashboardActivityColumnLandscape,
                        ]}>
                        <TemperatureHistoryChart
                          bands={1}
                          compact={landscape}
                          error={temperatureHistory.error}
                          history={temperatureHistory.samples}
                          loading={temperatureHistory.status === "loading"}
                          scale={null}
                        />
                        {mobileProfiles !== null ? (
                          <View style={styles.extractionControlGroup}>
                            <ExtractionConsoleEntry
                              compact={landscape}
                              extraction={extraction}
                              onPress={() => setConsoleOpen(true)}
                              scale={scale.scale}
                              snapshot={snapshot}
                              trace={scale.trace}
                            />
                          </View>
                        ) : (
                          <ProfileLoadingCard error={profileStorageError} />
                        )}
                      </View>
                    </View>
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
                  </Fragment>
                )}
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
              <TemperatureHistoryChart
                bands={1}
                compact={landscape}
                error={temperatureHistory.error}
                history={temperatureHistory.samples}
                loading={temperatureHistory.status === "loading"}
                scale={null}
              />
            ) : null}
          </>
        ) : null}

        {dashboardPage === "profiles" ? (
          <>
            {profileStorageError !== null && mobileProfiles === null ? (
              <ProfileLoadingCard error={profileStorageError} />
            ) : null}
            <MutationFeedback
              onDismiss={dismissLocalProfileMutation}
              state={localProfileMutation}
            />
            {mobileProfiles !== null ? (
              <ExtractionPreview
                compact={landscape}
                debugPreview={debugDeviceMode}
                onStateChange={applyExtractionUiState}
                profileWritePending={profileWritePending}
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
              <ProfileLoadingCard
                error={profileStorageError}
              />
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
              <HeaterToggleBar
                disabled={mutationPending}
                mutation={heaterMutation}
                onSetHeaterEnabled={setHeaterEnabled}
                snapshot={snapshot}
              />
            ) : null}

            <View
              style={[
                styles.machineLayout,
                landscape && styles.machineLayoutLandscape,
              ]}>
              <View style={styles.machineLayoutColumn}>
                {connection.status === "online" && snapshot !== null ? (
                  <>
                    <MachineControls
                      compact={landscape}
                      disabled={freshness !== "live"}
                      faultMutation={faultMutation}
                      heaterMutation={heaterMutation}
                      modeMutation={modeMutation}
                      onOpenTemperatureCalibration={() =>
                        setTemperatureCalibrationOpen(true)
                      }
                      onOpenSteamControlSettings={() =>
                        setSteamControlSettingsOpen(true)
                      }
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
              </View>

              <View style={styles.machineLayoutColumn}>
                {connection.status === "online" && snapshot !== null ? (
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
                ) : null}

                <TemperatureHistoryExportCard
                  error={temperatureHistory.exportError}
                  exporting={temperatureHistory.exporting}
                  onClear={() =>
                    Alert.alert(
                      translate("dashboard.historyClear"),
                      translate("dashboard.historyClearConfirm"),
                      [
                        {
                          text: translate("dashboard.historyClearCancel"),
                          style: "cancel",
                        },
                        {
                          text: translate("dashboard.historyClear"),
                          style: "destructive",
                          onPress: () => void clearTemperatureHistory(),
                        },
                      ],
                    )
                  }
                  onExport={() => void temperatureHistory.exportAll()}
                />

                <DisplayPreferencesCard
                  error={displayPreferences.error}
                  keepScreenAwake={
                    displayPreferences.preferences.keepScreenAwake
                  }
                  loading={displayPreferences.loading}
                  onKeepScreenAwakeChange={(enabled) => {
                    void displayPreferences.setKeepScreenAwake(enabled);
                  }}
                />

                <View style={styles.contextCard}>
                  <Text selectable style={styles.contextTitle}>
                    {translate("dashboard.savedMachine")}
                  </Text>
                  <Text selectable style={styles.contextText}>{initialNote}</Text>
                  <Text selectable style={styles.deviceId}>
                    {selectedDevice.deviceId}
                  </Text>
                  <Text selectable style={styles.address}>
                    {selectedDevice.httpsOrigin}
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
              </View>
            </View>
          </>
        ) : null}

        {dashboardPage === "scale" ? (
          <ScalePage
            profileId={selectedProfileId}
            referenceDefaults={
              scale.defaults?.[selectedProfileId] ?? {
                targetWeightDecigrams: 350,
                compensationDecigrams: 10,
              }
            }
            scale={scale}
          />
        ) : null}
        {dashboardPage === "shots" ? <ShotsPage scale={scale} /> : null}
        </ScrollView>
      </Animated.View>
      </KeyboardAvoidingView>

      <View
        style={[
          styles.bottomNavigation,
          landscape && styles.navigationRail,
          {
            paddingBottom: landscape
              ? Math.max(12, safeAreaInsets.bottom + 8)
              : navigationVerticalPadding,
            paddingLeft: landscape
              ? navigationRailInset
              : 12,
            paddingRight: landscape ? 4 : 12,
            paddingTop: landscape
              ? Math.max(8, safeAreaInsets.top + 4)
              : navigationVerticalPadding,
            width: landscape ? navigationRailInset + 36 : undefined,
          },
        ]}>
          {extraction?.status === "running" && !landscape ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setConsoleOpen(true)}
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
          <View
            accessibilityHint={translate("dashboard.navigation.swipePages")}
            accessibilityRole="tablist"
            style={[
              styles.bottomNavigationRow,
              landscape && styles.navigationRailTabs,
            ]}>
            <DashboardTab
              active={dashboardPage === "dashboard"}
              landscape={landscape}
              label={translate("dashboard.navigation.dashboard.tab")}
              onPress={() => openDashboardPage("dashboard")}
              workflowActive={extraction?.status === "running"}
            />
            <DashboardTab
              active={dashboardPage === "profiles"}
              landscape={landscape}
              label={translate("dashboard.navigation.profiles.tab")}
              onPress={() => openDashboardPage("profiles")}
            />
            <DashboardTab
              active={dashboardPage === "machine"}
              landscape={landscape}
              label={translate("dashboard.navigation.machine.tab")}
              onPress={() => openDashboardPage("machine")}
            />
            <DashboardTab
              active={dashboardPage === "scale"}
              landscape={landscape}
              label={translate("dashboard.navigation.scale.tab")}
              onPress={() => openDashboardPage("scale")}
            />
            <DashboardTab
              active={dashboardPage === "shots"}
              landscape={landscape}
              label={translate("dashboard.navigation.shots.tab")}
              onPress={() => openDashboardPage("shots")}
            />
          </View>
        </View>
    </View>
  );
}

function ScalePage({
  profileId,
  referenceDefaults,
  scale,
}: {
  profileId: ProfileSlotId;
  referenceDefaults: WeightControl;
  scale: ReturnType<typeof useScale>;
}) {
  const [reference, setReference] = useState("100.0");
  const [defaults, setDefaults] = useState(referenceDefaults);
  useEffect(() => setDefaults(referenceDefaults), [referenceDefaults]);
  const state = scale.scale;
  const busy = scale.mutation !== null;
  return (
    <View style={styles.machineLayout}>
      <View style={styles.machineLayoutColumn}>
        <View style={styles.contextCard}>
          <Text selectable style={styles.cardLabel}>
            {translate("scale.diagnostics")}
          </Text>
          <Text selectable style={styles.contextTitle}>
            {translate("scale.status", {
              status: state?.availability ?? "unavailable",
            })}
          </Text>
          <Text selectable style={styles.contextText}>
            {translate("scale.calibrationStatus", {
              status: state?.calibrationStatus ?? "uncalibrated",
            })}
          </Text>
          <Text selectable style={styles.scaleLiveWeight}>
            {translate("scale.grossWeight", {
              weight: formatWeightReadout(state?.grossWeightDecigrams),
            })}
          </Text>
          {scale.error !== null ? (
            <Text selectable style={styles.historyError}>{scale.error}</Text>
          ) : null}
        </View>

        <View style={styles.contextCard}>
          <Text selectable style={styles.cardLabel}>
            {translate("scale.calibration")}
          </Text>
          <Text selectable style={styles.contextText}>
            {state?.calibrationStatus === "calibrating"
              ? translate("scale.placeReference")
              : translate("scale.emptyPlatform")}
          </Text>
          {state?.calibrationStatus === "calibrating" ? (
            <TextInput
              accessibilityLabel={translate("scale.referenceWeight")}
              editable={!busy}
              inputMode="decimal"
              onChangeText={setReference}
              style={styles.scaleInput}
              value={reference}
            />
          ) : null}
          <View style={styles.scaleModeRow}>
            {state?.calibrationStatus === "calibrating" ? (
              <>
                <Pressable
                  disabled={busy}
                  onPress={() =>
                    void scale.completeCalibration(
                      Math.round(Number(reference.replace(",", ".")) * 10),
                    )
                  }
                  style={styles.exportButton}>
                  <Text style={styles.exportButtonText}>
                    {translate("scale.completeCalibration")}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => void scale.cancelCalibration()}
                  style={styles.scaleModeButton}>
                  <Text style={styles.scaleModeButtonText}>
                    {translate("scale.cancel")}
                  </Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                disabled={busy}
                onPress={() => void scale.startCalibration()}
                style={styles.exportButton}>
                <Text style={styles.exportButtonText}>
                  {translate("scale.startCalibration")}
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.contextCard}>
          <Text selectable style={styles.cardLabel}>
            {translate("scale.profileDefaults", { profile: profileId })}
          </Text>
          <WeightControlEditor
            disabled={busy}
            onChange={setDefaults}
            value={defaults}
          />
          <Pressable
            disabled={busy}
            onPress={() => void scale.saveDefault(profileId, defaults)}
            style={styles.exportButton}>
            <Text style={styles.exportButtonText}>
              {translate("scale.saveDefaults")}
            </Text>
          </Pressable>
        </View>
      </View>

    </View>
  );
}

function ShotsPage({ scale }: { scale: ReturnType<typeof useScale> }) {
  const [selectedShot, setSelectedShot] = useState<
    (typeof scale.history)[number] | null
  >(null);
  const [selectedTrace, setSelectedTrace] = useState<
    Awaited<ReturnType<typeof scale.selectTrace>>
  >(null);
  const openShot = async (shot: (typeof scale.history)[number]) => {
    setSelectedShot(shot);
    setSelectedTrace(
      await scale.selectTrace(shot.extractionId, shot.bootId),
    );
  };
  return (
    <View style={styles.machineLayout}>
      <View style={styles.machineLayoutColumn}>
        <View style={styles.contextCard}>
          <Text selectable style={styles.cardLabel}>
            {translate("scale.history")}
          </Text>
          {scale.history.map((shot) => (
            <Pressable
              accessibilityRole="button"
              key={`${shot.bootId ?? "pending"}:${shot.extractionId}`}
              onPress={() => void openShot(shot)}
              style={({ pressed }) => [
                styles.scaleHistoryRow,
                pressed && styles.pressed,
              ]}>
              <Text selectable style={styles.contextTitle}>
                {formatWeightReadout(shot.finalWeightDecigrams)} · {shotLabel(shot)}
              </Text>
              <Text selectable style={styles.contextText}>
                {new Date(shot.recordedAtMs).toLocaleString()} · {shot.outcome ?? shot.recordStatus ?? "incomplete"}
              </Text>
              <Text selectable style={styles.traceAvailability}>
                {shot.traceCompleteness === null || shot.traceCompleteness === undefined
                  ? translate("scale.traceUnavailable")
                  : `${translate("scale.traceOpen")} · ${shot.traceCompleteness}`}
              </Text>
            </Pressable>
          ))}
          {scale.history.length === 0 ? (
            <Text selectable style={styles.contextText}>
              {translate("scale.noHistory")}
            </Text>
          ) : null}
          <View style={styles.scaleModeRow}>
            <Pressable
              disabled={scale.history.length === 0}
              onPress={() => void scale.exportHistory()}
              style={styles.exportButton}>
              <Text style={styles.exportButtonText}>
                {translate("scale.exportCsv")}
              </Text>
            </Pressable>
            <Pressable
              disabled={scale.history.length === 0}
              onPress={() =>
                Alert.alert(
                  translate("scale.clearHistory"),
                  translate("scale.clearHistoryConfirm"),
                  [
                    { text: translate("scale.cancel"), style: "cancel" },
                    {
                      text: translate("scale.clear"),
                      style: "destructive",
                      onPress: () => void scale.clearHistory(),
                    },
                  ],
                )
              }
              style={styles.scaleModeButton}>
              <Text style={styles.scaleModeButtonText}>
                {translate("scale.clearHistory")}
              </Text>
            </Pressable>
          </View>
          {scale.historyError !== null ? (
            <Text selectable style={styles.historyError}>{scale.historyError}</Text>
          ) : null}
        </View>
      </View>
      <View style={styles.machineLayoutColumn}>
        {selectedShot !== null ? (
          <View style={styles.contextCard}>
            <View style={styles.shotDetailHeader}>
              <View>
                <Text selectable style={styles.cardLabel}>
                  {translate("scale.traceTitle", {
                    status: (selectedTrace?.completeness ?? selectedShot.recordStatus ?? "incomplete").toUpperCase(),
                  })}
                </Text>
                <Text selectable style={styles.contextTitle}>
                  {shotLabel(selectedShot)} · {selectedShot.outcome ?? "incomplete"}
                </Text>
                <Text selectable style={styles.contextText}>
                  {selectedShot.selection.kind === "profile"
                    ? selectedShot.selection.profile.name
                    : translate("scale.historyManual")}
                </Text>
                <Text selectable style={styles.contextText}>{selectedShot.extractionId}</Text>
              </View>
              <View style={styles.scaleModeRow}>
                {selectedTrace !== null ? (
                  <Pressable
                    onPress={() => void scale.exportTrace(selectedTrace)}
                    style={styles.exportButton}>
                    <Text style={styles.exportButtonText}>{translate("scale.traceExport")}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => {
                    setSelectedShot(null);
                    setSelectedTrace(null);
                  }}
                  style={styles.scaleModeButton}>
                  <Text style={styles.scaleModeButtonText}>{translate("scale.traceClose")}</Text>
                </Pressable>
              </View>
            </View>
            {selectedTrace === null ? (
              <Text selectable style={styles.contextText}>
                {translate("scale.traceUnavailable")}
              </Text>
            ) : (
              <WeightedTraceChart key={selectedTrace.extractionId} trace={selectedTrace} />
            )}
          </View>
        ) : (
          <View style={styles.contextCard}>
            <Text selectable style={styles.contextText}>{translate("scale.traceOpen")}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function shotLabel(shot: {
  controlMode: "manual" | "timed" | "weight";
  profileId: ProfileSlotId | null;
}): string {
  return translate(
    shot.controlMode === "manual"
      ? "scale.historyManual"
      : shot.controlMode === "timed"
        ? "scale.historyTimedProfile"
        : "scale.historyWeightProfile",
    { profile: shot.profileId ?? "" },
  ).trim();
}

function ProfileLoadingCard({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry?: () => void;
}) {
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
      {error !== null && onRetry !== undefined ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.profileRetryButton,
            pressed && styles.pressed,
          ]}>
          <Text style={styles.profileRetryButtonText}>
            {translate("extractionPreview.retryProfiles")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function DashboardTab({
  active,
  landscape,
  label,
  onPress,
  workflowActive = false,
}: {
  active: boolean;
  landscape: boolean;
  label: string;
  onPress: () => void;
  workflowActive?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.bottomNavigationTab,
        landscape && styles.navigationRailTab,
        active && !landscape && styles.bottomNavigationTabActive,
        pressed && styles.pressed,
      ]}>
      {landscape ? (
        <View
          style={[
            styles.navigationDot,
            active && styles.navigationDotActive,
            workflowActive && styles.navigationDotWorkflow,
          ]}
        />
      ) : (
        <Text
          style={[
            styles.bottomNavigationLabel,
            active && styles.bottomNavigationLabelActive,
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function TemperatureHistoryExportCard({
  error,
  exporting,
  onClear,
  onExport,
}: {
  error: "export" | "storage" | null;
  exporting: boolean;
  onClear: () => void;
  onExport: () => void;
}) {
  const disabled = exporting;

  return (
    <View style={styles.historyExportCard}>
      <Text selectable style={styles.cardLabel}>
        {translate("dashboard.historyExportTitle")}
      </Text>
      <Text selectable style={styles.contextTitle}>
        {translate("dashboard.historyExport")}
      </Text>
      <Text selectable style={styles.contextText}>
        {translate("dashboard.historyExportDetail")}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onExport}
        style={({ pressed }) => [
          styles.exportButton,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}>
        <Text style={styles.exportButtonText}>
          {exporting
            ? translate("dashboard.historyExporting")
            : translate("dashboard.historyExport")}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={exporting}
        onPress={onClear}
        style={({ pressed }) => [
          styles.scaleModeButton,
          exporting && styles.disabled,
          pressed && styles.pressed,
        ]}>
        <Text style={styles.scaleModeButtonText}>
          {translate("dashboard.historyClear")}
        </Text>
      </Pressable>
      {error !== null ? (
        <Text accessibilityLiveRegion="polite" selectable style={styles.historyError}>
          {translate(
            error === "storage"
              ? "dashboard.historyExportStorageError"
              : "dashboard.historyExportError",
          )}
        </Text>
      ) : null}
    </View>
  );
}

function DisplayPreferencesCard({
  error,
  keepScreenAwake,
  loading,
  onKeepScreenAwakeChange,
}: {
  error: "load" | "save" | null;
  keepScreenAwake: boolean;
  loading: boolean;
  onKeepScreenAwakeChange: (enabled: boolean) => void;
}) {
  return (
    <View style={styles.contextCard}>
      <Text selectable style={styles.cardLabel}>
        {translate("dashboard.displayPreferences")}
      </Text>
      <View style={styles.displayPreferenceRow}>
        <View style={styles.displayPreferenceCopy}>
          <Text selectable style={styles.contextTitle}>
            {translate("dashboard.keepScreenAwake")}
          </Text>
          <Text selectable style={styles.contextText}>
            {translate("dashboard.keepScreenAwakeDetail")}
          </Text>
        </View>
        <Switch
          accessibilityLabel={translate("dashboard.keepScreenAwake")}
          disabled={loading}
          onValueChange={onKeepScreenAwakeChange}
          value={keepScreenAwake}
        />
      </View>
      {error !== null ? (
        <Text accessibilityLiveRegion="polite" selectable style={styles.historyError}>
          {translate(
            error === "load"
              ? "dashboard.displayPreferencesLoadError"
              : "dashboard.displayPreferencesSaveError",
          )}
        </Text>
      ) : null}
    </View>
  );
}

function MachineStatus({
  compact,
  disabled,
  faultMutation,
  fillHeight = false,
  onDismissOverTemperature,
  snapshot,
}: {
  compact: boolean;
  disabled: boolean;
  faultMutation: DashboardMutationState;
  fillHeight?: boolean;
  onDismissOverTemperature: () => void;
  snapshot: MachineState;
}) {
  const useAndroidStatusLayout = compact || process.env.EXPO_OS === "android";
  const canDismissOverTemperature =
    snapshot.status === "fault" &&
    snapshot.fault.code === "over_temperature" &&
    boilerTemperatureC(snapshot) !== null &&
    boilerTemperatureC(snapshot)! <= boilerTargetC(snapshot);
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
      <View
        style={[
          styles.machineStateCard,
          compact && styles.machineStateCardCompact,
          fillHeight && styles.machineStateCardFill,
        ]}>
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
              adjustsFontSizeToFit={compact || useAndroidStatusLayout}
              minimumFontScale={0.65}
              numberOfLines={compact || useAndroidStatusLayout ? 1 : undefined}
              selectable
              style={[
                styles.machineStateValue,
                compact && styles.machineStateValueCompact,
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
                      current:
                        boilerTemperatureC(snapshot) === null
                          ? "—"
                          : formatTemperature(boilerTemperatureC(snapshot)!),
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
  compact,
  compensation,
  mode,
  sensorTemperatureC,
  targetC,
  temperatureC,
  width,
}: {
  compact: boolean;
  compensation: CompensationState | null;
  mode: MachineState["activeMode"];
  sensorTemperatureC: number | null;
  targetC: number;
  temperatureC: number | null;
  width: "100%" | "48.5%";
}) {
  return (
    <View
      style={[
        styles.temperatureCard,
        { width },
        styles.activeCard,
        compact && styles.temperatureCardCompact,
      ]}>
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
      <Text
        selectable
        style={[
          styles.temperatureValue,
          compact && styles.temperatureValueCompact,
        ]}>
        {temperatureC === null ? "—" : formatTemperature(temperatureC)}
      </Text>
      <Text selectable style={styles.temperatureTarget}>
        {translate("dashboard.target")} {formatTarget(targetC)}
      </Text>
      {sensorTemperatureC === null ? null : (
        <Text selectable style={styles.temperatureTarget}>
          {translate("steamControl.sensorReading", {
            value: formatTemperature(sensorTemperatureC),
          })}
        </Text>
      )}
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
  screenLandscape: { flexDirection: "row-reverse" },
  dashboardPageTransition: { flex: 1, minWidth: 0 },
  keyboardAvoidingContent: { flex: 1, minHeight: 0 },
  dashboardScroll: { flex: 1, minWidth: 0 },
  content: {
    backgroundColor: "#F4F0E8",
    flexGrow: 1,
    gap: 16,
    padding: 20,
    paddingBottom: 24,
    paddingTop: 72,
  },
  contentLandscape: {
    gap: 12,
    paddingBottom: 16,
    paddingLeft: 16,
    paddingTop: 12,
    width: "100%",
  },
  bottomNavigation: {
    backgroundColor: "#FFFCF7",
    borderColor: "#D8C9BA",
    borderTopWidth: 1,
    gap: 8,
    paddingHorizontal: 12,
  },
  bottomNavigationRow: { flexDirection: "row", gap: 8 },
  navigationRail: {
    backgroundColor: "transparent",
    borderRightWidth: 0,
    borderTopWidth: 0,
    justifyContent: "center",
    paddingHorizontal: 0,
  },
  navigationRailTabs: {
    alignItems: "center",
    flexDirection: "column",
    gap: 4,
    justifyContent: "center",
  },
  navigationRailTab: {
    flex: 0,
    minHeight: 44,
    paddingHorizontal: 0,
    width: 32,
  },
  navigationDot: {
    backgroundColor: "rgba(139, 58, 43, 0.28)",
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  navigationDotActive: { backgroundColor: "#8B3A2B", height: 11, width: 11 },
  navigationDotWorkflow: { borderColor: "#F29A52", borderWidth: 2 },
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
  pageHeaderLandscape: { display: "none" },
  pageTitle: { color: "#241B17", fontSize: 22, fontWeight: "800" },
  intro: { gap: 7, paddingHorizontal: 2, paddingTop: 8 },
  introLandscape: { paddingTop: 0 },
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
  machineStateCardCompact: { gap: 8, padding: 14 },
  machineStateCardFill: { flexGrow: 1, justifyContent: "space-between" },
  cardLabel: { color: "#CDBFB5", fontSize: 11, fontWeight: "800", letterSpacing: 1.3 },
  machineStateRow: { alignItems: "flex-end", flexDirection: "row", gap: 14, justifyContent: "space-between" },
  machineStateRowAndroid: { alignItems: "stretch", flexDirection: "column", gap: 8 },
  machineStatePrimary: { flex: 1, gap: 4 },
  machineStatePrimaryAndroid: { flex: undefined },
  machineStateFooterAndroid: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  machineStateValue: { color: "#FFF9F1", fontSize: 34, fontWeight: "800", letterSpacing: -0.7 },
  machineStateValueCompact: { flexShrink: 1, fontSize: 28 },
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
  exportButton: {
    alignItems: "center",
    alignSelf: "flex-start",
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
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  dashboardPrimary: { gap: 12 },
  dashboardPrimaryLandscape: {
    alignItems: "stretch",
    flexDirection: "row",
  },
  dashboardLiveColumn: { gap: 12 },
  dashboardLiveColumnLandscape: { flex: 0.82, minWidth: 0 },
  dashboardActivityColumn: { gap: 12 },
  dashboardActivityColumnLandscape: {
    alignItems: "stretch",
    flex: 1.65,
    flexDirection: "row",
    minWidth: 0,
  },
  extractionControlGroup: { flex: 1, gap: 8, minWidth: 0 },
  dashboardLandscapeControlRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 10,
    zIndex: 10,
  },
  dashboardLandscapeControl: { flex: 1, minWidth: 2 },
  dashboardLandscapeDataRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 10,
    zIndex: 0,
  },
  dashboardLandscapeTemperature: { flex: 1, minWidth: 0 },
  dashboardLandscapeGraph: { flex: 2, minWidth: 0 },
  temperatureCard: {
    backgroundColor: "#FFFCF7",
    borderColor: "#DDD3C7",
    borderCurve: "continuous",
    borderRadius: 22,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  temperatureCardCompact: { gap: 14, paddingBottom: 10, paddingTop: 10 },
  activeCard: { borderColor: "#A14B37", borderWidth: 2, padding: 17 },
  temperatureHeading: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" },
  temperatureLabel: { color: "#4A3E37", fontSize: 17, fontWeight: "800" },
  temperaturePills: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" },
  activePill: { backgroundColor: "#8B3A2B", borderRadius: 999, color: "#FFFFFF", fontSize: 10, fontWeight: "900", letterSpacing: 0.7, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5 },
  temperatureValue: { color: "#241B17", fontSize: 46, fontVariant: ["tabular-nums"], fontWeight: "800", letterSpacing: -1.5 },
  temperatureValueCompact: { fontSize: 36 },
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
  profileRetryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: "#8B3A2B",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  profileRetryButtonText: {
    color: "#8B3A2B",
    fontSize: 14,
    fontWeight: "800",
  },
  contextCard: {
    backgroundColor: "#FFFCF7",
    borderColor: "#DDD3C7",
    borderCurve: "continuous",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 17,
  },
  scaleWarningCard: {
    backgroundColor: "#FFF0D8",
    borderColor: "#C66A24",
    borderRadius: 18,
    borderWidth: 2,
    gap: 8,
    padding: 17,
  },
  scaleModeRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  scaleModeButton: {
    alignItems: "center",
    borderColor: "#8B3A2B",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 15,
  },
  scaleModeButtonText: { color: "#5D2D22", fontSize: 14, fontWeight: "800" },
  scaleInput: {
    backgroundColor: "#F4F0E8",
    borderColor: "#CDBFB2",
    borderRadius: 12,
    borderWidth: 1,
    color: "#241B17",
    fontSize: 20,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
    minHeight: 46,
    paddingHorizontal: 12,
  },
  scaleLiveWeight: {
    color: "#2D7547",
    fontSize: 20,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
  },
  scaleHistoryRow: {
    borderBottomColor: "#E5DBD0",
    borderBottomWidth: 1,
    gap: 2,
    paddingVertical: 9,
  },
  shotDetailHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
  },
  traceAvailability: {
    color: "#537D7B",
    fontSize: 12,
    fontWeight: "700",
  },
  displayPreferenceRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between",
  },
  displayPreferenceCopy: { flex: 1, gap: 4 },
  machineLayout: { gap: 12 },
  machineLayoutLandscape: {
    flexDirection: "column",
  },
  machineLayoutColumn: { flex: 1, gap: 12, minWidth: 0 },
  historyExportCard: {
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
