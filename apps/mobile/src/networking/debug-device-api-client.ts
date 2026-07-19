import {
  BREW_TARGET_MIN_C,
  CooldownStateSchema,
  ExtractionStateSchema,
  HeaterSettingsRequestSchema,
  MachineStateV2Schema,
  ModeRequestSchema,
  ProfileSetSchema,
  STEAM_TARGET_MIN_C,
  TemperatureSettingsRequestSchema,
  StartExtractionRequestSchema,
  StartCooldownRequestSchema,
  type DeviceResponse,
  type CooldownState,
  type HeaterSettingsRequest,
  type HeaterSettingsResponse,
  type HealthResponse,
  type HistoryCursor,
  type HistoryPage,
  type MachineState,
  type MachineStateV2,
  type ModeRequest,
  type ModeResponse,
  type OverTemperatureDismissResponse,
  type ProfileSet,
  type StartExtractionRequest,
  type StartExtractionResponse,
  type StartCooldownRequest,
  type StartCooldownResponse,
  type StopCooldownResponse,
  type StopExtractionResponse,
  type TemperatureSettingsRequest,
  type TemperatureSettingsResponse,
} from "@philcoino/protocol";

import type { DashboardMutationClient } from "../dashboard/dashboard-mutation-session";
import type { DashboardStateClient } from "../dashboard/dashboard-polling-session";
import {
  cloneProfileSet,
  DEFAULT_MOBILE_PROFILE_SET,
} from "../profiles/profile-set";
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
  private profiles = cloneProfileSet(DEFAULT_MOBILE_PROFILE_SET);
  private extraction = ExtractionStateSchema.parse({
    status: "idle",
    extractionId: null,
    selection: null,
    phase: "idle",
    elapsedMs: 0,
    remainingMs: null,
    pumpCommand: "off",
  });
  private cooldown: CooldownState = CooldownStateSchema.parse({
    status: "idle",
    cooldownId: null,
    brewTargetC: null,
    elapsedMs: 0,
    remainingMs: null,
    pumpCommand: "off",
    heaterInhibited: false,
    outcome: null,
  });
  private activeStartKey: string | null = null;
  private activeCooldownStartKey: string | null = null;

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

  async getStateV2(
    options: { signal?: AbortSignal } = {},
  ): Promise<MachineStateV2> {
    throwIfAborted(options.signal);
    return MachineStateV2Schema.parse({
      machine: this.state,
      extraction: this.extraction,
      compensation:
        this.extraction.status === "running" &&
        (this.extraction.phase === "manual" ||
          this.extraction.phase === "main-extraction") &&
        this.state.heaterEnabled &&
        this.state.status !== "fault"
          ? { status: "active", phase: this.extraction.phase }
          : { status: "inactive", phase: null },
      cooldown: this.cooldown,
    });
  }

  async getHistory(
    _cursor?: HistoryCursor,
    options: { signal?: AbortSignal } = {},
  ): Promise<HistoryPage> {
    throwIfAborted(options.signal);
    throw new ApiClientError(
      "not-found",
      "The debug device does not expose retained history.",
      { endpoint: "/api/v2/history", status: 404 },
    );
  }

  async getProfiles(
    options: { signal?: AbortSignal } = {},
  ): Promise<ProfileSet> {
    throwIfAborted(options.signal);
    return cloneProfileSet(this.profiles);
  }

  async replaceProfiles(
    profiles: ProfileSet,
    options: { signal?: AbortSignal } = {},
  ): Promise<ProfileSet> {
    throwIfAborted(options.signal);
    const parsed = ProfileSetSchema.safeParse(profiles);
    if (!parsed.success) {
      throw new ApiClientError("invalid-request", "The profile set is invalid.");
    }
    if (this.extraction.status === "running") {
      throw new ApiClientError("http", "Extraction is active.", {
        response: {
          error: {
            code: "extraction_active",
            message: "Profiles cannot be replaced while extraction is active.",
          },
          activeExtraction: this.extraction,
        },
        status: 409,
      });
    }
    if (this.cooldown.status !== "idle") {
      throw cooldownActiveError(this.cooldown);
    }
    this.profiles = cloneProfileSet(parsed.data);
    return cloneProfileSet(this.profiles);
  }

  async startExtraction(
    request: StartExtractionRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<StartExtractionResponse> {
    throwIfAborted(options.signal);
    const parsed = StartExtractionRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError("invalid-request", "The Start request is invalid.");
    }
    if (this.extraction.status === "running") {
      if (this.activeStartKey === parsed.data.idempotencyKey) {
        return this.extraction;
      }
      throw new ApiClientError("http", "Extraction is active.", {
        response: {
          error: {
            code: "extraction_active",
            message: "A different extraction is already active.",
          },
          activeExtraction: this.extraction,
        },
        status: 409,
      });
    }
    if (this.cooldown.status !== "idle") {
      throw cooldownActiveError(this.cooldown);
    }
    if (this.state.activeMode !== "brew") {
      throw new ApiClientError("http", "Brew mode is required.", {
        response: {
          error: {
            code: "brew_mode_required",
            message: "Switch the machine to Brew before starting extraction.",
          },
        },
        status: 409,
      });
    }

    const selection = parsed.data.selection;
    const profile =
      selection.kind === "profile"
        ? (this.profiles.profiles.find(
            (slot) => slot.id === selection.profileId,
          )?.profile ?? null)
        : null;
    if (selection.kind === "profile" && profile === null) {
      throw new ApiClientError("http", "The profile slot is empty.", {
        response: {
          error: {
            code: "profile_not_configured",
            message: "The selected custom profile slot is empty.",
          },
        },
        status: 409,
      });
    }

    const profileDurationMs =
      profile === null
        ? 60_000
        : (profile.preInfusionSeconds +
            profile.soakSeconds +
            profile.mainExtractionSeconds) *
          1_000;
    const phase =
      selection.kind === "manual"
        ? "manual"
        : (profile?.preInfusionSeconds ?? 0) > 0
          ? "pre-infusion"
          : "main-extraction";
    this.activeStartKey = parsed.data.idempotencyKey;
    this.extraction = ExtractionStateSchema.parse({
      status: "running",
      extractionId: "debug-run-1",
      selection,
      phase,
      elapsedMs: 0,
      remainingMs: profileDurationMs,
      pumpCommand: "running",
    });
    if (this.extraction.status !== "running") {
      throw new Error("Debug Start must produce a running extraction.");
    }
    return this.extraction;
  }

  async stopExtraction(
    options: { signal?: AbortSignal } = {},
  ): Promise<StopExtractionResponse> {
    throwIfAborted(options.signal);
    this.activeStartKey = null;
    this.extraction = ExtractionStateSchema.parse({
      status: "idle",
      extractionId: null,
      selection: null,
      phase: "idle",
      elapsedMs: 0,
      remainingMs: null,
      pumpCommand: "off",
    });
    if (this.extraction.status !== "idle") {
      throw new Error("Debug Stop must produce idle extraction.");
    }
    return this.extraction;
  }

  async startCooldown(
    request: StartCooldownRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<StartCooldownResponse> {
    throwIfAborted(options.signal);
    const parsed = StartCooldownRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError("invalid-request", "The cooldown Start request is invalid.");
    }
    if (this.extraction.status === "running") {
      throw new ApiClientError("http", "Extraction is active.", {
        response: {
          error: {
            code: "extraction_active",
            message: "Cooldown cannot start while extraction is active.",
          },
          activeExtraction: this.extraction,
        },
        status: 409,
      });
    }
    if (
      this.cooldown.status !== "idle" &&
      this.activeCooldownStartKey !== parsed.data.idempotencyKey
    ) {
      throw cooldownActiveError(this.cooldown);
    }
    if (this.activeCooldownStartKey === parsed.data.idempotencyKey) {
      return this.cooldown;
    }
    this.activeCooldownStartKey = parsed.data.idempotencyKey;
    this.state = createDebugState({
      activeMode: "brew",
      brewTargetC: this.state.brewTargetC,
      heaterEnabled: this.state.heaterEnabled,
      steamTargetC: this.state.steamTargetC,
    });
    this.cooldown = CooldownStateSchema.parse({
      status: "pumping",
      cooldownId: "debug-cooldown-1",
      brewTargetC: this.state.brewTargetC,
      elapsedMs: 0,
      remainingMs: 45_000,
      pumpCommand: "running",
      heaterInhibited: true,
      outcome: null,
    });
    return this.cooldown;
  }

  async stopCooldown(
    options: { signal?: AbortSignal } = {},
  ): Promise<StopCooldownResponse> {
    throwIfAborted(options.signal);
    if (this.cooldown.status === "pumping") {
      this.cooldown = CooldownStateSchema.parse({
        status: "stabilizing",
        cooldownId: this.cooldown.cooldownId,
        brewTargetC: this.cooldown.brewTargetC,
        elapsedMs: this.cooldown.elapsedMs,
        remainingMs: 5_000,
        pumpCommand: "off",
        heaterInhibited: true,
        outcome: "stopped",
      });
    }
    return this.cooldown;
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
      heaterEnabled: this.state.heaterEnabled,
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

    if (
      parsed.data.mode === "steam" &&
      (this.extraction.status === "running" || this.cooldown.status !== "idle")
    ) {
      throw new ApiClientError("http", "A workflow is active.", {
        response: {
          error: {
            code: "sensor_unavailable",
            message: "Steam cannot be selected while extraction or cooldown is active.",
          },
        },
        status: 409,
      });
    }

    this.state = createDebugState({
      activeMode: parsed.data.mode,
      brewTargetC: this.state.brewTargetC,
      heaterEnabled: this.state.heaterEnabled,
      steamTargetC: this.state.steamTargetC,
    });
    return { mode: parsed.data.mode };
  }

  async setHeaterEnabled(
    request: HeaterSettingsRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<HeaterSettingsResponse> {
    throwIfAborted(options.signal);
    const parsed = HeaterSettingsRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The heater permission request is invalid.",
      );
    }

    this.state = createDebugState({
      activeMode: this.state.activeMode,
      brewTargetC: this.state.brewTargetC,
      heaterEnabled: parsed.data.heaterEnabled,
      steamTargetC: this.state.steamTargetC,
    });
    return { heaterEnabled: parsed.data.heaterEnabled };
  }

  async dismissOverTemperature(
    options: { signal?: AbortSignal } = {},
  ): Promise<OverTemperatureDismissResponse> {
    throwIfAborted(options.signal);
    return this.state;
  }
}

