import { describe, expect, test } from "bun:test";

import {
  ExtractionStateSchema,
  StartExtractionRequestSchema,
} from "@philcoino/protocol";
import { ProfileSetSchema } from "../src/profiles/profile-set";

import {
  advanceExtractionPreview,
  canStartPreview,
  createExtractionPreviewState,
  createPreviewStartRequest,
  saveMobileProfile,
  selectPreview,
  startExtractionPreview,
  stopExtractionPreview,
} from "../src/debug/extraction-preview-model";

const PROFILE_TWO = {
  kind: "profile" as const,
  profileId: "profile-2" as const,
  profile: {
    name: "Pre5Soak5",
    preInfusionSeconds: 5,
    soakSeconds: 5,
    mainExtractionSeconds: 25,
  },
};

describe("extraction design preview model", () => {
  test("seeds four local slots and Manual", () => {
    const state = createExtractionPreviewState();
    expect(ProfileSetSchema.safeParse(state.mobileProfiles).success).toBe(true);
    expect(state.mobileProfiles.profiles.map((slot) => slot.id)).toEqual([
      "profile-1",
      "profile-2",
      "profile-3",
      "profile-4",
    ]);
    expect(state.selected).toEqual({ kind: "manual" });
  });

  test("local edits are immediately startable and become the inline snapshot", () => {
    const initialProfile = createExtractionPreviewState().mobileProfiles.profiles[0].profile!;
    const selected = selectPreview(createExtractionPreviewState(), {
      kind: "profile",
      profileId: "profile-1",
      profile: initialProfile,
    });
    const edited = saveMobileProfile(selected, "profile-1", {
      name: "Short20",
      preInfusionSeconds: 0,
      soakSeconds: 0,
      mainExtractionSeconds: 20,
    });

    expect(canStartPreview(edited)).toBe(true);
    expect(edited.selected).toMatchObject({
      kind: "profile",
      profile: { name: "Short20", mainExtractionSeconds: 20 },
    });
    expect(StartExtractionRequestSchema.safeParse(createPreviewStartRequest(edited)).success)
      .toBe(true);
  });

  test("previews the immutable inline profile through every phase", () => {
    let state = selectPreview(createExtractionPreviewState(), PROFILE_TWO);
    state = startExtractionPreview(state);
    expect(state.extraction).toMatchObject({ phase: "pre-infusion", remainingMs: 35_000 });

    state = advanceExtractionPreview(state);
    expect(state.extraction).toMatchObject({ phase: "soak", elapsedMs: 5_000 });
    state = advanceExtractionPreview(state);
    expect(state.extraction).toMatchObject({ phase: "main-extraction", elapsedMs: 10_000 });
    state = advanceExtractionPreview(state);
    expect(state.extraction.status).toBe("idle");
    expect(ExtractionStateSchema.safeParse(state.extraction).success).toBe(true);
  });

  test("Manual remains available and Stop is idempotent", () => {
    let state = startExtractionPreview(createExtractionPreviewState());
    expect(state.extraction).toMatchObject({ phase: "manual", remainingMs: 60_000 });
    state = stopExtractionPreview(state);
    expect(stopExtractionPreview(state).extraction.status).toBe("idle");
  });

  test("selection and edits stay locked while a shot is active", () => {
    const active = startExtractionPreview(
      selectPreview(createExtractionPreviewState(), PROFILE_TWO),
    );
    expect(selectPreview(active, { kind: "manual" })).toBe(active);
    expect(saveMobileProfile(active, "profile-2", null)).toBe(active);
    expect(active.extraction.selection).toEqual(PROFILE_TWO);
  });
});
