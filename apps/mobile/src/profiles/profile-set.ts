import { ProfileSetSchema, type ProfileSet } from "@philcoino/protocol";

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