function cooldownActiveError(cooldown: CooldownState): ApiClientError {
  if (cooldown.status === "idle") {
    throw new Error("A cooldown conflict requires active cooldown state.");
  }
  return new ApiClientError("http", "Cooldown is active.", {
    response: {
      error: {
        code: "cooldown_active",
        message: "A cooldown workflow is already active.",
      },
      activeCooldown: cooldown,
    },
    status: 409,
  });
}

export function createDebugDeviceApiClient(): DebugDeviceApiClient {
  return new DebugDeviceApiClient();
}

function createDebugState(
  overrides: Partial<
    Pick<
      MachineState,
      "activeMode" | "brewTargetC" | "heaterEnabled" | "steamTargetC"
    >
  > = {},
): MachineState {
  const activeMode = overrides.activeMode ?? "brew";
  const heaterEnabled = overrides.heaterEnabled ?? true;
  return {
    activeMode,
    brewTargetC: overrides.brewTargetC ?? BREW_TARGET_MIN_C,
    boilerTemperatureC: 0,
    fault: null,
    heaterEnabled,
    heaterActive: false,
    status: "heating",
    steamTargetC: overrides.steamTargetC ?? STEAM_TARGET_MIN_C,
    steamTimeoutRemainingMs: activeMode === "steam" ? 0 : null,
    uptimeMs: 0,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ApiClientError("cancelled", "The device request was cancelled.");
  }
}
