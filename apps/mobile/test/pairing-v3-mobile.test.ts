import { describe, expect, it } from "bun:test";

import {
  authenticateAndSave,
  inspectDevice,
  restoreSelectedDevice,
  type PairingClientFactory,
  type PairingDeviceClient,
} from "../src/pairing/pairing-service";
import { ApiClientError } from "../src/networking/api-client-error";
import {
  createDebugDeviceApiClient,
  debugDeviceIdentity,
  debugSelectedDevice,
} from "../src/networking/debug-device-api-client";
import {
  createDebugPairingClient,
  DEBUG_PAIRING_CODE,
} from "../src/pairing/debug-pairing-dependencies";
import { SelectedDeviceRepository } from "../src/storage/selected-device-repository";

describe("mobile v3 SRP pairing", () => {
  it("pairs once and stores only the remembered reconnect credential", async () => {
    const store = memoryStore();
    const repository = new SelectedDeviceRepository(store);
    const candidate = {
      ...debugDeviceIdentity,
      address: debugSelectedDevice.httpsOrigin,
      identitySource: "discovery" as const,
    };
    const selected = await authenticateAndSave(candidate, "1234 5678", {
      createClient: createDebugPairingClient,
      repository,
    });
    expect(selected.deviceId).toBe(debugDeviceIdentity.deviceId);
    expect(await repository.load()).toEqual(selected);
    const persisted = JSON.parse(store.value!);
    expect(Object.keys(persisted).sort()).toEqual([
      "accessToken",
      "certificateSpkiSha256",
      "clientId",
      "deviceId",
      "httpsOrigin",
    ]);
    expect(store.value).not.toContain(DEBUG_PAIRING_CODE);
  });

  it("accepts a manual origin without trusting identity before SRP", async () => {
    const candidate = await inspectDevice(
      "192.168.1.20",
      createDebugPairingClient,
    );
    expect(candidate).toEqual(expect.objectContaining({
      address: "https://192.168.1.20",
      deviceId: "unverified",
      identitySource: "manual",
    }));
  });

  it("rejects a malformed code before opening a session", async () => {
    const repository = new SelectedDeviceRepository(memoryStore());
    await expect(authenticateAndSave(candidate(), "123", {
      createClient: () => {
        throw new Error("Client must not be created for malformed input.");
      },
      repository,
    })).rejects.toEqual(expect.objectContaining({
      code: "invalid_pairing_code_format",
      stage: "srp-start",
    }));
  });

  it("preserves the first SRP failure when native cleanup also fails", async () => {
    const repository = new SelectedDeviceRepository(memoryStore());
    await expect(authenticateAndSave(candidate(), DEBUG_PAIRING_CODE, {
      createClient: (input) => {
        const client = createDebugPairingClient(input);
        return {
          ...client,
          async srpStart() {
            throw new Error("The installed native client has no SRP implementation.");
          },
          srpDestroy() {
            throw new Error("The installed native client has no SRP cleanup.");
          },
        };
      },
      repository,
    })).rejects.toEqual(expect.objectContaining({
      code: "srp_start_failed",
      stage: "srp-start",
    }));
  });

  it("allows wrong-code retry without changing the remembered machine", async () => {
    const repository = new SelectedDeviceRepository(memoryStore());
    await expect(authenticateAndSave(candidate(), "00000000", {
      createClient: createDebugPairingClient,
      repository,
    })).rejects.toEqual(expect.objectContaining({
      code: "invalid_pairing_code",
      stage: "client-proof",
    }));
    expect(await repository.load()).toBeNull();
  });

  it("reconnects after app or ESP32 restart without asking for the code", async () => {
    const repository = new SelectedDeviceRepository(memoryStore());
    await repository.save(debugSelectedDevice);
    let inspectedCredentials: unknown = null;
    const result = await restoreSelectedDevice({
      createClient: reconnectFactory(async (credentials) => {
        inspectedCredentials = credentials;
        return createDebugDeviceApiClient().getState();
      }),
      findDeviceById: async () => {
        throw new Error("Reconnect must not rediscover a reachable machine.");
      },
      repository,
    });
    expect(result.status).toBe("connected");
    expect(inspectedCredentials).toEqual({
      accessToken: debugSelectedDevice.accessToken,
      certificatePin: debugSelectedDevice.certificateSpkiSha256,
    });
  });

  it("keeps the remembered machine selected after token revocation", async () => {
    const repository = new SelectedDeviceRepository(memoryStore());
    await repository.save(debugSelectedDevice);
    const result = await restoreSelectedDevice({
      createClient: reconnectFactory(async () => {
        throw new ApiClientError("unauthorized", "Token revoked.", { status: 401 });
      }),
      findDeviceById: async () => {
        throw new Error("A revoked token must not force rediscovery.");
      },
      repository,
    });
    expect(result).toEqual(expect.objectContaining({
      candidate: expect.objectContaining({
        deviceId: debugSelectedDevice.deviceId,
        identitySource: "remembered",
      }),
      status: "pairing-required",
    }));
    expect(await repository.load()).toEqual(debugSelectedDevice);
  });

  it("requests the code again after a certificate reset", async () => {
    const repository = new SelectedDeviceRepository(memoryStore());
    await repository.save(debugSelectedDevice);
    const result = await restoreSelectedDevice({
      createClient: reconnectFactory(async () => {
        throw new ApiClientError(
          "certificate-changed",
          "Certificate reset.",
        );
      }),
      findDeviceById: async () => {
        throw new Error("A certificate reset must not force rediscovery.");
      },
      repository,
    });
    expect(result.status).toBe("pairing-required");
  });

  it("reports SecureStore failure as the secure-save stage", async () => {
    const repository = new SelectedDeviceRepository({
      async deleteItemAsync() {},
      async getItemAsync() { return null; },
      async setItemAsync() { throw new Error("SecureStore unavailable"); },
    });
    await expect(authenticateAndSave(candidate(), DEBUG_PAIRING_CODE, {
      createClient: createDebugPairingClient,
      repository,
    })).rejects.toEqual(expect.objectContaining({
      code: "secure_store_failed",
      stage: "secure-save",
    }));
  });
});

function candidate() {
  return {
    ...debugDeviceIdentity,
    address: debugSelectedDevice.httpsOrigin,
    identitySource: "discovery" as const,
  };
}

function reconnectFactory(
  getState: PairingDeviceClient["getState"],
): PairingClientFactory {
  return () => ({
    ...unreachablePairingMethods(),
    getState,
  });
}

function unreachablePairingMethods(): Omit<PairingDeviceClient, "getState"> {
  const unreachable = async (): Promise<never> => {
    throw new Error("Reconnect must not start SRP pairing.");
  };
  return {
    completeSession: unreachable,
    secureRandom: unreachable,
    srpDecrypt: unreachable,
    srpDestroy() {},
    srpEncrypt: unreachable,
    srpProcessChallenge: unreachable,
    srpStart: unreachable,
    srpVerifyServer: unreachable,
    startSession: unreachable,
    submitProof: unreachable,
  };
}

function memoryStore() {
  return {
    value: null as string | null,
    async deleteItemAsync() { this.value = null; },
    async getItemAsync() { return this.value; },
    async setItemAsync(_key: string, value: string) { this.value = value; },
  };
}
