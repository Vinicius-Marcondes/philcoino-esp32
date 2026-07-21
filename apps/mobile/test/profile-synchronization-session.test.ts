import { describe, expect, test } from "bun:test";
import type { ProfileSet } from "@philcoino/protocol";

import {
  ProfileSynchronizationSession,
} from "../src/profiles/profile-synchronization-session";
import {
  MobileProfileRepository,
  type ProfileKeyValueStore,
} from "../src/storage/mobile-profile-repository";
import { DEFAULT_MOBILE_PROFILE_SET } from "../src/profiles/profile-set";
import { editedProfiles } from "./profile-import.test";

describe("ProfileSynchronizationSession", () => {
  test("keeps local profiles and recovers a failed machine read without remounting", async () => {
    let machineRead = 0;
    const harness = createHarness(async () => {
      machineRead += 1;
      if (machineRead === 1) {
        throw new Error("offline");
      }
      return editedProfiles("Machine20", 20);
    });

    harness.session.start();
    await waitFor(() => harness.mobileProfiles.length === 1 && harness.machineErrors.at(-1) === true);

    expect(harness.mobileProfiles.at(-1)).toEqual(DEFAULT_MOBILE_PROFILE_SET);
    expect(harness.machineProfiles).toHaveLength(0);

    await harness.session.refreshMachineProfiles();
    expect(harness.machineProfiles.at(-1)?.profiles[0].profile?.name).toBe(
      "Machine20",
    );
    expect(harness.machineErrors.at(-1)).toBe(false);
  });

  test("reads fresh machine profiles, reviews changes, and persists the complete import", async () => {
    const machine = editedProfiles("Machine20", 20);
    let reads = 0;
    const harness = createHarness(async () => {
      reads += 1;
      return machine;
    });
    harness.session.start();
    await waitFor(() => harness.machineProfiles.length === 1 && harness.mobileProfiles.length === 1);

    await harness.session.requestImport();
    expect(reads).toBe(2);
    expect(harness.importStates.at(-1)?.status).toBe("reviewing");
    expect(harness.importStates.at(-1)?.changes.map((change) => change.id)).toEqual([
      "profile-1",
    ]);

    await expect(harness.session.confirmImport()).resolves.toBe(true);
    expect(harness.importStates.at(-1)).toMatchObject({
      outcome: "imported",
      status: "acknowledged",
    });
    expect(harness.mobileProfiles.at(-1)).toEqual(machine);
    expect(JSON.parse(harness.store.value!)).toEqual(machine);
  });

  test("reports a fresh match without writing local storage", async () => {
    const harness = createHarness(async () => DEFAULT_MOBILE_PROFILE_SET);
    harness.session.start();
    await waitFor(() => harness.machineProfiles.length === 1 && harness.mobileProfiles.length === 1);
    const writesBeforeImport = harness.store.writes;

    await harness.session.requestImport();

    expect(harness.importStates.at(-1)).toMatchObject({
      outcome: "already-matches",
      status: "acknowledged",
    });
    expect(harness.store.writes).toBe(writesBeforeImport);
  });

  test("serializes rapid local writes and publishes only the latest requested set", async () => {
    const store = new DeferredProfileStore(DEFAULT_MOBILE_PROFILE_SET);
    const harness = createHarness(
      async () => DEFAULT_MOBILE_PROFILE_SET,
      store,
    );
    harness.session.start();
    await waitFor(() => harness.mobileProfiles.length === 1);
    const first = editedProfiles("First20", 20);
    const second = editedProfiles("Second25", 25);

    const firstSave = harness.session.saveLocalProfiles(first);
    const secondSave = harness.session.saveLocalProfiles(second);
    await waitFor(() => store.pending.length === 1);
    expect(store.startedValues).toEqual([first]);

    store.resolveNext();
    await waitFor(() => store.pending.length === 1 && store.startedValues.length === 2);
    expect(harness.mobileProfiles.at(-1)).toEqual(DEFAULT_MOBILE_PROFILE_SET);

    store.resolveNext();
    await expect(Promise.all([firstSave, secondSave])).resolves.toEqual([
      true,
      true,
    ]);
    expect(store.startedValues).toEqual([first, second]);
    expect(harness.mobileProfiles.at(-1)).toEqual(second);
    expect(JSON.parse(store.value!)).toEqual(second);
  });

  test("invalidates an import review when local profiles change", async () => {
    const machine = editedProfiles("Machine20", 20);
    const harness = createHarness(async () => machine);
    harness.session.start();
    await waitFor(() => harness.machineProfiles.length === 1 && harness.mobileProfiles.length === 1);
    await harness.session.requestImport();
    expect(harness.importStates.at(-1)?.status).toBe("reviewing");

    await harness.session.saveLocalProfiles(editedProfiles("Local25", 25));

    await expect(harness.session.confirmImport()).resolves.toBe(false);
    expect(harness.importStates.at(-1)).toMatchObject({
      outcome: "stale-review",
      status: "rejected",
    });
    expect(harness.mobileProfiles.at(-1)?.profiles[0].profile?.name).toBe(
      "Local25",
    );
  });

  test("preserves local profiles after an import save failure and allows retry", async () => {
    const machine = editedProfiles("Machine20", 20);
    const harness = createHarness(async () => machine);
    harness.session.start();
    await waitFor(() => harness.machineProfiles.length === 1 && harness.mobileProfiles.length === 1);
    await harness.session.requestImport();
    harness.store.failNextWrite = true;

    await expect(harness.session.confirmImport()).resolves.toBe(false);
    expect(harness.importStates.at(-1)).toMatchObject({
      outcome: "save-failed",
      status: "rejected",
    });
    expect(harness.importStates.at(-1)?.changes).toHaveLength(1);
    expect(harness.mobileProfiles.at(-1)).toEqual(DEFAULT_MOBILE_PROFILE_SET);
    expect(JSON.parse(harness.store.value!)).toEqual(DEFAULT_MOBILE_PROFILE_SET);

    await expect(harness.session.confirmImport()).resolves.toBe(true);
    expect(harness.mobileProfiles.at(-1)).toEqual(machine);
  });
});

