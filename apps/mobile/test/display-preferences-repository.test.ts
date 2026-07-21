import { describe, expect, test } from "bun:test";

import {
  DisplayPreferencesRepository,
  type DisplayPreferencesStore,
} from "../src/storage/display-preferences-repository";

describe("display preferences repository", () => {
  test("defaults keep-awake to off without writing storage", async () => {
    const store = new MemoryDisplayPreferencesStore();
    const repository = new DisplayPreferencesRepository(store);

    await expect(repository.load()).resolves.toEqual({
      keepScreenAwake: false,
    });
    expect(store.value).toBeNull();
  });

  test("persists and restores the strict app-level preference", async () => {
    const store = new MemoryDisplayPreferencesStore();
    const repository = new DisplayPreferencesRepository(store);

    await repository.save({ keepScreenAwake: true });

    await expect(repository.load()).resolves.toEqual({
      keepScreenAwake: true,
    });
  });

  test("rejects malformed, extra-field, and invalid save values", async () => {
    const malformed = new MemoryDisplayPreferencesStore("not-json");
    await expect(
      new DisplayPreferencesRepository(malformed).load(),
    ).rejects.toThrow("stored display preferences");

    const extra = new MemoryDisplayPreferencesStore(
      JSON.stringify({ keepScreenAwake: true, deviceId: "machine" }),
    );
    await expect(
      new DisplayPreferencesRepository(extra).load(),
    ).rejects.toThrow("stored display preferences");

    const repository = new DisplayPreferencesRepository(
      new MemoryDisplayPreferencesStore(),
    );
    await expect(
      repository.save({ keepScreenAwake: "yes" } as never),
    ).rejects.toThrow("display preferences");
  });
});

class MemoryDisplayPreferencesStore implements DisplayPreferencesStore {
  constructor(public value: string | null = null) {}

  getItem(): string | null {
    return this.value;
  }

  setItem(_key: string, value: string): void {
    this.value = value;
  }
}
