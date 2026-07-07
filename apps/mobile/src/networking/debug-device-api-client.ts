import {
  BREW_TARGET_MIN_C,
  ModeRequestSchema,
  STEAM_TARGET_MIN_C,
  TemperatureSettingsRequestSchema,
  type DeviceResponse,
  type HealthResponse,
  type MachineState,
  type ModeRequest,
  type ModeResponse,
  type OverTemperatureDismissResponse,
  type TemperatureSettingsRequest,
  type TemperatureSettingsResponse,
} from "@philcoino/protocol";

import type { DashboardMutationClient } from "../dashboard/dashboard-mutation-session";
import type { DashboardStateClient } from "../dashboard/dashboard-polling-session";
import { ApiClientError } from "./api-client-error";

export const debugDeviceIdentity: DeviceResponse = {
  apiVersion: "1",
  deviceId: "philcoino-debug",
  firmwareVersion: "debug",
  model: "debug-device",
  name: "Philcoino debug",
};

export const debugSelectedDevice = {
  deviceId: debugDeviceIdentity.deviceId,
  lastSuccessfulAddress: "debug://local",
  token: "debug-token",
};

export class DebugDeviceApiClient
  implements DashboardStateClient, DashboardMutationClient
{
  private state: MachineState = createDebugState();

  async getHealth(options: { signal?: AbortSignal } = {}): Promise<HealthResponse> {
    throwIfAborted(options.signal);
    return { status: "ok", uptimeMs: 0 };
  }

  async getDevice(options: { signal?: AbortSignal } = {}): Promise<DeviceResponse> {
    throwIfAborted(options.signal);
    return debugDeviceIdentity;
  }

  async getState(options: { signal?: AbortSignal } = {}): Promise<MachineState> {
    throwIfAborted(options.signal);
    return this.state;
  }

  async updateTemperatureSettings(
    settings: TemperatureSettingsRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<TemperatureSettingsResponse> {
    throwIfAborted(options.signal);
    const parsed = TemperatureSettingsRequestSchema.safeParse(settings);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The temperature settings request is invalid.",
      );
    }

    const response = {
      brewTargetC: parsed.data.brewTargetC ?? this.state.brewTargetC,
      steamTargetC: parsed.data.steamTargetC ?? this.state.steamTargetC,
    };
    this.state = createDebugState({
      activeMode: this.state.activeMode,
      ...response,
    });
    return response;
  }

  async setMode(
    request: ModeRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<ModeResponse> {
    throwIfAborted(options.signal);
    const parsed = ModeRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError("invalid-request", "The mode request is invalid.");
    }

    this.state = createDebugState({
      activeMode: parsed.data.mode,
      brewTargetC: this.state.brewTargetC,
      steamTargetC: this.state.steamTargetC,
    });
    return { mode: parsed.data.mode };
  }

  async dismissOverTemperature(
    options: { signal?: AbortSignal } = {},
  ): Promise<OverTemperatureDismissResponse> {
    throwIfAborted(options.signal);
    return this.state;
  }
}

export function createDebugDeviceApiClient(): DebugDeviceApiClient {
  return new DebugDeviceApiClient();
}

function createDebugState(
  overrides: Partial<
    Pick<MachineState, "activeMode" | "brewTargetC" | "steamTargetC">
  > = {},
): MachineState {
  const activeMode = overrides.activeMode ?? "brew";
  return {
    activeMode,
    brewTargetC: overrides.brewTargetC ?? BREW_TARGET_MIN_C,
    brewTemperatureC: 0,
    fault: null,
    heaterActive: false,
    status: "heating",
    steamTargetC: overrides.steamTargetC ?? STEAM_TARGET_MIN_C,
    steamTemperatureC: 0,
    steamTimeoutRemainingMs: activeMode === "steam" ? 0 : null,
    uptimeMs: 0,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ApiClientError("cancelled", "The device request was cancelled.");
  }
}
