import { describe, expect, test } from "bun:test";

import {
  authenticateAndSave,
  inspectDevice,
} from "../src/pairing/pairing-service";
import {
  createDebugPairingClient,
  DEBUG_PAIRING_TOKEN,
  debugDeviceDiscovery,
  debugDiscoveredDevice,
  debugSelectedDeviceRepository,
} from "../src/pairing/debug-pairing-dependencies";
import { ApiClientError } from "../src/networking/api-client-error";

describe("debug pairing dependencies", () => {
  test("discovers the debug machine and stops cleanly", async () => {
    const device = await new Promise((resolve) => {
      const stop = debugDeviceDiscovery.scan({
        onDevice: (found) => {
          stop();
          resolve(found);
        },
        onError: () => {},
      });
    });

    expect(device).toEqual(debugDiscoveredDevice);
  });

  test("inspects the public debug identity", async () => {
    await expect(
      inspectDevice(debugDiscoveredDevice.address, createDebugPairingClient),
    ).resolves.toEqual(debugDiscoveredDevice);
  });

  test("accepts only the documented debug token without persisting it", async () => {
    await expect(
      authenticateAndSave(
        debugDiscoveredDevice,
        DEBUG_PAIRING_TOKEN,
        {
          createClient: createDebugPairingClient,
          repository: debugSelectedDeviceRepository,
        },
      ),
    ).resolves.toEqual({
      deviceId: debugDiscoveredDevice.deviceId,
      lastSuccessfulAddress: debugDiscoveredDevice.address,
      token: DEBUG_PAIRING_TOKEN,
    });
    await expect(debugSelectedDeviceRepository.load()).resolves.toBeNull();
  });

  test("rejects an incorrect debug token", async () => {
    const error = await captureError(
      authenticateAndSave(debugDiscoveredDevice, "wrong-token", {
        createClient: createDebugPairingClient,
        repository: debugSelectedDeviceRepository,
      }),
    );

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).kind).toBe("unauthorized");
  });
});

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}
