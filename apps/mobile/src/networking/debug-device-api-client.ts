import {
  BREW_TARGET_MIN_C,
  CooldownStateSchema,
  ExtractionStateSchema,
  HeaterSettingsRequestSchema,
  MachineStateV2Schema,
  ModeRequestSchema,
  RAW_BOILER_OVER_TEMPERATURE_C,
  STEAM_TARGET_MAX_C,
  STEAM_TARGET_MIN_C,
  STEAM_COMPENSATION_DECAY_DEFAULT_MS,
  STEAM_COMPENSATION_INITIAL_DEFAULT_C,
  STEAM_READY_TIMEOUT_DEFAULT_MS,
  SteamControlSettingsRequestSchema,
  SteamControlStateSchema,
  TemperatureCalibrationSessionRequestSchema,
  TemperatureCalibrationStateSchema,
  TemperatureSettingsRequestSchema,
  UpdateTemperatureCalibrationCandidateRequestSchema,
  StartExtractionRequestSchema,
  StartCooldownRequestSchema,
  ScaleStateSchema,
  type DeviceResponse,
  type ApiV2ErrorCode,
  type CooldownState,
  type HeaterSettingsRequest,
  type HeaterSettingsResponse,
  type HealthResponse,
  type MachineState,
  type MachineStateV2,
  type ModeRequest,
  type ModeResponse,
  type OverTemperatureDismissResponse,
  type StartExtractionRequest,
  type StartExtractionResponse,
  type StartCooldownRequest,
  type StartCooldownResponse,
  type StopCooldownResponse,
  type StopExtractionResponse,
  type SteamControlSettingsRequest,
  type SteamControlState,
  type ScaleState,
  type ScaleTraceResponse,
  type WeightedExtractionTraceCursor,
  type TemperatureSettingsRequest,
  type TemperatureSettingsResponse,
  type TemperatureCalibrationSessionRequest,
  type TemperatureCalibrationState,
  type UpdateTemperatureCalibrationCandidateRequest,
} from "@philcoino/protocol";

import type { DashboardMutationClient } from "../dashboard/dashboard-mutation-session";
import type { DashboardStateClient } from "../dashboard/dashboard-polling-session";
import { ApiClientError } from "./api-client-error";

