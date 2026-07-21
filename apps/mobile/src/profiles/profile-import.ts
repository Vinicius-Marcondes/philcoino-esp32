import type {
  ExtractionProfile,
  ProfileSet,
  ProfileSlotId,
} from "@philcoino/protocol";

export interface ProfileImportChange {
  id: ProfileSlotId;
  localProfile: ExtractionProfile | null;
  machineProfile: ExtractionProfile | null;
}

export type ProfileImportStatus =
  | "idle"
  | "loading"
  | "reviewing"
  | "saving"
  | "acknowledged"
  | "rejected";

export type ProfileImportOutcome =
  | "already-matches"
  | "imported"
  | "local-unavailable"
  | "machine-read-failed"
  | "save-failed"
  | "stale-review"
  | null;

export interface ProfileImportState {
  changes: ProfileImportChange[];
  outcome: ProfileImportOutcome;
  status: ProfileImportStatus;
}

export const idleProfileImportState: ProfileImportState = {
  changes: [],
  outcome: null,
  status: "idle",
};

export function profileImportChanges(
  localProfiles: ProfileSet,
  machineProfiles: ProfileSet,
): ProfileImportChange[] {
  return localProfiles.profiles.flatMap((localSlot, index) => {
    const machineSlot = machineProfiles.profiles[index];
    if (JSON.stringify(localSlot.profile) === JSON.stringify(machineSlot.profile)) {
      return [];
    }
    return [
      {
        id: localSlot.id,
        localProfile:
          localSlot.profile === null ? null : { ...localSlot.profile },
        machineProfile:
          machineSlot.profile === null ? null : { ...machineSlot.profile },
      },
    ];
  });
}
