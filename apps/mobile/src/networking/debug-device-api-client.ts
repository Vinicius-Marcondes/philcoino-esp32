import {
  BREW_TARGET_MIN_C,
  MachineStateV3Schema,
  RAW_BOILER_OVER_TEMPERATURE_C,
  STEAM_COMPENSATION_DECAY_DEFAULT_MS,
  STEAM_COMPENSATION_INITIAL_DEFAULT_C,
  STEAM_TARGET_MIN_C,
  STEAM_READY_TIMEOUT_DEFAULT_MS,
  StartCooldownRequestSchema,
  StartExtractionRequestSchema,
  type DeviceResponse,
  type ApiErrorCode,
  type HealthResponse,
  type MachineStateV3,
  type ModeRequest,
  type SettingsRequest,
  type StartExtractionRequest,
  type TemperatureCalibrationSessionRequest,
  type UpdateTemperatureCalibrationCandidateRequest,
} from "@philcoino/protocol";

import type { DashboardMutationClient } from "../dashboard/dashboard-mutation-session";
import type { DashboardStateClient } from "../dashboard/dashboard-polling-session";
import { ApiClientError } from "./api-client-error";

const DEBUG_PIN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const DEBUG_TOKEN = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

export const debugDeviceIdentity: DeviceResponse = {
  apiVersion: "3",
  deviceId: "philcoino-debug",
  firmwareVersion: "debug",
  model: "debug-device",
  name: "Philcoino debug",
};

export const debugSelectedDevice = {
  deviceId: debugDeviceIdentity.deviceId,
  httpsOrigin: "https://debug.local",
  certificateSpkiSha256: DEBUG_PIN,
  clientId: "00000000000000000000000000000001",
  accessToken: DEBUG_TOKEN,
};

