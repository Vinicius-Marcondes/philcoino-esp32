import { describe, expect, test } from "bun:test";

import { DEFAULT_MOBILE_PROFILE_SET } from "../src/profiles/profile-set";
import {
  MobileProfileRepository,
  type ProfileKeyValueStore,
} from "../src/storage/mobile-profile-repository";

describe("MobileProfileRepository", () => {
  test("seeds exactly once and restores edits across repository instances", async () => {
    const store = new MemoryProfileStore();
    const first = new MobileProfileRepository(store);
    const seeded = await first.load();

    expect(seeded).toEqual(DEFAULT_MOBILE_PROFILE_SET);
    expect(store.writes).toBe(1);

    const edited = {
      ...seeded,
      profiles: [
        {
          ...seeded.profiles[0],
          profile: {
            name: "Short20",
            preInfusionSeconds: 0,
            soakSeconds: 0,
            mainExtractionSeconds: 20,
          },
        },
        seeded.profiles[1],
        seeded.profiles[2],
        seeded.profiles[3],
      ] as typeof seeded.profiles,
    };
    await first.save(edited);

    const restored = await new MobileProfileRepository(store).load();
    expect(restored).toEqual(edited);
    expect(store.writes).toBe(2);
  });

  test("rejects corrupt JSON and strict-schema violations without reseeding", async () => {
    const corrupt = new MemoryProfileStore("{");
    await expect(new MobileProfileRepository(corrupt).load()).rejects.toThrow(
      "invalid",
    );
    expect(corrupt.writes).toBe(0);

    const extra = new MemoryProfileStore(
      JSON.stringify({ ...DEFAULT_MOBILE_PROFILE_SET, unexpected: true }),
    );
    await expect(new MobileProfileRepository(extra).load()).rejects.toThrow(
      "invalid",
    );
    expect(extra.writes).toBe(0);
  });

  test("does not publish a profile set when persistence fails", async () => {
    const store = new MemoryProfileStore();
    const repository = new MobileProfileRepository(store);
    const seeded = await repository.load();
    store.failWrites = true;

    await expect(repository.save({ ...seeded })).rejects.toThrow("write failed");
    store.failWrites = false;
    await expect(repository.load()).resolves.toEqual(seeded);
  });
});

class MemoryProfileStore implements ProfileKeyValueStore {
  failWrites = false;
  writes = 0;

  constructor(private value: string | null = null) {}

  async getItemAsync(): Promise<string | null> {
    return this.value;
  }

  async setItemAsync(_key: string, value: string): Promise<void> {
    if (this.failWrites) {
      throw new Error("write failed");
    }
    this.writes += 1;
    this.value = value;
  }
}
