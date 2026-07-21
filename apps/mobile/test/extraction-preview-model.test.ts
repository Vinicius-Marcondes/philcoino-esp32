import { describe, expect, test } from "bun:test";

import {
  ExtractionStateSchema,
  ProfileSetSchema,
  StartExtractionRequestSchema,
} from "@philcoino/protocol";

import {
  advanceExtractionPreview,
  canStartPreview,
  createExtractionPreviewState,
  createPreviewStartRequest,
  exportProfilesPreview,
  profilesAreSynchronized,
  saveMobileProfile,
  selectPreview,
  startExtractionPreview,
  stopExtractionPreview,
} from "../src/debug/extraction-preview-model";

describe("extraction design preview model", () => {
  test("seeds Manual plus four stable slots and two editable examples", () => {
    const state = createExtractionPreviewState();

    expect(ProfileSetSchema.safeParse(state.mobileProfiles).success).toBe(true);
    expect(state.mobileProfiles.profiles.map((slot) => slot.id)).toEqual([
      "profile-1",
      "profile-2",
      "profile-3",
      "profile-4",
    ]);
    expect(state.mobileProfiles.profiles.map((slot) => slot.profile?.name ?? null)).toEqual([
      "Classic30",
      "Pre5Soak5",
      null,
      null,
    ]);
    expect(state.selected).toEqual({ kind: "manual" });
    expect(profilesAreSynchronized(state)).toBe(true);
  });

  test("keeps local edits out of machine preview state until whole-set export", () => {
    const initial = selectPreview(createExtractionPreviewState(), {
      kind: "profile",
      profileId: "profile-1",
    });
    const edited = saveMobileProfile(initial, "profile-1", {
      name: "Short20",
      preInfusionSeconds: 0,
      soakSeconds: 0,
      mainExtractionSeconds: 20,
    });

    expect(edited.mobileProfiles.profiles[0].profile?.name).toBe("Short20");
    expect(edited.machineProfiles.profiles[0].profile?.name).toBe("Classic30");
    expect(profilesAreSynchronized(edited)).toBe(false);
    expect(canStartPreview(edited)).toBe(false);

    const exported = exportProfilesPreview(edited);
    expect(profilesAreSynchronized(exported)).toBe(true);
    expect(canStartPreview(exported)).toBe(true);
    expect(exported.notice).toBe("exported");
  });

  test("keeps Manual available while custom profiles are unsynchronized", () => {
    const edited = saveMobileProfile(createExtractionPreviewState(), "profile-1", {
      name: "Short20",
      preInfusionSeconds: 0,
      soakSeconds: 0,
      mainExtractionSeconds: 20,
    });
    const manual = selectPreview(edited, { kind: "manual" });

    expect(canStartPreview(manual)).toBe(true);
    expect(StartExtractionRequestSchema.safeParse(createPreviewStartRequest(manual)).success).toBe(
      true,
    );
  });

  test("previews pre-infusion, soak, main extraction, then acknowledged idle", () => {
    let state = selectPreview(createExtractionPreviewState(), {
      kind: "profile",
      profileId: "profile-2",
    });
    state = startExtractionPreview(state);
    expect(state.extraction).toMatchObject({
      status: "running",
      phase: "pre-infusion",
      elapsedMs: 0,
      remainingMs: 35_000,
      pumpCommand: "running",
    });

    state = advanceExtractionPreview(state);
    expect(state.extraction).toMatchObject({
      phase: "soak",
      elapsedMs: 5_000,
      remainingMs: 30_000,
      pumpCommand: "off",
    });

    state = advanceExtractionPreview(state);
    expect(state.extraction).toMatchObject({
      phase: "main-extraction",
      elapsedMs: 10_000,
      remainingMs: 25_000,
      pumpCommand: "running",
    });

    state = advanceExtractionPreview(state);
    expect(state.extraction).toMatchObject({
      status: "idle",
      phase: "idle",
      pumpCommand: "off",
    });
    expect(ExtractionStateSchema.safeParse(state.extraction).success).toBe(true);
  });

  test("previews Manual cutoff and idempotent Stop without device calls", () => {
    let state = startExtractionPreview(createExtractionPreviewState());
    expect(state.extraction).toMatchObject({
      phase: "manual",
      elapsedMs: 0,
      remainingMs: 60_000,
      pumpCommand: "running",
    });

    state = advanceExtractionPreview(state);
    expect(state.extraction).toMatchObject({
      elapsedMs: 30_000,
      remainingMs: 30_000,
    });
    state = advanceExtractionPreview(state);
    expect(state.extraction.status).toBe("idle");
    expect(stopExtractionPreview(stopExtractionPreview(state)).extraction.status).toBe(
      "idle",
    );
  });

  test("blocks export while active and preserves both complete sets", () => {
    const active = startExtractionPreview(createExtractionPreviewState());
    const result = exportProfilesPreview(active);

    expect(result.notice).toBe("export-blocked");
    expect(result.mobileProfiles).toEqual(active.mobileProfiles);
    expect(result.machineProfiles).toEqual(active.machineProfiles);
    expect(result.extraction.status).toBe("running");
  });

  test("prevents profile selection and editing while active", () => {
    const active = startExtractionPreview(createExtractionPreviewState());
    const selected = selectPreview(active, {
      kind: "profile",
      profileId: "profile-1",
    });
    const edited = saveMobileProfile(active, "profile-1", null);

    expect(selected).toBe(active);
    expect(edited).toBe(active);
  });

  test("component source keeps mock labeling and accessible interaction roles", async () => {
    const source = await Bun.file(
      new URL("../components/extraction-preview.tsx", import.meta.url),
    ).text();

    expect(source).toContain('translate("extractionPreview.warning")');
    expect(source).toContain('accessibilityRole="radiogroup"');
    expect(source).toContain('accessibilityRole="radio"');
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain("function QuickProfilePicker");
    expect(source).toContain("compact && styles.profilePickerMenuCompact");
    expect(source).toContain('position: "absolute"');
    expect(source).toContain('flexBasis: "50%"');
    expect(source).toContain("fullRow={compact}");
    expect(source).toContain('flexBasis: "100%"');
    expect(source).toContain("accessibilityState={{ disabled: active, expanded }}");
    expect(source).toContain('translate("extractionPreview.pumpBoundary")');
    expect(source).toContain(
      'accessibilityHint={translate("extractionPreview.pumpBoundary")}',
    );
    expect(source).not.toContain("styles.commandBoundary");
    expect(source).toContain('translate("extractionPreview.pumpCommand", {');
    expect(source).toContain("function CompactBlockStatus");
    expect(source).toContain('"extractionPreview.exportProfilesCompact"');
    expect(source).toContain("<CompactBlockStatus {...compactQuickAction} />");
    expect(source).toContain('translate("extractionPreview.importProfiles")');
    expect(source).toContain('translate("extractionPreview.confirmImport")');
    expect(source).toContain("profileImportChanges(");
    expect(source).toContain("importState.changes.map((change)");
    expect(source).toContain("<ProfileImportValue");
    expect(source).toContain("profileWritePending || profileReviewOpen");
    expect(source).toContain('key={profileEditorKey}');
    expect(source).toContain("styles.compactSelectorColumn");
    expect(source).toContain('{!compact || view !== "quick" ? (');
    expect(source).not.toContain("styles.compactStatusRow");
    expect(source).not.toContain("styles.compactCommandStatus");
    expect(source).toContain("hitSlop={10}");
    expect(source).toContain("actionButtonCompact: {");
    expect(source).toContain('borderCurve: "continuous"');
    const portraitStepperStyle = source.slice(
      source.indexOf("stepperRow: {"),
      source.indexOf("stepperRowCompact: {"),
    );
    expect(portraitStepperStyle).toContain('flexWrap: "nowrap"');
    const portraitStepperLabelStyle = source.slice(
      source.indexOf("stepperLabel: {"),
      source.indexOf("stepperLabelCompact: {"),
    );
    expect(portraitStepperLabelStyle).toContain("flexShrink: 1");
    expect(portraitStepperLabelStyle).toContain("minWidth: 0");
    expect(source).toContain("extractionPresentationTitle(extractionStatus.title)");
    const profileWorkspace = source.indexOf("styles.profileWorkspaceRow");
    const localEditor = source.indexOf("<ProfileEditor", profileWorkspace);
    const profileSidebar = source.indexOf("styles.profileSidebar", localEditor);
    const profileConfiguration = source.indexOf(
      "<ProfileSelectionCard",
      profileSidebar,
    );
    const profileSync = source.indexOf(
      "<ProfileSyncCard",
      profileConfiguration,
    );
    expect(profileWorkspace).toBeGreaterThan(-1);
    expect(localEditor).toBeGreaterThan(profileWorkspace);
    expect(profileSidebar).toBeGreaterThan(localEditor);
    expect(profileConfiguration).toBeGreaterThan(profileSidebar);
    expect(profileSync).toBeGreaterThan(profileConfiguration);
    expect(source).toContain("styles.profileEditorLandscapePanel");
    expect(source).toContain("styles.profileEditorStepperList");
    expect(source).toContain("profileEditorStepperList: { gap: 10 }");
    expect(source).toContain("compact && styles.roundButtonCompact");
    expect(source).toContain("stepperActionsCompact: {");
    expect(source).toContain("stepperRowCompact: {");
    expect(source).toContain("padding: 10");
    expect(source).toContain(
      "stepperValueCompact: { flex: 1, fontSize: 14, minWidth: 0 }",
    );
    expect(source).toContain('width: "auto"');
    expect(source).not.toContain("DeviceApiClient");
    expect(source).not.toContain("fetch(");
  });

  test("debug dashboard separates live controls, profile configuration, and machine controls", async () => {
    const source = await Bun.file(
      new URL("../components/dashboard-screen.tsx", import.meta.url),
    ).text();

    expect(source).toContain("type DashboardPage,");
    expect(source).toContain('view="quick"');
    expect(source).toContain('view="profiles"');
    expect(source).toContain('accessibilityRole="tablist"');
    expect(source).toContain('accessibilityRole="tab"');
    expect(source).toContain('styles.activeExtractionBar');
    expect(source).toContain('state={extractionUiState}');
    expect(source).toContain("pageScrollOffsets.current[dashboardPage]");
    expect(source).toContain("pendingScrollRestore.current");
    expect(source).toContain("dashboardScrollView.current?.scrollTo");
    expect(source).toContain("key={dashboardPage}");
    expect(source).toContain("paddingBottom: 24");
    expect(source).not.toContain("contentWithNavigation");
    expect(source).toContain("navigationVerticalPadding");
    expect(source).toContain(": navigationVerticalPadding");
    expect(source).toContain("landscape && styles.navigationRail");
    expect(source).toContain("landscape && styles.navigationRailTabs");
    expect(source).toContain("navigationSwipeResponder.panHandlers");
    expect(source).toContain("onMoveShouldSetPanResponderCapture");
    expect(source).toContain("shouldNavigateDashboardPageSwipe({");
    expect(source).toContain("<Animated.View");
    expect(source).toContain("FadeInDown.duration(180)");
    expect(source).toContain("FadeInUp.duration(180)");
    expect(source).toContain("exiting={FadeOut.duration(90)}");
    expect(source).toContain("styles.navigationDotActive");
    expect(source).toContain(
      "dashboardPageTransition: { flex: 1, minWidth: 0 }",
    );
    expect(source).toContain("dashboardScroll: { flex: 1, minWidth: 0 }");
    expect(source).toContain('width: "100%"');
    expect(source).toContain(
      '<Fragment key="dashboard-landscape-layout">',
    );
    expect(source).toContain('<Fragment key="dashboard-portrait-layout">');
    expect(source).toContain("minHeight: 44");

    const machineStatus = source.indexOf("<MachineStatus");
    const boilerTemperature = source.indexOf("<TemperatureCard", machineStatus);
    const temperatureCurve = source.indexOf("<TemperatureCurve", boilerTemperature);
    const extraction = source.indexOf("<ExtractionPreview", temperatureCurve);
    const cooldown = source.indexOf("<ThermalWorkflowPreview", extraction);
    expect(machineStatus).toBeGreaterThan(-1);
    expect(boilerTemperature).toBeGreaterThan(machineStatus);
    expect(temperatureCurve).toBeGreaterThan(boilerTemperature);
    expect(extraction).toBeGreaterThan(temperatureCurve);
    expect(cooldown).toBeGreaterThan(extraction);
    expect(source).toContain("<MachineStatus\n                          compact\n                          disabled=");
    expect(source).toContain("faultMutation={faultMutation}\n                          fillHeight");
    expect(source).toContain("<ThermalWorkflowStatus\n                          compact\n                          fillHeight");

    const machineControls = source.indexOf("<MachineControls");
    const heaterToggle = source.indexOf("<HeaterToggleBar", machineControls);
    const uptime = source.indexOf('translate("dashboard.machineUptime")', heaterToggle);
    const steamTimer = source.indexOf('translate("dashboard.steamTimer")', uptime);
    const historyExport = source.indexOf("<TemperatureHistoryExportCard", steamTimer);
    const savedMachine = source.indexOf('translate("dashboard.savedMachine")', historyExport);
    expect(heaterToggle).toBeGreaterThan(machineControls);
    expect(uptime).toBeGreaterThan(heaterToggle);
    expect(steamTimer).toBeGreaterThan(uptime);
    expect(historyExport).toBeGreaterThan(steamTimer);
    expect(savedMachine).toBeGreaterThan(historyExport);
    expect(source).not.toContain("function CurveTab");
    expect(source).not.toContain("downsampleTemperatureHistory");

    const controlsSource = await Bun.file(
      new URL("../components/machine-controls.tsx", import.meta.url),
    ).text();
    expect(controlsSource.indexOf('translate("controls.activeMode")')).toBeLessThan(
      controlsSource.indexOf('translate("controls.temperatureTargets")'),
    );
  });
});
