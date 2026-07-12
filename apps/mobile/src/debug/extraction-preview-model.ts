import {
  EXTRACTION_MAX_DURATION_MS,
  ExtractionProfileSchema,
  IdleExtractionStateSchema,
  ProfileSetSchema,
  StartExtractionRequestSchema,
  type ExtractionProfile,
  type ExtractionSelection,
  type ExtractionState,
  type ProfileSet,
  type ProfileSlotId,
  type RunningExtractionState,
  type StartExtractionRequest,
} from "@philcoino/protocol";

import {
  cloneProfileSet,
  DEFAULT_MOBILE_PROFILE_SET,
  profileSetsEqual,
} from "../profiles/profile-set";

export const previewProfileSet = DEFAULT_MOBILE_PROFILE_SET;

export interface ExtractionPreviewState {
  extraction: ExtractionState;
  machineProfiles: ProfileSet;
  mobileProfiles: ProfileSet;
  notice: "exported" | "export-blocked" | "started" | "stopped" | null;
  selected: ExtractionSelection;
}

export function createExtractionPreviewState(): ExtractionPreviewState {
  return {
    extraction: IdleExtractionStateSchema.parse({
      status: "idle",
      extractionId: null,
      selection: null,
      phase: "idle",
      elapsedMs: 0,
      remainingMs: null,
      pumpCommand: "off",
    }),
    machineProfiles: cloneProfileSet(previewProfileSet),
    mobileProfiles: cloneProfileSet(previewProfileSet),
    notice: null,
    selected: { kind: "manual" },
  };
}

export function profilesAreSynchronized(state: ExtractionPreviewState): boolean {
  return profileSetsEqual(state.mobileProfiles, state.machineProfiles);
}

export function selectedProfile(
  state: ExtractionPreviewState,
): ExtractionProfile | null {
  if (state.selected.kind === "manual") {
    return null;
  }
  const profileId = state.selected.profileId;
  return (
    state.mobileProfiles.profiles.find(
      (slot) => slot.id === profileId,
    )?.profile ?? null
  );
}

export function canStartPreview(state: ExtractionPreviewState): boolean {
  if (state.extraction.status === "running") {
    return false;
  }
  if (state.selected.kind === "manual") {
    return true;
  }
  return selectedProfile(state) !== null && profilesAreSynchronized(state);
}

export function selectPreview(
  state: ExtractionPreviewState,
  selected: ExtractionSelection,
): ExtractionPreviewState {
  return state.extraction.status === "running"
    ? state
    : { ...state, notice: null, selected };
}

export function saveMobileProfile(
  state: ExtractionPreviewState,
  profileId: ProfileSlotId,
  profile: ExtractionProfile | null,
): ExtractionPreviewState {
  if (state.extraction.status === "running") {
    return state;
  }
  const parsedProfile =
    profile === null ? null : ExtractionProfileSchema.parse(profile);
  const candidate: ProfileSet = {
    profiles: state.mobileProfiles.profiles.map((slot) =>
      slot.id === profileId ? { ...slot, profile: parsedProfile } : slot,
    ) as ProfileSet["profiles"],
  };

  return {
    ...state,
    mobileProfiles: ProfileSetSchema.parse(candidate),
    notice: null,
  };
}

export function exportProfilesPreview(
  state: ExtractionPreviewState,
): ExtractionPreviewState {
  if (state.extraction.status === "running") {
    return { ...state, notice: "export-blocked" };
  }
  return {
    ...state,
    machineProfiles: cloneProfileSet(state.mobileProfiles),
    notice: "exported",
  };
}

export function createPreviewStartRequest(
  state: ExtractionPreviewState,
): StartExtractionRequest {
  return StartExtractionRequestSchema.parse({
    idempotencyKey: "preview-start-0001",
    selection: state.selected,
  });
}

export function startExtractionPreview(
  state: ExtractionPreviewState,
  request = createPreviewStartRequest(state),
): ExtractionPreviewState {
  const parsed = StartExtractionRequestSchema.parse(request);
  if (!canStartPreview(state) || !sameSelection(parsed.selection, state.selected)) {
    return state;
  }

  const extraction = runningStateForSelection(state, parsed.selection);
  return { ...state, extraction, notice: "started" };
}