export const debugDeviceIdentity: DeviceResponse = {
  apiVersion: "2",
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
  private scale: ScaleState = ScaleStateSchema.parse({
    availability: "ready",
    calibrationStatus: "calibrated",
    stable: true,
    grossWeightDecigrams: 800,
    netWeightDecigrams: null,
    activeExtraction: null,
    terminalExtraction: null,
    warning: null,
  });
  private temperatureCalibration: TemperatureCalibrationState =
    createDebugTemperatureCalibration();
  private temperatureCalibrationWasSaved = false;
  private steamControl: SteamControlState = SteamControlStateSchema.parse({
    settings: {
      initialCompensationC: STEAM_COMPENSATION_INITIAL_DEFAULT_C,
      decayDurationMs: STEAM_COMPENSATION_DECAY_DEFAULT_MS,
      readyTimeoutMs: STEAM_READY_TIMEOUT_DEFAULT_MS,
    },
    compensationActive: false,
    appliedCompensationC: 0,
    controlTemperatureC: null,
    heatSoakElapsedMs: null,
  });

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

  async getSteamControlSettings(
    options: { signal?: AbortSignal } = {},
  ): Promise<SteamControlState> {
    throwIfAborted(options.signal);
    return this.steamControl;
  }

  async updateSteamControlSettings(
    request: SteamControlSettingsRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<SteamControlState> {
    throwIfAborted(options.signal);
    const parsed = SteamControlSettingsRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The steam-control settings request is invalid.",
      );
    }
    this.steamControl = SteamControlStateSchema.parse({
      ...this.steamControl,
      settings: { ...this.steamControl.settings, ...parsed.data },
    });
    this.synchronizeSteamControl();
    return this.steamControl;
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
    const profile = selection.kind === "profile" ? selection.profile : null;

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
    if ("weightControl" in parsed.data) {
      this.scale = {
        ...this.scale,
        netWeightDecigrams: 0,
        terminalExtraction: null,
        activeExtraction: {
          extractionId: "debug-run-1",
          mode: "weight",
          ...parsed.data.weightControl,
          cutoffWeightDecigrams:
            parsed.data.weightControl.targetWeightDecigrams -
            parsed.data.weightControl.compensationDecigrams,
          netWeightDecigrams: 0,
        },
      };
    }
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
    const activeWeight = this.scale.activeExtraction;
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
    if (activeWeight !== null) {
      this.scale = {
        ...this.scale,
        activeExtraction: null,
        netWeightDecigrams: activeWeight.netWeightDecigrams,
        terminalExtraction: {
          extractionId: activeWeight.extractionId,
          targetWeightDecigrams: activeWeight.targetWeightDecigrams,
          compensationDecigrams: activeWeight.compensationDecigrams,
          cutoffWeightDecigrams: activeWeight.cutoffWeightDecigrams,
          finalWeightDecigrams: activeWeight.netWeightDecigrams,
          settled: true,
          completionReason: "stopped",
          fallbackOccurred: false,
        },
      };
    }
    return this.extraction;
  }

  async getScale(
    options: { signal?: AbortSignal } = {},
  ): Promise<ScaleState> {
    throwIfAborted(options.signal);
    return this.scale;
  }

  async getScaleTrace(
    _cursor?: WeightedExtractionTraceCursor,
    options: { signal?: AbortSignal } = {},
  ): Promise<ScaleTraceResponse> {
    throwIfAborted(options.signal);
    return { scale: this.scale, trace: null };
  }

  async startScaleCalibration(
    options: { signal?: AbortSignal } = {},
  ): Promise<ScaleState> {
    throwIfAborted(options.signal);
    this.scale = { ...this.scale, calibrationStatus: "calibrating" };
    return this.scale;
  }

  async completeScaleCalibration(
    _request: { referenceWeightDecigrams: number },
    options: { signal?: AbortSignal } = {},
  ): Promise<ScaleState> {
    throwIfAborted(options.signal);
    this.scale = { ...this.scale, calibrationStatus: "calibrated" };
    return this.scale;
  }

  async cancelScaleCalibration(
    options: { signal?: AbortSignal } = {},
  ): Promise<ScaleState> {
    throwIfAborted(options.signal);
    this.scale = { ...this.scale, calibrationStatus: "calibrated" };
    return this.scale;
  }

  async acknowledgeScaleWarning(
    options: { signal?: AbortSignal } = {},
  ): Promise<ScaleState> {
    throwIfAborted(options.signal);
    this.scale = { ...this.scale, warning: null };
    return this.scale;
  }

  async getTemperatureCalibration(
    calibrationId?: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<TemperatureCalibrationState> {
    throwIfAborted(options.signal);
    if (this.temperatureCalibration.status === "calibrating") {
      if (calibrationId !== this.temperatureCalibration.calibrationId) {
        throw temperatureCalibrationError(
          "temperature_calibration_session_mismatch",
          "The calibration identifier does not own the debug session.",
        );
      }
    } else if (calibrationId !== undefined) {
      throw temperatureCalibrationError(
        "temperature_calibration_inactive",
        "No debug temperature calibration is active.",
      );
    }
    return this.temperatureCalibration;
  }

  async startTemperatureCalibration(
    options: { signal?: AbortSignal } = {},
  ): Promise<TemperatureCalibrationState> {
    throwIfAborted(options.signal);
    if (this.temperatureCalibration.status === "calibrating") {
      throw temperatureCalibrationError(
        "temperature_calibration_active",
        "A debug temperature calibration is already active.",
      );
    }
    if (this.state.activeMode !== "brew") {
      throw temperatureCalibrationError(
        "brew_mode_required",
        "Debug temperature calibration requires Brew mode.",
      );
    }
    if (!this.state.heaterEnabled) {
      throw temperatureCalibrationError(
        "heater_disabled",
        "Debug heater permission is disabled.",
      );
    }
    const savedOffsetC = this.temperatureCalibration.savedOffsetC;
    this.temperatureCalibration = TemperatureCalibrationStateSchema.parse({
      ...debugTemperatureCalibrationCommon(
        this.state,
        savedOffsetC,
      ),
      status: "calibrating",
      calibrationId: "temp-cal-debug-0001",
      candidateRawTargetC: 100 - savedOffsetC,
      offsetPreviewC: savedOffsetC,
      advisoryStableMs: 0,
      sessionLeaseRemainingMs: 15_000,
      previewSafeTargetBounds:
        debugTemperatureSafeBounds(savedOffsetC),
    });
    return this.temperatureCalibration;
  }

  async updateTemperatureCalibrationCandidate(
    request: UpdateTemperatureCalibrationCandidateRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<TemperatureCalibrationState> {
    throwIfAborted(options.signal);
    const parsed =
      UpdateTemperatureCalibrationCandidateRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The debug temperature calibration candidate is invalid.",
      );
    }
    const active = this.requireDebugTemperatureCalibration(
      parsed.data.calibrationId,
    );
    const offsetPreviewC = 100 - parsed.data.candidateRawTargetC;
    this.temperatureCalibration = TemperatureCalibrationStateSchema.parse({
      ...active,
      candidateRawTargetC: parsed.data.candidateRawTargetC,
      offsetPreviewC,
      advisoryStableMs: 0,
      sessionLeaseRemainingMs: 15_000,
      previewSafeTargetBounds:
        debugTemperatureSafeBounds(offsetPreviewC),
    });
    return this.temperatureCalibration;
  }

  async saveTemperatureCalibration(
    request: TemperatureCalibrationSessionRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<TemperatureCalibrationState> {
    throwIfAborted(options.signal);
    const parsed = TemperatureCalibrationSessionRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The debug temperature calibration session is invalid.",
      );
    }
    const active = this.requireDebugTemperatureCalibration(
      parsed.data.calibrationId,
    );
    if (
      this.state.steamTargetC - active.offsetPreviewC >
      RAW_BOILER_OVER_TEMPERATURE_C
    ) {
      throw temperatureCalibrationError(
        "temperature_target_unsafe",
        "The debug Steam target would require a raw temperature above the cap.",
      );
    }
    this.temperatureCalibration = TemperatureCalibrationStateSchema.parse({
      ...debugTemperatureCalibrationCommon(
        this.state,
        active.offsetPreviewC,
      ),
      status: "calibrated",
    });
    this.temperatureCalibrationWasSaved = true;
    return this.temperatureCalibration;
  }

  async cancelTemperatureCalibration(
    request: TemperatureCalibrationSessionRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<TemperatureCalibrationState> {
    throwIfAborted(options.signal);
    const parsed = TemperatureCalibrationSessionRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The debug temperature calibration session is invalid.",
      );
    }
    const active = this.requireDebugTemperatureCalibration(
      parsed.data.calibrationId,
    );
    this.temperatureCalibration = TemperatureCalibrationStateSchema.parse({
      ...debugTemperatureCalibrationCommon(
        this.state,
        active.savedOffsetC,
      ),
      status:
        this.temperatureCalibrationWasSaved
          ? "calibrated"
          : "uncalibrated",
    });
    return this.temperatureCalibration;
  }

  private requireDebugTemperatureCalibration(calibrationId: string) {
    const active = this.temperatureCalibration;
    if (active.status !== "calibrating") {
      throw temperatureCalibrationError(
        "temperature_calibration_inactive",
        "No debug temperature calibration is active.",
      );
    }
    if (active.calibrationId !== calibrationId) {
      throw temperatureCalibrationError(
        "temperature_calibration_session_mismatch",
        "The calibration identifier does not own the debug session.",
      );
    }
    return active;
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
    this.synchronizeSteamControl();
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
    this.rejectConflictingTemperatureCalibration(
      "Debug temperature calibration was cancelled before changing targets.",
    );

    const response = {
      brewTargetC: parsed.data.brewTargetC ?? this.state.brewTargetC,
      steamTargetC: parsed.data.steamTargetC ?? this.state.steamTargetC,
    };
    const savedOffsetC = this.temperatureCalibration.savedOffsetC;
    if (
      response.brewTargetC - savedOffsetC >
        RAW_BOILER_OVER_TEMPERATURE_C ||
      response.steamTargetC - savedOffsetC >
        RAW_BOILER_OVER_TEMPERATURE_C
    ) {
      throw temperatureTargetUnsafeError();
    }
    this.state = createDebugState({
      activeMode: this.state.activeMode,
      heaterEnabled: this.state.heaterEnabled,
      ...response,
    });
    this.synchronizeSteamControl();
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
    this.rejectConflictingTemperatureCalibration(
      "Debug temperature calibration was cancelled before changing mode.",
    );

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
    this.synchronizeSteamControl();
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
    this.rejectConflictingTemperatureCalibration(
      "Debug temperature calibration was cancelled before changing heater permission.",
    );

    this.state = createDebugState({
      activeMode: this.state.activeMode,
      brewTargetC: this.state.brewTargetC,
      heaterEnabled: parsed.data.heaterEnabled,
      steamTargetC: this.state.steamTargetC,
    });
    this.synchronizeSteamControl();
    return { heaterEnabled: parsed.data.heaterEnabled };
  }

  async dismissOverTemperature(
    options: { signal?: AbortSignal } = {},
  ): Promise<OverTemperatureDismissResponse> {
    throwIfAborted(options.signal);
    return this.state;
  }

  private synchronizeSteamControl(): void {
    const active = this.state.activeMode === "steam";
    const appliedCompensationC = active
      ? this.steamControl.settings.initialCompensationC
      : 0;
    this.steamControl = SteamControlStateSchema.parse({
      settings: this.steamControl.settings,
      compensationActive: active && appliedCompensationC > 0,
      appliedCompensationC,
      controlTemperatureC:
        active ? this.state.boilerTemperatureC + appliedCompensationC : null,
      heatSoakElapsedMs: active ? 0 : null,
    });
    this.state = { ...this.state, steamControl: this.steamControl };
  }

  private rejectConflictingTemperatureCalibration(message: string): void {
    const active = this.temperatureCalibration;
    if (active.status !== "calibrating") {
      return;
    }
    this.temperatureCalibration = TemperatureCalibrationStateSchema.parse({
      ...debugTemperatureCalibrationCommon(this.state, active.savedOffsetC),
      status: this.temperatureCalibrationWasSaved
        ? "calibrated"
        : "uncalibrated",
    });
    throw temperatureCalibrationError(
      "temperature_calibration_active",
      message,
    );
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

function createDebugTemperatureCalibration(): TemperatureCalibrationState {
  return TemperatureCalibrationStateSchema.parse({
    ...debugTemperatureCalibrationCommon(createDebugState(), 0),
    status: "uncalibrated",
  });
}

function debugTemperatureCalibrationCommon(
  state: MachineState,
  savedOffsetC: number,
) {
  return {
    savedOffsetC,
    boilerTemperatureRawC:
      state.boilerTemperatureC - savedOffsetC,
    boilerTemperatureC: state.boilerTemperatureC,
    heaterActive: state.heaterActive,
    ready: false,
    safeTargetBounds: debugTemperatureSafeBounds(savedOffsetC),
  };
}

function debugTemperatureSafeBounds(offsetC: number) {
  const maximum = RAW_BOILER_OVER_TEMPERATURE_C + offsetC;
  return {
    brewMinimumC: 85 as const,
    brewMaximumC: Math.min(95, maximum),
    steamMinimumC: 110 as const,
    steamMaximumC: Math.min(STEAM_TARGET_MAX_C, maximum),
  };
}

function temperatureCalibrationError(
  code: ApiV2ErrorCode,
  message: string,
): ApiClientError {
  return new ApiClientError("http", message, {
    response: { error: { code, message } },
    status: 409,
  });
}

function temperatureTargetUnsafeError(): ApiClientError {
  const message =
    "The requested effective target would exceed the raw temperature ceiling.";
  return new ApiClientError("http", message, {
    response: {
      error: {
        code: "temperature_target_unsafe",
        message,
      },
    },
    status: 400,
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
    steamControl: {
      settings: {
        initialCompensationC: STEAM_COMPENSATION_INITIAL_DEFAULT_C,
        decayDurationMs: STEAM_COMPENSATION_DECAY_DEFAULT_MS,
        readyTimeoutMs: STEAM_READY_TIMEOUT_DEFAULT_MS,
      },
      compensationActive: activeMode === "steam",
      appliedCompensationC:
        activeMode === "steam" ? STEAM_COMPENSATION_INITIAL_DEFAULT_C : 0,
      controlTemperatureC:
        activeMode === "steam" ? STEAM_COMPENSATION_INITIAL_DEFAULT_C : null,
      heatSoakElapsedMs: activeMode === "steam" ? 0 : null,
    },
    uptimeMs: 0,
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ApiClientError("cancelled", "The device request was cancelled.");
  }
}
