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
      brewTemperatureC: 0,
      heaterEnabled: true,
      heaterActive: false,
      steamTargetC: STEAM_TARGET_MIN_C,
      steamTemperatureC: 0,
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
      brewTemperatureC: 0,
      heaterEnabled: false,
      steamTargetC: 116,
      steamTemperatureC: 0,
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
});

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}
