import { describe, expect, test } from "bun:test";
import type { ProfileSet } from "@philcoino/protocol";

import {
  profileImportChanges,
} from "../src/profiles/profile-import";
import { DEFAULT_MOBILE_PROFILE_SET } from "../src/profiles/profile-set";

describe("profile import comparison", () => {
  test("reports only changed slots with independent profile snapshots", () => {
    const machine = editedProfiles("Machine20", 20);
    const changes = profileImportChanges(DEFAULT_MOBILE_PROFILE_SET, machine);

    expect(changes).toEqual([
      {
        id: "profile-1",
        localProfile: DEFAULT_MOBILE_PROFILE_SET.profiles[0].profile,
        machineProfile: machine.profiles[0].profile,
      },
    ]);

    machine.profiles[0].profile!.name = "Mutated";
    expect(changes[0]?.machineProfile?.name).toBe("Machine20");
  });

  test("includes machine-cleared and machine-created slots", () => {
    const machine: ProfileSet = {
      profiles: [
        { id: "profile-1", profile: null },
        DEFAULT_MOBILE_PROFILE_SET.profiles[1],
        {
          id: "profile-3",
          profile: {
            name: "Machine15",
            preInfusionSeconds: 0,
            soakSeconds: 0,
            mainExtractionSeconds: 15,
          },
        },
        DEFAULT_MOBILE_PROFILE_SET.profiles[3],
      ],
    };

    expect(profileImportChanges(DEFAULT_MOBILE_PROFILE_SET, machine).map(
      (change) => change.id,
    )).toEqual(["profile-1", "profile-3"]);
  });
});

export function editedProfiles(name: string, main: number): ProfileSet {
  return {
    profiles: [
      {
        id: "profile-1",
        profile: {
          name,
          preInfusionSeconds: 0,
          soakSeconds: 0,
          mainExtractionSeconds: main,
        },
      },
      DEFAULT_MOBILE_PROFILE_SET.profiles[1],
      DEFAULT_MOBILE_PROFILE_SET.profiles[2],
      DEFAULT_MOBILE_PROFILE_SET.profiles[3],
    ],
  };
}