export class DebugDeviceApiClient
  implements DashboardStateClient, DashboardMutationClient
{
  private revision = 0;
  private snapshot: MachineStateV3 = createDebugSnapshot();
  private extractionKey: string | null = null;
  private cooldownKey: string | null = null;

  async getHealth(options: { signal?: AbortSignal } = {}): Promise<HealthResponse> {
    throwIfAborted(options.signal);
    return { status: "ok", uptimeMs: this.snapshot.capturedAtUptimeMs };
  }

  async getDevice(options: { signal?: AbortSignal } = {}): Promise<DeviceResponse> {
    throwIfAborted(options.signal);
    return debugDeviceIdentity;
  }

  async getState(options: { signal?: AbortSignal } = {}): Promise<MachineStateV3> {
    throwIfAborted(options.signal);
    return this.snapshot;
  }

  async getScale(options: { signal?: AbortSignal } = {}) {
    return (await this.getState(options)).scale;
  }

  async updateSettings(
    settings: SettingsRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<MachineStateV3> {
    throwIfAborted(options.signal);
    const machine = this.snapshot.machine;
    const steamSettings = {
      ...machine.steamControl.settings,
      ...settings.steamControl,
    };
    const brewTargetC = settings.brewTargetC ?? machine.brewTargetC;
    const steamTargetC = settings.steamTargetC ?? machine.steamTargetC;
    if (
      brewTargetC - this.snapshot.temperatureCalibration.savedOffsetC >
        RAW_BOILER_OVER_TEMPERATURE_C ||
      steamTargetC - this.snapshot.temperatureCalibration.savedOffsetC >
        RAW_BOILER_OVER_TEMPERATURE_C
    ) {
      throw httpError("temperature_target_unsafe", "The requested target is unsafe.", 400);
    }
    return this.commit({
      machine: {
        ...machine,
        brewTargetC,
        steamTargetC,
        steamControl: { ...machine.steamControl, settings: steamSettings },
      },
    });
  }

  updateTemperatureSettings(
    settings: Pick<SettingsRequest, "brewTargetC" | "steamTargetC">,
    options: { signal?: AbortSignal } = {},
  ): Promise<MachineStateV3> {
    return this.updateSettings(settings, options);
  }

  updateSteamControlSettings(
    steamControl: NonNullable<SettingsRequest["steamControl"]>,
    options: { signal?: AbortSignal } = {},
  ): Promise<MachineStateV3> {
    return this.updateSettings({ steamControl }, options);
  }

  async setMode(
    request: ModeRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<MachineStateV3> {
    throwIfAborted(options.signal);
    if (
      request.mode === "steam" &&
      (this.snapshot.extraction.status === "running" ||
        this.snapshot.cooldown.status !== "idle")
    ) {
      throw httpError("brew_mode_required", "A Brew workflow is active.", 409);
    }
    return this.commit({
      machine: createDebugMachine({
        ...this.snapshot.machine,
        activeMode: request.mode,
      }),
    });
  }

  async setHeaterEnabled(
    request: { enabled: boolean },
    options: { signal?: AbortSignal } = {},
  ): Promise<MachineStateV3> {
    throwIfAborted(options.signal);
    return this.commit({
      machine: {
        ...this.snapshot.machine,
        heaterEnabled: request.enabled,
        heaterActive: false,
      },
    });
  }

  async dismissOverTemperature(
    options: { signal?: AbortSignal } = {},
  ): Promise<MachineStateV3> {
    throwIfAborted(options.signal);
    return this.commit();
  }

  async startExtraction(
    request: StartExtractionRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<MachineStateV3> {
    throwIfAborted(options.signal);
    const parsed = StartExtractionRequestSchema.safeParse(request);
    if (!parsed.success) throw invalidRequest("The extraction request is invalid.");
    if (this.snapshot.extraction.status === "running") {
      if (this.extractionKey === parsed.data.idempotencyKey) return this.snapshot;
      throw httpError("extraction_active", "A different extraction is active.", 409);
    }
    if (this.snapshot.cooldown.status !== "idle") {
      throw httpError("cooldown_active", "Cooldown is active.", 409);
    }
    if (this.snapshot.machine.activeMode !== "brew") {
      throw httpError("brew_mode_required", "Brew mode is required.", 409);
    }
    this.extractionKey = parsed.data.idempotencyKey;
    const selection = parsed.data.selection;
    const remainingMs = selection.kind === "manual"
      ? 60_000
      : (selection.profile.preInfusionSeconds +
          selection.profile.soakSeconds +
          selection.profile.mainExtractionSeconds) * 1_000;
    const extractionId = "debug-extraction-0001";
    const activeWeight = "weightControl" in parsed.data
      ? {
          extractionId,
          mode: "weight" as const,
          ...parsed.data.weightControl,
          cutoffWeightDecigrams:
            parsed.data.weightControl.targetWeightDecigrams -
            parsed.data.weightControl.compensationDecigrams,
          netWeightDecigrams: 0,
        }
      : null;
    const extraction: MachineStateV3["extraction"] =
      selection.kind === "manual"
        ? {
            status: "running",
            extractionId,
            selection,
            phase: "manual",
            elapsedMs: 0,
            remainingMs,
            pumpCommand: "running",
          }
        : {
            status: "running",
            extractionId,
            selection,
            phase:
              selection.profile.preInfusionSeconds > 0
                ? "pre-infusion"
                : "main-extraction",
            elapsedMs: 0,
            remainingMs,
            pumpCommand: "running",
          };
    return this.commit({
      extraction,
      scale: {
        ...this.snapshot.scale,
        netWeightDecigrams: activeWeight === null ? null : 0,
        activeExtraction: activeWeight,
        terminalExtraction: null,
      },
    });
  }

  async stopExtraction(
    options: { signal?: AbortSignal } = {},
  ): Promise<MachineStateV3> {
    throwIfAborted(options.signal);
    const activeWeight = this.snapshot.scale.activeExtraction;
    this.extractionKey = null;
    return this.commit({
      extraction: idleExtraction(),
      scale: {
        ...this.snapshot.scale,
        activeExtraction: null,
        terminalExtraction:
          activeWeight === null
            ? this.snapshot.scale.terminalExtraction
            : {
                extractionId: activeWeight.extractionId,
                targetWeightDecigrams: activeWeight.targetWeightDecigrams,
                compensationDecigrams: activeWeight.compensationDecigrams,
                cutoffWeightDecigrams: activeWeight.cutoffWeightDecigrams,
                finalWeightDecigrams: activeWeight.netWeightDecigrams,
                settled: true,
                completionReason: "stopped",
                fallbackOccurred: false,
              },
      },
    });
  }

  async startCooldown(
    request: { idempotencyKey: string },
    options: { signal?: AbortSignal } = {},
  ): Promise<MachineStateV3> {
    throwIfAborted(options.signal);
    const parsed = StartCooldownRequestSchema.safeParse(request);
    if (!parsed.success) throw invalidRequest("The cooldown request is invalid.");
    if (this.snapshot.extraction.status === "running") {
      throw httpError("extraction_active", "Extraction is active.", 409);
    }
    if (this.snapshot.cooldown.status !== "idle") {
      if (this.cooldownKey === parsed.data.idempotencyKey) return this.snapshot;
      throw httpError("cooldown_active", "A different cooldown is active.", 409);
    }
    this.cooldownKey = parsed.data.idempotencyKey;
    return this.commit({
      machine: createDebugMachine({ ...this.snapshot.machine, activeMode: "brew" }),
      cooldown: {
        status: "pumping",
        cooldownId: "debug-cooldown-0001",
        brewTargetC: this.snapshot.machine.brewTargetC,
        elapsedMs: 0,
        remainingMs: 45_000,
        pumpCommand: "running",
        heaterInhibited: true,
        outcome: null,
      },
    });
  }

  async stopCooldown(
    options: { signal?: AbortSignal } = {},
  ): Promise<MachineStateV3> {
    throwIfAborted(options.signal);
    if (this.snapshot.cooldown.status !== "pumping") return this.commit();
    return this.commit({
      cooldown: {
        status: "stabilizing",
        cooldownId: this.snapshot.cooldown.cooldownId,
        brewTargetC: this.snapshot.cooldown.brewTargetC,
        elapsedMs: this.snapshot.cooldown.elapsedMs,
        remainingMs: 5_000,
        pumpCommand: "off",
        heaterInhibited: true,
        outcome: "stopped",
      },
    });
  }

  async startScaleCalibration(options: { signal?: AbortSignal } = {}) {
    throwIfAborted(options.signal);
    return this.commit({
      scale: { ...this.snapshot.scale, calibrationStatus: "calibrating" },
    });
  }

  async completeScaleCalibration(
    _request: { referenceWeightDecigrams: number },
    options: { signal?: AbortSignal } = {},
  ) {
    throwIfAborted(options.signal);
    return this.commit({
      scale: { ...this.snapshot.scale, calibrationStatus: "calibrated" },
    });
  }

  async cancelScaleCalibration(options: { signal?: AbortSignal } = {}) {
    throwIfAborted(options.signal);
    return this.commit({
      scale: { ...this.snapshot.scale, calibrationStatus: "calibrated" },
    });
  }

  async acknowledgeScaleWarning(options: { signal?: AbortSignal } = {}) {
    throwIfAborted(options.signal);
    return this.commit({ scale: { ...this.snapshot.scale, warning: null } });
  }

  async startTemperatureCalibration(options: { signal?: AbortSignal } = {}) {
    throwIfAborted(options.signal);
    if (this.snapshot.temperatureCalibration.status === "calibrating") {
      throw httpError("temperature_calibration_active", "Calibration is active.", 409);
    }
    return this.commit({
      temperatureCalibration: {
        ...temperatureCalibrationCommon(this.snapshot),
        status: "calibrating",
        calibrationId: "debug-temperature-calibration-0001",
        candidateRawTargetC: 100,
        offsetPreviewC: 0,
        advisoryStableMs: 0,
        sessionLeaseRemainingMs: 15_000,
        previewSafeTargetBounds: safeBounds(),
      },
    });
  }

  updateTemperatureCalibrationCandidate(
    request: UpdateTemperatureCalibrationCandidateRequest,
    options: { signal?: AbortSignal } = {},
  ) {
    throwIfAborted(options.signal);
    const active = this.requireCalibration(request.calibrationId);
    const offsetPreviewC = 100 - request.candidateRawTargetC;
    return Promise.resolve(this.commitSync({
      temperatureCalibration: {
        ...active,
        candidateRawTargetC: request.candidateRawTargetC,
        offsetPreviewC,
        sessionLeaseRemainingMs: 15_000,
        previewSafeTargetBounds: safeBounds(offsetPreviewC),
      },
    }));
  }

  renewTemperatureCalibration(
    request: TemperatureCalibrationSessionRequest,
    options: { signal?: AbortSignal } = {},
  ) {
    throwIfAborted(options.signal);
    const active = this.requireCalibration(request.calibrationId);
    return Promise.resolve(this.commitSync({
      temperatureCalibration: { ...active, sessionLeaseRemainingMs: 15_000 },
    }));
  }

  saveTemperatureCalibration(
    request: TemperatureCalibrationSessionRequest,
    options: { signal?: AbortSignal } = {},
  ) {
    throwIfAborted(options.signal);
    const active = this.requireCalibration(request.calibrationId);
    return Promise.resolve(this.commitSync({
      temperatureCalibration: {
        ...temperatureCalibrationCommon(this.snapshot, active.offsetPreviewC),
        status: "calibrated",
      },
    }));
  }

  cancelTemperatureCalibration(
    request: TemperatureCalibrationSessionRequest,
    options: { signal?: AbortSignal } = {},
  ) {
    throwIfAborted(options.signal);
    this.requireCalibration(request.calibrationId);
    return Promise.resolve(this.commitSync({
      temperatureCalibration: {
        ...temperatureCalibrationCommon(this.snapshot),
        status: "uncalibrated",
        savedOffsetC: 0,
      },
    }));
  }

  private requireCalibration(calibrationId: string) {
    const calibration = this.snapshot.temperatureCalibration;
    if (calibration.status !== "calibrating") {
      throw httpError("temperature_calibration_inactive", "No calibration is active.", 409);
    }
    if (calibration.calibrationId !== calibrationId) {
      throw httpError("temperature_calibration_session_mismatch", "Calibration ID mismatch.", 409);
    }
    return calibration;
  }

  private async commit(
    changes: Partial<Pick<MachineStateV3, "machine" | "scale" | "temperatureCalibration" | "extraction" | "cooldown">> = {},
  ): Promise<MachineStateV3> {
    return this.commitSync(changes);
  }

  private commitSync(
    changes: Partial<Pick<MachineStateV3, "machine" | "scale" | "temperatureCalibration" | "extraction" | "cooldown">> = {},
  ): MachineStateV3 {
    this.revision += 1;
    const extraction = changes.extraction ?? this.snapshot.extraction;
    const machine = changes.machine ?? this.snapshot.machine;
    this.snapshot = MachineStateV3Schema.parse({
      ...this.snapshot,
      ...changes,
      machine,
      extraction,
      revision: this.revision,
      capturedAtUptimeMs: this.snapshot.capturedAtUptimeMs + 1,
      compensation:
        extraction.status === "running" &&
        (extraction.phase === "manual" || extraction.phase === "main-extraction") &&
        machine.heaterEnabled &&
        machine.status !== "fault"
          ? { status: "active", phase: extraction.phase }
          : { status: "inactive", phase: null },
    });
    return this.snapshot;
  }
}

export function createDebugDeviceApiClient(): DebugDeviceApiClient {
  return new DebugDeviceApiClient();
}

function createDebugSnapshot(): MachineStateV3 {
  const machine = createDebugMachine();
  return MachineStateV3Schema.parse({
    apiVersion: "3",
    device: debugDeviceIdentity,
    bootId: "00000000000000000000000000000001",
    revision: 0,
    capturedAtUptimeMs: 0,
    machine,
    scale: {
      availability: "ready",
      calibrationStatus: "calibrated",
      stable: true,
      grossWeightDecigrams: 800,
      netWeightDecigrams: null,
      activeExtraction: null,
      terminalExtraction: null,
      warning: null,
    },
    temperatureCalibration: {
      ...temperatureCalibrationCommonFromMachine(machine),
      status: "uncalibrated",
      savedOffsetC: 0,
    },
    extraction: idleExtraction(),
    compensation: { status: "inactive", phase: null },
    cooldown: {
      status: "idle",
      cooldownId: null,
      brewTargetC: null,
      elapsedMs: 0,
      remainingMs: null,
      pumpCommand: "off",
      heaterInhibited: false,
      outcome: null,
    },
  });
}

function createDebugMachine(overrides: Partial<MachineStateV3["machine"]> = {}) {
  const activeMode = overrides.activeMode ?? "brew";
  const steamControl = {
    settings: overrides.steamControl?.settings ?? {
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
  };
  return {
    status: "heating" as const,
    activeMode,
    boilerTemperatureC:
      overrides.boilerTemperatureC === undefined
        ? 0
        : overrides.boilerTemperatureC,
    brewTargetC: overrides.brewTargetC ?? BREW_TARGET_MIN_C,
    steamTargetC: overrides.steamTargetC ?? STEAM_TARGET_MIN_C,
    heaterEnabled: overrides.heaterEnabled ?? true,
    heaterActive: false,
    steamTimeoutRemainingMs: activeMode === "steam" ? 0 : null,
    steamControl,
    uptimeMs: overrides.uptimeMs ?? 0,
    fault: null,
  };
}

function idleExtraction() {
  return {
    status: "idle" as const,
    extractionId: null,
    selection: null,
    phase: "idle" as const,
    elapsedMs: 0 as const,
    remainingMs: null,
    pumpCommand: "off" as const,
  };
}

function temperatureCalibrationCommon(snapshot: MachineStateV3, savedOffsetC = 0) {
  return temperatureCalibrationCommonFromMachine(snapshot.machine, savedOffsetC);
}

function temperatureCalibrationCommonFromMachine(
  machine: MachineStateV3["machine"],
  savedOffsetC = 0,
) {
  return {
    savedOffsetC,
    boilerTemperatureRawC:
      machine.boilerTemperatureC === null
        ? null
        : machine.boilerTemperatureC - savedOffsetC,
    boilerTemperatureC: machine.boilerTemperatureC,
    heaterActive: machine.heaterActive,
    ready: machine.status === "ready",
    safeTargetBounds: safeBounds(savedOffsetC),
  };
}

function safeBounds(offsetC = 0) {
  return {
    brewMinimumC: 85 as const,
    brewMaximumC: Math.min(95, RAW_BOILER_OVER_TEMPERATURE_C + offsetC),
    steamMinimumC: 110 as const,
    steamMaximumC: Math.min(145, RAW_BOILER_OVER_TEMPERATURE_C + offsetC),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ApiClientError("cancelled", "The device request was cancelled.");
  }
}

function invalidRequest(message: string): ApiClientError {
  return new ApiClientError("invalid-request", message);
}

function httpError(code: ApiErrorCode, message: string, status: number): ApiClientError {
  return new ApiClientError("http", message, {
    response: { error: { code, message } },
    status,
  });
}
