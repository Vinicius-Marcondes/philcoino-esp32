import { describe, expect, test } from "bun:test";

import {
  SelectedDeviceRepository,
  type SecureKeyValueStore,
} from "../src/storage/selected-device-repository";

const selectedDevice = {
  deviceId: "philcoino-c3-a1b2c3",
  lastSuccessfulAddress: "192.168.1.20",
  token: "secret-token",
};

describe("SelectedDeviceRepository", () => {
  test("persists and restores one device through secure storage", async () => {
    const store = new MemorySecureStore();
    const repository = new SelectedDeviceRepository(store);

    await repository.save(selectedDevice);

    await expect(repository.load()).resolves.toEqual({
      ...selectedDevice,
      lastSuccessfulAddress: "http://192.168.1.20",
    });
    expect(store.keys()).toEqual(["philcoino.selected-device.v1"]);
  });

  test("clears the selected device", async () => {
    const store = new MemorySecureStore();
    const repository = new SelectedDeviceRepository(store);
    await repository.save(selectedDevice);

    await repository.clear();

    await expect(repository.load()).resolves.toBeNull();
  });

  test("rejects malformed secure-storage data", async () => {
    const store = new MemorySecureStore();
    store.seed(
      "philcoino.selected-device.v1",
      JSON.stringify({ ...selectedDevice, tokenCopy: selectedDevice.token }),
    );
    const repository = new SelectedDeviceRepository(store);

    await expect(repository.load()).rejects.toThrow("unexpected fields");
  });

  test("rejects invalid identities and non-HTTP addresses before saving", async () => {
    const repository = new SelectedDeviceRepository(new MemorySecureStore());

    await expect(
      repository.save({ ...selectedDevice, deviceId: "invalid device id" }),
    ).rejects.toThrow("device ID");
    await expect(
      repository.save({
        ...selectedDevice,
        lastSuccessfulAddress: "https://example.com",
      }),
    ).rejects.toThrow("local HTTP origin");
  });
});

class MemorySecureStore implements SecureKeyValueStore {
  private readonly values = new Map<string, string>();

  async deleteItemAsync(key: string): Promise<void> {
    this.values.delete(key);
  }

  async getItemAsync(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  keys(): string[] {
    return [...this.values.keys()];
  }

  seed(key: string, value: string): void {
    this.values.set(key, value);
  }
}
