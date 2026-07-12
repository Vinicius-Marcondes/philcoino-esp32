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
    expect(source).not.toContain("DeviceApiClient");
    expect(source).not.toContain("fetch(");
  });

  test("debug dashboard separates live controls, profile configuration, and machine controls", async () => {
    const source = await Bun.file(
      new URL("../components/dashboard-screen.tsx", import.meta.url),
    ).text();

    expect(source).toContain('type DashboardPage = "dashboard" | "profiles" | "machine"');
    expect(source).toContain('view="quick"');
    expect(source).toContain('view="profiles"');
    expect(source).toContain('accessibilityRole="tablist"');
    expect(source).toContain('accessibilityRole="tab"');
    expect(source).toContain('styles.activeExtractionBar');
    expect(source).toContain('state={extractionUiState}');
  });
});
