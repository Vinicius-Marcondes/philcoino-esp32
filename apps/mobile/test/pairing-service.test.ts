import { describe, expect, test } from "bun:test";

import {
  createSimulator,
  DEFAULT_SIMULATOR_TOKEN,
} from "../../../tools/device-simulator/src/app.ts";
import { ApiClientError } from "../src/networking/api-client-error";
import { DeviceApiClient, type FetchImplementation } from "../src/networking/device-api-client";
import {
  authenticateAndSave,
  inspectDevice,
  restoreSelectedDevice,
  type PairingClientFactory,
} from "../src/pairing/pairing-service";
import {
  SelectedDeviceRepository,
  type SecureKeyValueStore,
} from "../src/storage/selected-device-repository";

const simulatorAddress = "http://127.0.0.1:3000";

describe("pairing flow with the device simulator", () => {
  test("manual address shows identity and saves only after valid authentication", async () => {
    const simulator = createSimulator();
    const repository = new SelectedDeviceRepository(new MemorySecureStore());
    const createClient = simulatorClientFactory(simulator.app.request.bind(simulator.app));

    const candidate = await inspectDevice("127.0.0.1:3000", createClient);
    expect(candidate).toMatchObject({
      address: simulatorAddress,
      apiVersion: "1",
      deviceId: "philcoino-simulator",
      firmwareVersion: "simulator-0.1.0",
      model: "philcoino-simulator",
      name: "Philcoino simulator",
    });

    const invalid = authenticateAndSave(
      candidate,
      "wrong-token",
      { createClient, repository },
    );
    await expect(invalid).rejects.toBeInstanceOf(ApiClientError);
    await expect(repository.load()).resolves.toBeNull();

    await authenticateAndSave(candidate, DEFAULT_SIMULATOR_TOKEN, {
      createClient,
      repository,
    });
    await expect(repository.load()).resolves.toEqual({
      deviceId: "philcoino-simulator",
      lastSuccessfulAddress: simulatorAddress,
      token: DEFAULT_SIMULATOR_TOKEN,
    });
  });

  test("uses the cached address before attempting stable-ID discovery", async () => {
    const simulator = createSimulator();
    const repository = new SelectedDeviceRepository(new MemorySecureStore());
    await repository.save({
      deviceId: "philcoino-simulator",
      lastSuccessfulAddress: simulatorAddress,
      token: DEFAULT_SIMULATOR_TOKEN,
    });
    let discoveryCalled = false;

    const result = await restoreSelectedDevice({
      createClient: simulatorClientFactory(simulator.app.request.bind(simulator.app)),
      findDeviceById: async () => {
        discoveryCalled = true;
        return null;
      },
      repository,
    });

    expect(result).toMatchObject({ status: "connected", recoveredAddress: false });
    expect(discoveryCalled).toBe(false);
  });

  test("rediscovers the stable ID and persists its authenticated new address", async () => {
    const simulator = createSimulator();
    const repository = new SelectedDeviceRepository(new MemorySecureStore());
    await repository.save({
      deviceId: "philcoino-simulator",
      lastSuccessfulAddress: "http://192.168.1.20",
      token: DEFAULT_SIMULATOR_TOKEN,
    });
    const simulatorFactory = simulatorClientFactory(
      simulator.app.request.bind(simulator.app),
    );
    const createClient: PairingClientFactory = (options) =>
      options.address === "http://192.168.1.20"
        ? new DeviceApiClient({
            ...options,
            fetch: async () => {
              throw new Error("old address is offline");
            },
          })
        : simulatorFactory(options);

    const result = await restoreSelectedDevice({
      createClient,
      findDeviceById: async (deviceId) => ({
        address: simulatorAddress,
        apiVersion: "1",
        deviceId,
        firmwareVersion: "simulator-0.1.0",
        model: "philcoino-simulator",
        name: "Philcoino simulator",
      }),
      repository,
    });

    expect(result).toMatchObject({ status: "connected", recoveredAddress: true });
    await expect(repository.load()).resolves.toEqual({
      deviceId: "philcoino-simulator",
      lastSuccessfulAddress: simulatorAddress,
      token: DEFAULT_SIMULATOR_TOKEN,
    });
  });

  test("does not save a rediscovered address whose API reports a different ID", async () => {
    const otherDevice = createSimulator({
      device: { deviceId: "philcoino-other" },
    });
    const repository = new SelectedDeviceRepository(new MemorySecureStore());
    const original = {
      deviceId: "philcoino-simulator",
      lastSuccessfulAddress: "http://192.168.1.20",
      token: DEFAULT_SIMULATOR_TOKEN,
    };
    await repository.save(original);
    const otherFactory = simulatorClientFactory(
      otherDevice.app.request.bind(otherDevice.app),
    );
    const createClient: PairingClientFactory = (options) =>
      options.address === original.lastSuccessfulAddress
        ? new DeviceApiClient({
            ...options,
            fetch: async () => {
              throw new Error("old address is offline");
            },
          })
        : otherFactory(options);

    const result = await restoreSelectedDevice({
      createClient,
      findDeviceById: async () => ({
        address: simulatorAddress,
        apiVersion: "1",
        deviceId: original.deviceId,
        firmwareVersion: "spoofed",
        model: "spoofed",
        name: "Spoofed discovery record",
      }),
      repository,
    });

    expect(result.status).toBe("not-found");
    await expect(repository.load()).resolves.toEqual(original);
  });
});

function simulatorClientFactory(
  request: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Response | Promise<Response>,
): PairingClientFactory {
  const fetch: FetchImplementation = (url, init) =>
    Promise.resolve(
      request(url, {
        body: init.body,
        headers: init.headers,
        method: init.method,
        signal: init.signal,
      }),
    );

  return (options) => new DeviceApiClient({ ...options, fetch });
}

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
}
