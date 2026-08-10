import {
  ExtractionProfileSchema,
  type ExtractionProfile,
  type ExtractionSelection,
  type ProfileSlotId,
} from "@philcoino/protocol";

interface ProfileSlot<Id extends ProfileSlotId> {
  id: Id;
  profile: ExtractionProfile | null;
}

export interface ProfileSet {
  profiles: [
    ProfileSlot<"profile-1">,
    ProfileSlot<"profile-2">,
    ProfileSlot<"profile-3">,
    ProfileSlot<"profile-4">,
  ];
}

export const ProfileSetSchema = {
  parse(value: unknown): ProfileSet {
    const parsed = this.safeParse(value);
    if (!parsed.success) throw new TypeError("Invalid local profile set.");
    return parsed.data;
  },
  safeParse(value: unknown):
    | { success: true; data: ProfileSet }
    | { success: false; error: TypeError } {
    if (!isRecord(value) || !hasOnlyKeys(value, ["profiles"])) {
      return invalidProfileSet();
    }
    const profiles = value.profiles;
    if (!Array.isArray(profiles) || profiles.length !== 4) {
      return invalidProfileSet();
    }
    for (const [index, expectedId] of PROFILE_IDS.entries()) {
      const slot = profiles[index];
      if (
        !isRecord(slot) ||
        !hasOnlyKeys(slot, ["id", "profile"]) ||
        slot.id !== expectedId ||
        (slot.profile !== null &&
          !ExtractionProfileSchema.safeParse(slot.profile).success)
      ) {
        return invalidProfileSet();
      }
    }
    return { success: true, data: value as unknown as ProfileSet };
  },
};

const PROFILE_IDS = [
  "profile-1",
  "profile-2",
  "profile-3",
  "profile-4",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => key in value);
}

function invalidProfileSet(): { success: false; error: TypeError } {
  return { success: false, error: new TypeError("Invalid local profile set.") };
}

export const DEFAULT_MOBILE_PROFILE_SET: ProfileSet = ProfileSetSchema.parse({
  profiles: [
    {
      id: "profile-1",
      profile: {
        name: "Classic30",
        preInfusionSeconds: 0,
        soakSeconds: 0,
        mainExtractionSeconds: 30,
      },
    },
    {
      id: "profile-2",
      profile: {
        name: "Pre5Soak5",
        preInfusionSeconds: 5,
        soakSeconds: 5,
        mainExtractionSeconds: 25,
      },
    },
    { id: "profile-3", profile: null },
    { id: "profile-4", profile: null },
  ],
});

export function cloneProfileSet(profiles: ProfileSet): ProfileSet {
  return ProfileSetSchema.parse(JSON.parse(JSON.stringify(profiles)));
}

export function profileSetsEqual(
  left: ProfileSet | null,
  right: ProfileSet | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    JSON.stringify(left) === JSON.stringify(right)
  );
}

export function profileSelection(
  profiles: ProfileSet,
  profileId: ProfileSlotId,
): ExtractionSelection {
  const profile = profiles.profiles.find((slot) => slot.id === profileId)?.profile;
  if (profile === null || profile === undefined) {
    throw new TypeError(`Profile ${profileId} is not configured.`);
  }
  return {
    kind: "profile",
    profileId,
    profile: { ...profile },
  };
}
