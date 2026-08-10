import { describe, expect, test } from "bun:test";
import { MobileProfileSession } from "../src/profiles/mobile-profile-session";
import {
  DEFAULT_MOBILE_PROFILE_SET,
  type ProfileSet,
} from "../src/profiles/profile-set";
import {
  MobileProfileRepository,
  type ProfileKeyValueStore,
} from "../src/storage/mobile-profile-repository";

describe("local profile session", () => {
  test("loads the four local slots without a machine client", async () => {
    const harness = createHarness();
    harness.session.start();
    await waitFor(() => harness.profiles.length === 1);

    expect(harness.profiles[0]).toEqual(DEFAULT_MOBILE_PROFILE_SET);
    expect(harness.errors.at(-1)).toBe(false);
  });

  test("serializes writes and publishes only the newest profile set", async () => {
    const store = new DeferredStore(DEFAULT_MOBILE_PROFILE_SET);
    const harness = createHarness(store);
    harness.session.start();
    await waitFor(() => harness.profiles.length === 1);
    const first = editedProfiles("First", 20);
    const second = editedProfiles("Second", 25);

    const firstSave = harness.session.saveLocalProfiles(first);
    const secondSave = harness.session.saveLocalProfiles(second);
    await waitFor(() => store.pending.length === 1);
    store.resolveNext();
    await waitFor(() => store.pending.length === 1 && store.started.length === 2);
    store.resolveNext();

    await expect(Promise.all([firstSave, secondSave])).resolves.toEqual([true, true]);
    expect(harness.profiles.at(-1)).toEqual(second);
    expect(JSON.parse(store.value!)).toEqual(second);
    expect(harness.pending.at(-1)).toBe(false);
  });

  test("restores the last persisted profiles after a local write failure", async () => {
    const store = new MemoryStore(DEFAULT_MOBILE_PROFILE_SET);
    const harness = createHarness(store);
    harness.session.start();
    await waitFor(() => harness.profiles.length === 1);
    store.failNextWrite = true;

    await expect(harness.session.saveLocalProfiles(editedProfiles("Broken", 30)))
      .resolves.toBe(false);

    expect(harness.profiles.at(-1)).toEqual(DEFAULT_MOBILE_PROFILE_SET);
    expect(harness.errors.at(-1)).toBe(true);
  });
});

function createHarness(
  store: MemoryStore = new MemoryStore(DEFAULT_MOBILE_PROFILE_SET),
) {
  const errors: boolean[] = [];
  const pending: boolean[] = [];
  const profiles: ProfileSet[] = [];
  const session = new MobileProfileSession({
    onLocalErrorChange: (failed) => errors.push(failed),
    onMobileProfilesChange: (value) => profiles.push(value),
    onWritePendingChange: (value) => pending.push(value),
    repository: new MobileProfileRepository(store),
  });
  return { errors, pending, profiles, session };
}

class MemoryStore implements ProfileKeyValueStore {
  failNextWrite = false;
  value: string | null;

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
    this.value = value;
  }
}

class DeferredStore extends MemoryStore {
  pending: Array<() => void> = [];
  started: ProfileSet[] = [];

  override async setItemAsync(_key: string, value: string): Promise<void> {
    this.started.push(JSON.parse(value));
    await new Promise<void>((resolve) => this.pending.push(resolve));
    this.value = value;
  }

  resolveNext(): void {
    this.pending.shift()?.();
  }
}

function editedProfiles(name: string, mainExtractionSeconds: number): ProfileSet {
  return {
    profiles: DEFAULT_MOBILE_PROFILE_SET.profiles.map((slot, index) =>
      index === 0
        ? {
            ...slot,
            profile: slot.profile === null
              ? null
              : { ...slot.profile, name, mainExtractionSeconds },
          }
        : slot,
    ) as ProfileSet["profiles"],
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition not reached");
}