export function stopExtractionPreview(
  state: ExtractionPreviewState,
): ExtractionPreviewState {
  return {
    ...state,
    extraction: IdleExtractionStateSchema.parse({
      status: "idle",
      extractionId: null,
      selection: null,
      phase: "idle",
      elapsedMs: 0,
      remainingMs: null,
      pumpCommand: "off",
    }),
    notice: "stopped",
  };
}

export function advanceExtractionPreview(
  state: ExtractionPreviewState,
): ExtractionPreviewState {
  if (state.extraction.status === "idle") {
    return state;
  }
  if (state.extraction.selection.kind === "manual") {
    if (state.extraction.elapsedMs === 0) {
      return {
        ...state,
        extraction: {
          ...state.extraction,
          elapsedMs: 30_000,
          remainingMs: 30_000,
        },
      };
    }
    return stopExtractionPreview(state);
  }

  const profile = profileForSelection(
    state.machineProfiles,
    state.extraction.selection,
  );
  if (profile === null) {
    return stopExtractionPreview(state);
  }
  const totalMs = profileDurationMs(profile);
  const extractionBase = {
    status: "running" as const,
    extractionId: state.extraction.extractionId,
    selection: state.extraction.selection,
  };

  if (state.extraction.phase === "pre-infusion") {
    const elapsedMs = profile.preInfusionSeconds * 1_000;
    if (profile.soakSeconds > 0) {
      return {
        ...state,
        extraction: {
          ...extractionBase,
          phase: "soak",
          elapsedMs,
          remainingMs: totalMs - elapsedMs,
          pumpCommand: "off",
        },
      };
    }
    return {
      ...state,
      extraction: mainExtractionState(extractionBase, profile, totalMs),
    };
  }
  if (state.extraction.phase === "soak") {
    return {
      ...state,
      extraction: mainExtractionState(extractionBase, profile, totalMs),
    };
  }
  return stopExtractionPreview(state);
}

export function profileDurationSeconds(profile: ExtractionProfile): number {
  return (
    profile.preInfusionSeconds +
    profile.soakSeconds +
    profile.mainExtractionSeconds
  );
}

function runningStateForSelection(
  state: ExtractionPreviewState,
  selection: ExtractionSelection,
): RunningExtractionState {
  if (selection.kind === "manual") {
    return {
      status: "running",
      extractionId: "preview-run-1",
      selection,
      phase: "manual",
      elapsedMs: 0,
      remainingMs: EXTRACTION_MAX_DURATION_MS,
      pumpCommand: "running",
    };
  }

  const profile = profileForSelection(state.machineProfiles, selection);
  if (profile === null) {
    throw new Error("A configured synchronized profile is required to start.");
  }
  const totalMs = profileDurationMs(profile);
  if (profile.preInfusionSeconds > 0) {
    return {
      status: "running",
      extractionId: "preview-run-1",
      selection,
      phase: "pre-infusion",
      elapsedMs: 0,
      remainingMs: totalMs,
      pumpCommand: "running",
    };
  }
  return {
    status: "running",
    extractionId: "preview-run-1",
    selection,
    phase: "main-extraction",
    elapsedMs: 0,
    remainingMs: totalMs,
    pumpCommand: "running",
  };
}

function mainExtractionState(
  extractionBase: Pick<
    RunningExtractionState,
    "status" | "extractionId" | "selection"
  > & { selection: { kind: "profile"; profileId: ProfileSlotId } },
  profile: ExtractionProfile,
  totalMs: number,
): RunningExtractionState {
  const elapsedMs =
    (profile.preInfusionSeconds + profile.soakSeconds) * 1_000;
  return {
    ...extractionBase,
    phase: "main-extraction",
    elapsedMs,
    remainingMs: totalMs - elapsedMs,
    pumpCommand: "running",
  };
}

function profileForSelection(
  profiles: ProfileSet,
  selection: { kind: "profile"; profileId: ProfileSlotId },
): ExtractionProfile | null {
  return (
    profiles.profiles.find((slot) => slot.id === selection.profileId)?.profile ??
    null
  );
}

function profileDurationMs(profile: ExtractionProfile): number {
  return profileDurationSeconds(profile) * 1_000;
}

function sameSelection(
  left: ExtractionSelection,
  right: ExtractionSelection,
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === "manual" ||
      (right.kind === "profile" && left.profileId === right.profileId))
  );
}
