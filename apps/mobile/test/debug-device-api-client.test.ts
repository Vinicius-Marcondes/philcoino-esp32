import { describe, expect, test } from "bun:test";

import {
  BREW_TARGET_MIN_C,
  MachineStateSchema,
  STEAM_TARGET_MIN_C,
} from "@philcoino/protocol";

import { isDebugDeviceModeEnabled } from "../src/debug-device-mode";
import { ApiClientError } from "../src/networking/api-client-error";
import { createDebugDeviceApiClient } from "../src/networking/debug-device-api-client";

describe("debug device mode", () => {
  test("enables only explicit true-like flag values", () => {
    expect(isDebugDeviceModeEnabled("1")).toBe(true);
    expect(isDebugDeviceModeEnabled("true")).toBe(true);
    expect(isDebugDeviceModeEnabled("TRUE")).toBe(true);
    expect(isDebugDeviceModeEnabled("0")).toBe(false);
    expect(isDebugDeviceModeEnabled(undefined)).toBe(false);
  });

  test("returns protocol-valid default state without a device", async () => {
    const client = createDebugDeviceApiClient();

    await expect(client.getDevice()).resolves.toMatchObject({
      deviceId: "philcoino-debug",
      name: "Philcoino debug",
    });
    await expect(client.getHealth()).resolves.toEqual({
      status: "ok",
      uptimeMs: 0,
    });

    const state = await client.getState();
    expect(MachineStateSchema.safeParse(state).success).toBe(true);
    expect(state).toMatchObject({
      activeMode: "brew",
      brewTargetC: BREW_TARGET_MIN_C,
      boilerTemperatureC: 0,
      heaterEnabled: true,
      heaterActive: false,
      steamTargetC: STEAM_TARGET_MIN_C,
      steamTimeoutRemainingMs: null,
      uptimeMs: 0,
    });
  });

  test("acknowledges dashboard mutations locally", async () => {
    const client = createDebugDeviceApiClient();

    await expect(
      client.updateTemperatureSettings({
        brewTargetC: 94,
        steamTargetC: 116,
      }),
    ).resolves.toEqual({ brewTargetC: 94, steamTargetC: 116 });
    await expect(client.setMode({ mode: "steam" })).resolves.toEqual({
      mode: "steam",
    });
    await expect(
      client.setHeaterEnabled({ heaterEnabled: false }),
    ).resolves.toEqual({
      heaterEnabled: false,
    });

    await expect(client.getState()).resolves.toMatchObject({
      activeMode: "steam",
      brewTargetC: 94,
      boilerTemperatureC: 0,
      heaterEnabled: false,
      steamTargetC: 116,
      steamTimeoutRemainingMs: 0,
      uptimeMs: 0,
    });
  });

  test("validates mutation inputs before local acknowledgement", async () => {
    const client = createDebugDeviceApiClient();

    const invalidTemperature = await captureError(
      client.updateTemperatureSettings({ brewTargetC: 0 } as never),
    );
    const invalidMode = await captureError(
      client.setMode({ mode: "cleaning" } as never),
    );
    const invalidHeater = await captureError(
      client.setHeaterEnabled({ heaterEnabled: "off" } as never),
    );

    expect((invalidTemperature as ApiClientError).kind).toBe("invalid-request");
    expect((invalidMode as ApiClientError).kind).toBe("invalid-request");
    expect((invalidHeater as ApiClientError).kind).toBe("invalid-request");
  });

  test("keeps the same cancellation semantics as the network client", async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await captureError(
      createDebugDeviceApiClient().getState({ signal: controller.signal }),
    );

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).kind).toBe("cancelled");
  });

  test("provides deterministic API v2 profile and acknowledged extraction data", async () => {
    const client = createDebugDeviceApiClient();
    const profiles = await client.getProfiles();
    expect(profiles.profiles[0].profile?.name).toBe("Classic30");

    const request = {
      idempotencyKey: "debug-start-key-01",
      selection: { kind: "profile" as const, profileId: "profile-2" as const },
    };
    const started = await client.startExtraction(request);
    expect(started).toMatchObject({
      phase: "pre-infusion",
      pumpCommand: "running",
      status: "running",
    });
    await expect(client.startExtraction(request)).resolves.toEqual(started);
    await expect(client.getStateV2()).resolves.toMatchObject({
      extraction: { extractionId: started.extractionId, status: "running" },
      compensation: { status: "inactive" },
      cooldown: { status: "idle", pumpCommand: "off" },
    });
    await expect(client.stopExtraction()).resolves.toMatchObject({
      pumpCommand: "off",
      status: "idle",
    });
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