function createHarness(
  getProfiles: () => Promise<ProfileSet>,
  store: MemoryProfileStore = new MemoryProfileStore(DEFAULT_MOBILE_PROFILE_SET),
) {
  const importStates: Parameters<
    ConstructorParameters<typeof ProfileSynchronizationSession>[0]["onImportStateChange"]
  >[0][] = [];
  const localErrors: boolean[] = [];
  const machineErrors: boolean[] = [];
  const machineProfiles: ProfileSet[] = [];
  const mobileProfiles: ProfileSet[] = [];
  const writePending: boolean[] = [];
  const session = new ProfileSynchronizationSession({
    client: { getProfiles },
    onImportStateChange: (state) => importStates.push(state),
    onLocalErrorChange: (failed) => localErrors.push(failed),
    onMachineErrorChange: (failed) => machineErrors.push(failed),
    onMachineProfilesChange: (profiles) => machineProfiles.push(profiles),
    onMobileProfilesChange: (profiles) => mobileProfiles.push(profiles),
    onWritePendingChange: (pending) => writePending.push(pending),
    repository: new MobileProfileRepository(store),
  });
  return {
    importStates,
    localErrors,
    machineErrors,
    machineProfiles,
    mobileProfiles,
    session,
    store,
    writePending,
  };
}

class MemoryProfileStore implements ProfileKeyValueStore {
  failNextWrite = false;
  value: string | null;
  writes = 0;

  constructor(initial: ProfileSet) {
    this.value = JSON.stringify(initial);
  }

  async getItemAsync(): Promise<string | null> {
    return this.value;
  }

  async setItemAsync(_key: string, value: string): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("write failed");
    }
    this.writes += 1;
    this.value = value;
  }
}

class DeferredProfileStore extends MemoryProfileStore {
  pending: Array<() => void> = [];
  startedValues: ProfileSet[] = [];

  override async setItemAsync(_key: string, value: string): Promise<void> {
    this.startedValues.push(JSON.parse(value));
    await new Promise<void>((resolve) => this.pending.push(resolve));
    this.writes += 1;
    this.value = value;
  }

  resolveNext(): void {
    this.pending.shift()?.();
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition was not met.");
}
