import {
  BREW_TARGET_MAX_C,
  BREW_TARGET_MIN_C,
  COOLDOWN_PUMP_LIMIT_MS,
  COOLDOWN_STABILIZATION_MS,
  CompensationStateSchema,
  CooldownStateSchema,
  DeviceResponseSchema,
  ExtractionStateSchema,
  HeaterSettingsResponseSchema,
  HealthResponseSchema,
  HISTORY_PAGE_SIZE,
  HISTORY_RETENTION_SAMPLES,
  HistoryPageSchema,
  HistorySampleSchema,
  MachineStateSchema,
  MachineStateV2Schema,
  ProfileSetSchema,
  RunningExtractionStateSchema,
  ScaleStateSchema,
  ScaleTraceResponseSchema,
  STEAM_TARGET_MAX_C,
  STEAM_TARGET_MIN_C,
  STEAM_TIMEOUT_MS,
  TemperatureSettingsResponseSchema,
  WEIGHTED_TRACE_PAGE_SIZE,
  WEIGHTED_TRACE_RETENTION_SAMPLES,
  WEIGHTED_TRACE_SAMPLE_INTERVAL_MS,
  WEIGHTED_TRACE_SETTLING_LIMIT_MS,
  type DeviceResponse,
  type ActiveCooldownState,
  type CompensationState,
  type ControllerDiagnostics,
  type CooldownOutcome,
  type CooldownState,
  type Fault,
  type FaultCode,
  type HealthResponse,
  type HistoryCursor,
  type HistoryPage,
  type HistorySample,
  type HeaterSettingsResponse,
  type MachineState,
  type MachineStateV2,
  type Mode,
  type OverTemperatureDismissResponse,
  type TemperatureSettingsRequest,
  type TemperatureSettingsResponse,
  type ExtractionProfile,
  type ExtractionOutcome,
  type ExtractionSelection,
  type ExtractionState,
  type ProfileSet,
  type RunningExtractionState,
  type ScaleState,
  type ScaleTraceResponse,
  type TerminalExtractionState,
  type WeightControl,
  type WeightedExtractionTraceCursor,
  type WeightedExtractionTracePage,
  type WeightedExtractionTraceSample,
} from "@philcoino/protocol";

const AMBIENT_TEMPERATURE_C = 24;
const HEATING_RATE_C_PER_SECOND = 20;
const COOLING_RATE_C_PER_SECOND = 2;
const READY_BAND_C = 1;
const READY_HOLD_MS = 3_000;
const MAX_SIMULATION_STEP_MS = 100;
const BREW_OVER_TEMPERATURE_C = 98;
const STEAM_OVER_TEMPERATURE_C = 130;
const MANUAL_EXTRACTION_CUTOFF_MS = 60_000;
const WEIGHT_EXTRACTION_CUTOFF_MS = 60_000;
const SCALE_SETTLING_TIMEOUT_MS = 10_000;

const DEFAULT_PROFILE_SET: ProfileSet = ProfileSetSchema.parse({
  profiles: [
    {
      id: "profile-1",
      profile: {
        name: "Classic30",
        preInfusionSeconds: 0,
        soakSeconds: 0,
        mainExtractionSeconds: 30,
      },
    },
    {
      id: "profile-2",
      profile: {
        name: "Pre5Soak5",
        preInfusionSeconds: 5,
        soakSeconds: 5,
        mainExtractionSeconds: 25,
      },
    },
    { id: "profile-3", profile: null },
    { id: "profile-4", profile: null },
  ],
});

const FAULT_MESSAGES: Record<FaultCode, string> = {
  sensor_failure: "A simulated thermocouple is unavailable.",
  over_temperature: "A simulated over-temperature limit was reached.",
  heating_timeout: "The simulated machine did not heat before its deadline.",
  internal_error: "A simulated internal control failure occurred.",
};

export interface SimulatorMachineOptions {
  brewTargetC?: number;
  steamTargetC?: number;
  device?: Partial<DeviceResponse>;
}

export type ReplaceProfilesResult =
  | { ok: true; profiles: ProfileSet }
  | {
      ok: false;
      reason: "active";
      activeExtraction: RunningExtractionState;
    }
  | {
      ok: false;
      reason: "cooldown-active";
      activeCooldown: ActiveCooldownState;
    }
  | { ok: false; reason: "persistence" };

export type StartExtractionResult =
  | { ok: true; extraction: RunningExtractionState | TerminalExtractionState }
  | {
      ok: false;
      reason: "active";
      activeExtraction: RunningExtractionState;
    }
  | {
      ok: false;
      reason: "cooldown-active";
      activeCooldown: ActiveCooldownState;
    }
  | {
      ok: false;
      reason:
        | "brew-mode-required"
        | "profile-not-configured"
        | "idempotency-mismatch"
        | "scale-not-calibrated"
        | "scale-not-stable"
        | "scale-unavailable"
        | "scale-warning-unacknowledged";
    };

export type StartCooldownResult =
  | { ok: true; cooldown: CooldownState }
  | {
      ok: false;
      reason: "extraction-active";
      activeExtraction: RunningExtractionState;
    }
  | {
      ok: false;
      reason: "cooldown-active";
      activeCooldown: ActiveCooldownState;
    }
  | {
      ok: false;
      reason:
        | "cooldown-not-required"
        | "sensor-unavailable"
        | "machine-faulted"
        | "output-failure";
    };

export type StopCooldownResult =
  | { ok: true; cooldown: CooldownState }
  | { ok: false; reason: "output-failure" };

export type SimulatedOutputCommand =
  | "heater-off"
  | "pump-running"
  | "pump-off";

interface ActiveExtraction {
  elapsedMs: number;
  extractionId: string;
  idempotencyKey: string;
  profile: ExtractionProfile | null;
  selection: ExtractionSelection;
  tareWeightDecigrams: number | null;
  weightControl: WeightControl | null;
  weightFallback: boolean;
}

interface TerminalExtraction {
  elapsedMs: number;
  extractionId: string;
  idempotencyKey: string;
  outcome: ExtractionOutcome;
  selection: ExtractionSelection;
}

interface TerminalWeightRecord {
  compensationDecigrams: number;
  completionReason:
    | "weight-reached"
    | "timer-fallback"
    | "stopped"
    | "safety-cutoff";
  cutoffWeightDecigrams: number;
  extractionId: string;
  fallbackOccurred: boolean;
  finalWeightDecigrams: number | null;
  settled: boolean;
  settlingElapsedMs: number;
  targetWeightDecigrams: number;
}

interface WeightedTraceRecord {
  extractionId: string;
  lastCaptureUptimeMs: number;
  samples: WeightedExtractionTraceSample[];
  sequence: number;
  terminalCaptured: boolean;
}

interface CooldownRecord {
  cooldownId: string;
  idempotencyKey: string;
  brewTargetC: number;
  pumpElapsedMs: number;
  stabilizationElapsedMs: number;
  status: "pumping" | "stabilizing" | "terminal";
  outcome: CooldownOutcome | null;
}

export class SimulatorMachine {
  private bootCounter = 1;
  private bootId = simulatorBootId(this.bootCounter);
  private historySequence = 0;
  private lastHistorySecond = 0;
  private history: HistorySample[] = [];
  private readonly initialBrewTargetC: number;
  private readonly initialSteamTargetC: number;
  private readonly device: DeviceResponse;

  private activeMode: Mode = "brew";
  private boilerTemperatureC = AMBIENT_TEMPERATURE_C;
  private brewTargetC: number;
  private steamTargetC: number;
  private heaterEnabled = true;
  private fault: Fault | null = null;
  private readyElapsedMs = 0;
  private steamTimeoutRemainingMs: number | null = null;
  private uptimeMs = 0;
  private profiles = cloneProfileSet(DEFAULT_PROFILE_SET);
  private activeExtraction: ActiveExtraction | null = null;
  private terminalExtraction: TerminalExtraction | null = null;
  private scaleCalibrated = false;
  private scaleCalibrationInProgress = false;
  private scaleAvailable = true;
  private scaleStable = true;
  private scaleWeightDecigrams = 0;
  private terminalWeight: TerminalWeightRecord | null = null;
  private scaleWarningExtractionId: string | null = null;
  private weightedTrace: WeightedTraceRecord | null = null;
  private extractionCounter = 0;
  private cooldown: CooldownRecord | null = null;
  private cooldownCounter = 0;
  private failNextProfileSave = false;
  private readonly failNextOutputCommands = new Set<SimulatedOutputCommand>();

  constructor(options: SimulatorMachineOptions = {}) {
    this.initialBrewTargetC = options.brewTargetC ?? 93;
    this.initialSteamTargetC = options.steamTargetC ?? 115;

    if (
      this.initialBrewTargetC < BREW_TARGET_MIN_C ||
      this.initialBrewTargetC > BREW_TARGET_MAX_C ||
      !Number.isInteger(this.initialBrewTargetC)
    ) {
      throw new Error("Invalid initial brew target.");
    }

    if (
      this.initialSteamTargetC < STEAM_TARGET_MIN_C ||
      this.initialSteamTargetC > STEAM_TARGET_MAX_C ||
      !Number.isInteger(this.initialSteamTargetC)
    ) {
      throw new Error("Invalid initial steam target.");
    }

    this.brewTargetC = this.initialBrewTargetC;
    this.steamTargetC = this.initialSteamTargetC;
    this.device = DeviceResponseSchema.parse({
      deviceId: "philcoino-simulator",
      name: "Philcoino simulator",
      model: "philcoino-simulator",
      apiVersion: "1",
      firmwareVersion: "simulator-0.2.0",
      ...options.device,
    });
  }

  getHealth(): HealthResponse {
    return HealthResponseSchema.parse({ status: "ok", uptimeMs: this.uptimeMs });
  }

  getDevice(): DeviceResponse {
    return DeviceResponseSchema.parse(this.device);
  }

  getState(): MachineState {
    const status = this.fault
      ? "fault"
      : this.readyElapsedMs >= READY_HOLD_MS
        ? "ready"
        : "heating";

    return MachineStateSchema.parse({
      status,
      activeMode: this.activeMode,
      boilerTemperatureC: roundTemperature(this.boilerTemperatureC),
      brewTargetC: this.brewTargetC,
      steamTargetC: this.steamTargetC,
      heaterEnabled: this.heaterEnabled,
      heaterActive: this.isHeaterActive(),
      fault: this.fault,
      steamTimeoutRemainingMs: this.steamTimeoutRemainingMs,
      uptimeMs: this.uptimeMs,
    });
  }

  getStateV2(): MachineStateV2 {
    return MachineStateV2Schema.parse({
      machine: this.getState(),
      extraction: this.getExtractionState(),
      compensation: this.getCompensationState(),
      cooldown: this.getCooldownState(),
    });
  }

  getHistoryPage(cursor?: HistoryCursor): HistoryPage | null {
    const oldestSequence = this.history[0]?.sequence ?? null;
    const latestSequence = this.history.at(-1)?.sequence ?? null;
    let afterSequence = cursor?.afterSequence ?? 0;
    let continuity: HistoryPage["continuity"] = "initial";

    if (cursor !== undefined) {
      if (cursor.bootId !== this.bootId) {
        continuity = "reset";
        afterSequence = (oldestSequence ?? 1) - 1;
      } else if (latestSequence !== null && afterSequence > latestSequence) {
        return null;
      } else if (
        oldestSequence !== null &&
        afterSequence < oldestSequence - 1
      ) {
        continuity = "truncated";
        afterSequence = oldestSequence - 1;
      } else {
        continuity = "continuous";
      }
    }

    const samples = this.history
      .filter((sample) => sample.sequence > afterSequence)
      .slice(0, HISTORY_PAGE_SIZE);
    const nextSequence = samples.at(-1)?.sequence ?? afterSequence;
    return HistoryPageSchema.parse({
      deviceId: this.device.deviceId,
      bootId: this.bootId,
      capturedAtUptimeMs: this.uptimeMs,
      oldestSequence,
      latestSequence,
      nextCursor: { bootId: this.bootId, afterSequence: nextSequence },
      hasMore: latestSequence !== null && nextSequence < latestSequence,
      continuity,
      controllerConfiguration: {
        firmwareVersion: this.device.firmwareVersion,
        selectedController: "legacy_curve",
        piKp: 0.08,
        piKi: 0.01,
        filterAlpha: 0.25,
        controllerIntervalMs: 500,
        ssrWindowMs: 10_000,
      },
      samples,
    });
  }

  getProfiles(): ProfileSet {
    return cloneProfileSet(this.profiles);
  }

  getScaleState(): ScaleState {
    const active = this.activeExtraction;
    const weighted =
      active !== null &&
      active.weightControl !== null &&
      active.tareWeightDecigrams !== null;
    const netWeight =
      weighted && this.scaleAvailable
        ? this.scaleWeightDecigrams - active.tareWeightDecigrams!
        : null;
    return ScaleStateSchema.parse({
      availability: !this.scaleAvailable
        ? "unavailable"
        : this.scaleStable
          ? "ready"
          : "unstable",
      calibrationStatus: this.scaleCalibrationInProgress
        ? "calibrating"
        : this.scaleCalibrated
          ? "calibrated"
          : "uncalibrated",
      stable: this.scaleAvailable && this.scaleStable,
      grossWeightDecigrams: this.scaleCalibrated && this.scaleAvailable
        ? this.scaleWeightDecigrams
        : null,
      netWeightDecigrams: netWeight,
      activeExtraction:
        weighted
          ? {
              extractionId: active.extractionId,
              mode: active.weightFallback ? "timer-fallback" : "weight",
              targetWeightDecigrams:
                active.weightControl!.targetWeightDecigrams,
              compensationDecigrams:
                active.weightControl!.compensationDecigrams,
              cutoffWeightDecigrams: weightCutoff(active.weightControl!),
              netWeightDecigrams: netWeight,
            }
          : null,
      terminalExtraction:
        this.terminalWeight === null
          ? null
          : {
              extractionId: this.terminalWeight.extractionId,
              targetWeightDecigrams:
                this.terminalWeight.targetWeightDecigrams,
              compensationDecigrams:
                this.terminalWeight.compensationDecigrams,
              cutoffWeightDecigrams:
                this.terminalWeight.cutoffWeightDecigrams,
              finalWeightDecigrams:
                this.terminalWeight.finalWeightDecigrams,
              settled: this.terminalWeight.settled,
              completionReason: this.terminalWeight.completionReason,
              fallbackOccurred: this.terminalWeight.fallbackOccurred,
            },
      warning:
        this.scaleWarningExtractionId === null
          ? null
          : {
              code: "scale_fallback",
              extractionId: this.scaleWarningExtractionId,
              acknowledged: false,
            },
    });
  }

  getScaleTrace(
    cursor?: WeightedExtractionTraceCursor,
  ): ScaleTraceResponse | null {
    const trace = this.weightedTrace;
    if (trace === null || trace.samples.length === 0) {
      return ScaleTraceResponseSchema.parse({
        scale: this.getScaleState(),
        trace: null,
      });
    }

    const oldestSequence = trace.samples[0].sequence;
    const latestSequence = trace.samples.at(-1)!.sequence;
    let afterSequence = cursor?.afterSequence ?? 0;
    let continuity: WeightedExtractionTracePage["continuity"] = "initial";

    if (cursor !== undefined) {
      if (
        cursor.bootId !== this.bootId ||
        cursor.extractionId !== trace.extractionId
      ) {
        continuity = "reset";
        afterSequence = oldestSequence - 1;
      } else if (afterSequence > latestSequence) {
        return null;
      } else if (afterSequence < oldestSequence - 1) {
        continuity = "truncated";
        afterSequence = oldestSequence - 1;
      } else {
        continuity = "continuous";
      }
    }

    const samples = trace.samples
      .filter((sample) => sample.sequence > afterSequence)
      .slice(0, WEIGHTED_TRACE_PAGE_SIZE);
    const nextSequence = samples.at(-1)?.sequence ?? afterSequence;
    return ScaleTraceResponseSchema.parse({
      scale: this.getScaleState(),
      trace: {
        deviceId: this.device.deviceId,
        extractionId: trace.extractionId,
        bootId: this.bootId,
        capturedAtUptimeMs: this.uptimeMs,
        status: this.weightedTraceStatus(),
        oldestSequence,
        latestSequence,
        nextCursor: {
          extractionId: trace.extractionId,
          bootId: this.bootId,
          afterSequence: nextSequence,
        },
        hasMore: nextSequence < latestSequence,
        continuity,
        samples,
      },
    });
  }

  startScaleCalibration(): "ok" | "active" | "unavailable" | "unstable" {
    if (this.hasActiveWorkflow()) {
      return "active";
    }
    if (!this.scaleAvailable) {
      return "unavailable";
    }
    if (!this.scaleStable) {
      return "unstable";
    }
    this.scaleCalibrationInProgress = true;
    return "ok";
  }

  completeScaleCalibration(
    _referenceWeightDecigrams: number,
  ): "ok" | "not-started" | "unavailable" | "unstable" | "persistence" {
    if (!this.scaleCalibrationInProgress) {
      return "not-started";
    }
    if (!this.scaleAvailable) {
      return "unavailable";
    }
    if (!this.scaleStable) {
      return "unstable";
    }
    this.scaleCalibrated = true;
    this.scaleCalibrationInProgress = false;
    return "ok";
  }

  cancelScaleCalibration(): void {
    this.scaleCalibrationInProgress = false;
  }

  acknowledgeScaleWarning(): void {
    this.scaleWarningExtractionId = null;
  }

  setScaleState(options: {
    available?: boolean;
    stable?: boolean;
    weightDecigrams?: number;
  }): void {
    this.scaleAvailable = options.available ?? this.scaleAvailable;
    this.scaleStable = options.stable ?? this.scaleStable;
    this.scaleWeightDecigrams =
      options.weightDecigrams ?? this.scaleWeightDecigrams;
    this.evaluateWeightedExtraction();
  }

  replaceProfiles(profiles: ProfileSet): ReplaceProfilesResult {
    const extraction = this.getExtractionState();
    if (extraction.status === "running") {
      return {
        ok: false,
        reason: "active",
        activeExtraction: extraction,
      };
    }
    const cooldown = this.getCooldownState();
    if (cooldown.status !== "idle") {
      return {
        ok: false,
        reason: "cooldown-active",
        activeCooldown: cooldown,
      };
    }
    if (this.failNextProfileSave) {
      this.failNextProfileSave = false;
      return { ok: false, reason: "persistence" };
    }

    this.profiles = cloneProfileSet(ProfileSetSchema.parse(profiles));
    return { ok: true, profiles: this.getProfiles() };
  }

  injectNextProfileSaveFailure(): void {
    this.failNextProfileSave = true;
  }

  startExtraction(
    idempotencyKey: string,
    selection: ExtractionSelection,
    weightControl: WeightControl | null = null,
  ): StartExtractionResult {
    const current = this.getExtractionState();
    if (current.status === "running") {
      if (this.activeExtraction?.idempotencyKey === idempotencyKey) {
        return sameStart(
          this.activeExtraction.selection,
          this.activeExtraction.weightControl,
          selection,
          weightControl,
        )
          ? { ok: true, extraction: current }
          : { ok: false, reason: "idempotency-mismatch" };
      }
      return {
        ok: false,
        reason: "active",
        activeExtraction: current,
      };
    }
    if (this.terminalExtraction?.idempotencyKey === idempotencyKey) {
      return sameStart(
        this.terminalExtraction.selection,
        this.terminalWeight === null
          ? null
          : {
              targetWeightDecigrams:
                this.terminalWeight.targetWeightDecigrams,
              compensationDecigrams:
                this.terminalWeight.compensationDecigrams,
            },
        selection,
        weightControl,
      )
        ? { ok: true, extraction: current as TerminalExtractionState }
        : { ok: false, reason: "idempotency-mismatch" };
    }

    const cooldown = this.getCooldownState();
    if (cooldown.status !== "idle") {
      return {
        ok: false,
        reason: "cooldown-active",
        activeCooldown: cooldown,
      };
    }
    if (this.activeMode !== "brew") {
      return { ok: false, reason: "brew-mode-required" };
    }

    const profile =
      selection.kind === "profile"
        ? (this.profiles.profiles.find(
            (slot) => slot.id === selection.profileId,
          )?.profile ?? null)
        : null;
    if (selection.kind === "profile" && profile === null) {
      return { ok: false, reason: "profile-not-configured" };
    }
    if (weightControl !== null) {
      if (this.scaleWarningExtractionId !== null) {
        return { ok: false, reason: "scale-warning-unacknowledged" };
      }
      if (!this.scaleCalibrated) {
        return { ok: false, reason: "scale-not-calibrated" };
      }
      if (!this.scaleAvailable) {
        return { ok: false, reason: "scale-unavailable" };
      }
      if (!this.scaleStable) {
        return { ok: false, reason: "scale-not-stable" };
      }
    }

    this.extractionCounter += 1;
    this.terminalExtraction = null;
    if (weightControl !== null) {
      this.terminalWeight = null;
    }
    this.activeExtraction = {
      elapsedMs: 0,
      extractionId: `sim-run-${this.extractionCounter}`,
      idempotencyKey,
      profile: profile === null ? null : { ...profile },
      selection,
      tareWeightDecigrams:
        weightControl === null ? null : this.scaleWeightDecigrams,
      weightControl,
      weightFallback: false,
    };
    if (weightControl !== null) {
      this.weightedTrace = {
        extractionId: this.activeExtraction.extractionId,
        lastCaptureUptimeMs:
          this.uptimeMs - WEIGHTED_TRACE_SAMPLE_INTERVAL_MS,
        samples: [],
        sequence: 0,
        terminalCaptured: false,
      };
      this.captureWeightedTraceIfDue();
    }
    return {
      ok: true,
      extraction: RunningExtractionStateSchema.parse(this.getExtractionState()),
    };
  }

  stopExtraction(): ExtractionState {
    if (this.activeExtraction !== null) {
      if (this.activeExtraction.weightControl !== null) {
        this.finishWeightedExtraction("stopped");
        return this.getExtractionState();
      }
      this.terminalExtraction = {
        elapsedMs: this.activeExtraction.elapsedMs,
        extractionId: this.activeExtraction.extractionId,
        idempotencyKey: this.activeExtraction.idempotencyKey,
        outcome: "stopped",
        selection: this.activeExtraction.selection,
      };
      this.activeExtraction = null;
    }
    return this.getExtractionState();
  }

  getExtractionState(): ExtractionState {
    if (this.activeExtraction === null) {
      if (this.terminalExtraction !== null) {
        return ExtractionStateSchema.parse({
          status: "idle",
          extractionId: this.terminalExtraction.extractionId,
          selection: this.terminalExtraction.selection,
          phase: "idle",
          elapsedMs: this.terminalExtraction.elapsedMs,
          remainingMs: null,
          pumpCommand: "off",
          outcome: this.terminalExtraction.outcome,
        });
      }
      return ExtractionStateSchema.parse({
        status: "idle",
        extractionId: null,
        selection: null,
        phase: "idle",
        elapsedMs: 0,
        remainingMs: null,
        pumpCommand: "off",
      });
    }

    const active = this.activeExtraction;
    if (active.selection.kind === "manual") {
      return ExtractionStateSchema.parse({
        status: "running",
        extractionId: active.extractionId,
        selection: active.selection,
        phase: "manual",
        elapsedMs: active.elapsedMs,
        remainingMs: MANUAL_EXTRACTION_CUTOFF_MS - active.elapsedMs,
        pumpCommand: "running",
      });
    }

    if (active.profile === null) {
      throw new Error("An active profile extraction requires a profile snapshot.");
    }
    const preInfusionMs = active.profile.preInfusionSeconds * 1_000;
    const soakEndMs =
      preInfusionMs + active.profile.soakSeconds * 1_000;
    const totalMs =
      soakEndMs + active.profile.mainExtractionSeconds * 1_000;
    const phase =
      active.elapsedMs < preInfusionMs
        ? "pre-infusion"
        : active.elapsedMs < soakEndMs
          ? "soak"
          : "main-extraction";

    return ExtractionStateSchema.parse({
      status: "running",
      extractionId: active.extractionId,
      selection: active.selection,
      phase,
      elapsedMs: active.elapsedMs,
      remainingMs:
        active.weightControl === null || active.weightFallback
          ? Math.max(0, totalMs - active.elapsedMs)
          : WEIGHT_EXTRACTION_CUTOFF_MS - active.elapsedMs,
      pumpCommand: phase === "soak" ? "off" : "running",
    });
  }

  getCompensationState(): CompensationState {
    const extraction = this.getExtractionState();
    const phase =
      extraction.status === "running" &&
      (extraction.phase === "manual" || extraction.phase === "main-extraction")
        ? extraction.phase
        : null;
    const active =
      phase !== null &&
      this.activeMode === "brew" &&
      this.heaterEnabled &&
      this.fault === null &&
      this.getCooldownState().status === "idle";
    return CompensationStateSchema.parse(
      active ? { status: "active", phase } : { status: "inactive", phase: null },
    );
  }

  getCooldownState(): CooldownState {
    const cooldown = this.cooldown;
    if (cooldown === null) {
      return CooldownStateSchema.parse({
        status: "idle",
        cooldownId: null,
        brewTargetC: null,
        elapsedMs: 0,
        remainingMs: null,
        pumpCommand: "off",
        heaterInhibited: false,
        outcome: null,
      });
    }

    if (cooldown.status === "pumping") {
      return CooldownStateSchema.parse({
        status: "pumping",
        cooldownId: cooldown.cooldownId,
        brewTargetC: cooldown.brewTargetC,
        elapsedMs: cooldown.pumpElapsedMs,
        remainingMs: COOLDOWN_PUMP_LIMIT_MS - cooldown.pumpElapsedMs,
        pumpCommand: "running",
        heaterInhibited: true,
        outcome: null,
      });
    }

    if (cooldown.status === "stabilizing") {
      return CooldownStateSchema.parse({
        status: "stabilizing",
        cooldownId: cooldown.cooldownId,
        brewTargetC: cooldown.brewTargetC,
        elapsedMs:
          cooldown.pumpElapsedMs + cooldown.stabilizationElapsedMs,
        remainingMs:
          COOLDOWN_STABILIZATION_MS - cooldown.stabilizationElapsedMs,
        pumpCommand: "off",
        heaterInhibited: true,
        outcome: cooldown.outcome,
      });
    }

    return CooldownStateSchema.parse({
      status: "idle",
      cooldownId: cooldown.cooldownId,
      brewTargetC: cooldown.brewTargetC,
      elapsedMs: cooldown.pumpElapsedMs + cooldown.stabilizationElapsedMs,
      remainingMs: null,
      pumpCommand: "off",
      heaterInhibited: false,
      outcome: cooldown.outcome,
    });
  }

  startCooldown(idempotencyKey: string): StartCooldownResult {
    const current = this.getCooldownState();
    if (this.cooldown?.idempotencyKey === idempotencyKey) {
      return { ok: true, cooldown: current };
    }
    const extraction = this.getExtractionState();
    if (extraction.status === "running") {
      return {
        ok: false,
        reason: "extraction-active",
        activeExtraction: extraction,
      };
    }
    if (current.status !== "idle") {
      return {
        ok: false,
        reason: "cooldown-active",
        activeCooldown: current,
      };
    }

    if (this.fault?.code === "sensor_failure") {
      return { ok: false, reason: "sensor-unavailable" };
    }
    if (this.fault !== null) {
      return { ok: false, reason: "machine-faulted" };
    }
    if (!Number.isFinite(this.boilerTemperatureC)) {
      return { ok: false, reason: "sensor-unavailable" };
    }
    if (this.boilerTemperatureC <= this.brewTargetC) {
      return { ok: false, reason: "cooldown-not-required" };
    }

    this.cooldownCounter += 1;
    this.cooldown = {
      cooldownId: `sim-cooldown-${this.cooldownCounter}`,
      idempotencyKey,
      brewTargetC: this.brewTargetC,
      pumpElapsedMs: 0,
      stabilizationElapsedMs: 0,
      status: "pumping",
      outcome: null,
    };
    this.activeMode = "brew";
    this.readyElapsedMs = 0;
    this.steamTimeoutRemainingMs = null;

    if (
      !this.attemptOutputCommand("heater-off") ||
      !this.attemptOutputCommand("pump-running")
    ) {
      this.abortCooldownForOutputFailure();
      return { ok: false, reason: "output-failure" };
    }
    return { ok: true, cooldown: this.getCooldownState() };
  }

  stopCooldown(): StopCooldownResult {
    if (this.cooldown?.status !== "pumping") {
      return { ok: true, cooldown: this.getCooldownState() };
    }
    if (!this.enterCooldownStabilization("stopped")) {
      return { ok: false, reason: "output-failure" };
    }
    return { ok: true, cooldown: this.getCooldownState() };
  }

  hasActiveWorkflow(): boolean {
    return (
      this.activeExtraction !== null ||
      this.cooldown?.status === "pumping" ||
      this.cooldown?.status === "stabilizing"
    );
  }

  injectNextOutputFailure(command: SimulatedOutputCommand): void {
    this.failNextOutputCommands.add(command);
  }

  updateTemperatureSettings(
    request: TemperatureSettingsRequest,
  ): TemperatureSettingsResponse {
    const activeTargetChanged =
      (this.activeMode === "brew" &&
        request.brewTargetC !== undefined &&
        request.brewTargetC !== this.brewTargetC) ||
      (this.activeMode === "steam" &&
        request.steamTargetC !== undefined &&
        request.steamTargetC !== this.steamTargetC);

    this.brewTargetC = request.brewTargetC ?? this.brewTargetC;
    this.steamTargetC = request.steamTargetC ?? this.steamTargetC;

    if (activeTargetChanged) {
      this.readyElapsedMs = 0;
    }

    return TemperatureSettingsResponseSchema.parse({
      brewTargetC: this.brewTargetC,
      steamTargetC: this.steamTargetC,
    });
  }

  setMode(mode: Mode): Mode {
    if (mode === this.activeMode) {
      return this.activeMode;
    }

    this.activeMode = mode;
    this.readyElapsedMs = 0;
    this.steamTimeoutRemainingMs = null;
    return this.activeMode;
  }

  setHeaterEnabled(heaterEnabled: boolean): HeaterSettingsResponse {
    this.heaterEnabled = heaterEnabled;
    if (!heaterEnabled) {
      this.readyElapsedMs = 0;
    }
    return HeaterSettingsResponseSchema.parse({ heaterEnabled });
  }

  setTemperature(boilerTemperatureC: number): void {
    this.boilerTemperatureC = boilerTemperatureC;

    if (
      this.cooldown?.status === "pumping" &&
      boilerTemperatureC <= this.cooldown.brewTargetC
    ) {
      this.enterCooldownStabilization("target-reached");
    }

    if (!this.isActiveTemperatureReady()) {
      this.readyElapsedMs = 0;
    }
  }

  injectFault(code: FaultCode): void {
    if (this.fault) {
      return;
    }

    this.fault = { code, message: FAULT_MESSAGES[code] };
    this.readyElapsedMs = 0;
    if (
      this.cooldown?.status === "pumping" ||
      this.cooldown?.status === "stabilizing"
    ) {
      this.failCooldown();
    }
  }

  dismissOverTemperature(): OverTemperatureDismissResponse | null {
    if (
      this.fault?.code !== "over_temperature" ||
      !this.activeTemperatureBackAtTarget() ||
      this.activeModeOverTemperature()
    ) {
      return null;
    }

    this.fault = null;
    this.readyElapsedMs = 0;
    return this.getState();
  }

  advance(milliseconds: number): void {
    let remainingMs = milliseconds;

    while (remainingMs > 0) {
      const traceDelayMs =
        this.weightedTrace === null || this.weightedTrace.terminalCaptured
          ? Number.POSITIVE_INFINITY
          : Math.max(
              1,
              this.weightedTrace.lastCaptureUptimeMs +
                WEIGHTED_TRACE_SAMPLE_INTERVAL_MS -
                this.uptimeMs,
            );
      const stepMs = Math.min(
        remainingMs,
        MAX_SIMULATION_STEP_MS,
        traceDelayMs,
        this.steamTimeoutRemainingMs ?? Number.POSITIVE_INFINITY,
      );
      this.advanceStep(stepMs);
      remainingMs -= stepMs;
    }
  }

  powerCycle(): void {
    this.failNextProfileSave = false;
    this.failNextOutputCommands.clear();
    this.resetVolatileState();
  }

  reset(): void {
    this.brewTargetC = this.initialBrewTargetC;
    this.steamTargetC = this.initialSteamTargetC;
    this.profiles = cloneProfileSet(DEFAULT_PROFILE_SET);
    this.scaleCalibrated = false;
    this.failNextProfileSave = false;
    this.failNextOutputCommands.clear();
    this.resetVolatileState();
  }

  private advanceStep(milliseconds: number): void {
    const timeoutWasActive = this.steamTimeoutRemainingMs !== null;
    const seconds = milliseconds / 1_000;

    if (this.fault || this.isCooldownActive()) {
      this.boilerTemperatureC = moveToward(
        this.boilerTemperatureC,
        AMBIENT_TEMPERATURE_C,
        COOLING_RATE_C_PER_SECOND * seconds,
      );
    } else if (this.heaterEnabled) {
      this.advanceTemperature(seconds);
    } else {
      this.coolTemperature(seconds);
    }

    this.uptimeMs += milliseconds;
    this.advanceExtraction(milliseconds);
    this.advanceScaleSettling(milliseconds);
    this.captureWeightedTraceIfDue();
    this.advanceCooldown(milliseconds);

    if (!this.fault && this.isActiveTemperatureReady()) {
      this.readyElapsedMs = Math.min(
        READY_HOLD_MS,
        this.readyElapsedMs + milliseconds,
      );
    } else {
      this.readyElapsedMs = 0;
    }

    if (
      this.activeMode === "steam" &&
      this.readyElapsedMs >= READY_HOLD_MS &&
      this.steamTimeoutRemainingMs === null
    ) {
      this.steamTimeoutRemainingMs = STEAM_TIMEOUT_MS;
    } else if (timeoutWasActive && this.steamTimeoutRemainingMs !== null) {
      this.steamTimeoutRemainingMs -= milliseconds;
      if (this.steamTimeoutRemainingMs <= 0) {
        this.activeMode = "brew";
        this.readyElapsedMs = 0;
        this.steamTimeoutRemainingMs = null;
      }
    }

    const currentSecond = Math.floor(this.uptimeMs / 1_000);
    if (currentSecond > this.lastHistorySecond) {
      this.lastHistorySecond = currentSecond;
      this.captureHistorySample();
    }
  }

  private captureHistorySample(): void {
    const machine = this.getState();
    const extraction = this.getExtractionState();
    const cooldown = this.getCooldownState();
    const pumpActive =
      cooldown.status === "pumping" ||
      (cooldown.status === "idle" && extraction.pumpCommand === "running");
    this.historySequence += 1;
    this.history.push(
      HistorySampleSchema.parse({
        sequence: this.historySequence,
        uptimeMs: this.uptimeMs,
        boilerTemperatureC: machine.boilerTemperatureC,
        brewTargetC: machine.brewTargetC,
        steamTargetC: machine.steamTargetC,
        activeMode: machine.activeMode,
        heaterEnabled: machine.heaterEnabled,
        heaterActive: machine.heaterActive,
        pumpActive,
        machineStatus: machine.status,
        faultCode: machine.fault?.code ?? null,
        controllerDiagnostics: this.getControllerDiagnostics(
          extraction,
          cooldown,
          pumpActive,
        ),
      }),
    );
    if (this.history.length > HISTORY_RETENTION_SAMPLES) {
      this.history.splice(0, this.history.length - HISTORY_RETENTION_SAMPLES);
    }
  }

  private getControllerDiagnostics(
    extraction: ExtractionState,
    cooldown: CooldownState,
    pumpActive: boolean,
  ): ControllerDiagnostics {
    // Simulator controls may inject deliberately impossible temperatures to
    // exercise cooldown/fault UI. Keep diagnostic telemetry within the wire
    // contract without changing the simulator's independently reported state.
    const temperature = roundTemperature(
      Math.max(-40, Math.min(160, this.boilerTemperatureC)),
    );
    const baseTarget = this.activeTarget();
    const privateTarget = this.controlTarget();
    const error = roundTemperature(privateTarget - temperature);
    const proportionalContribution = roundTemperature(
      Math.max(-16, Math.min(16, 0.08 * error)),
    );
    const piRequestedDuty = Math.max(
      0,
      Math.min(1, proportionalContribution),
    );
    const piSaturation =
      proportionalContribution <= 0
        ? "lower"
        : proportionalContribution >= 1
          ? "upper"
          : "none";
    const operatingMode =
      this.fault !== null
        ? "fault"
        : cooldown.heaterInhibited
          ? "inhibited"
          : this.activeMode === "steam"
            ? "steam"
            : extraction.status === "running"
              ? "brewing"
              : this.terminalExtraction !== null &&
                  Math.abs(temperature - privateTarget) > READY_BAND_C
                ? "post_brew_recovery"
                : machineOperatingMode(temperature, privateTarget);

    return {
      temperatureRawC: temperature,
      temperatureFilteredC: temperature,
      baseTargetC: baseTarget,
      privateTargetC: privateTarget,
      errorC: error,
      selectedController: "legacy_curve",
      legacyRequestedDuty: this.isHeaterActive() ? 1 : 0,
      piRequestedDuty,
      proportionalContribution,
      integralContribution: 0,
      integralState: 0,
      piSaturation,
      piAntiWindupActive: false,
      heaterCommandActive: this.isHeaterActive(),
      deliveredCommandDuty1s: this.isHeaterActive() ? 1 : 0,
      pumpCommand: pumpActive ? "running" : "off",
      extractionPhase: extraction.phase,
      operatingMode,
    };
  }

  private advanceExtraction(milliseconds: number): void {
    if (this.activeExtraction === null) {
      return;
    }
    this.evaluateWeightedExtraction();
    if (this.activeExtraction === null) {
      return;
    }
    const weighted = this.activeExtraction.weightControl !== null;
    const durationMs = this.activeExtraction.selection.kind === "manual"
      ? MANUAL_EXTRACTION_CUTOFF_MS
      : weighted && !this.activeExtraction.weightFallback
        ? WEIGHT_EXTRACTION_CUTOFF_MS
        : profileDurationMs(this.activeExtraction.profile);
    const nextElapsedMs = this.activeExtraction.elapsedMs + milliseconds;
    if (nextElapsedMs >= durationMs) {
      if (weighted) {
        this.finishWeightedExtraction(
          this.activeExtraction.weightFallback
            ? "timer-fallback"
            : "safety-cutoff",
          durationMs,
        );
        return;
      }
      this.terminalExtraction = {
        elapsedMs: durationMs,
        extractionId: this.activeExtraction.extractionId,
        idempotencyKey: this.activeExtraction.idempotencyKey,
        outcome: "completed",
        selection: this.activeExtraction.selection,
      };
      this.activeExtraction = null;
      return;
    }
    this.activeExtraction.elapsedMs = nextElapsedMs;
    this.evaluateWeightedExtraction();
  }

  private evaluateWeightedExtraction(): void {
    const active = this.activeExtraction;
    if (active?.weightControl === null || active === null) {
      return;
    }
    if (!this.scaleAvailable) {
      active.weightFallback = true;
      this.scaleWarningExtractionId = active.extractionId;
      if (active.elapsedMs >= profileDurationMs(active.profile)) {
        this.finishWeightedExtraction(
          "timer-fallback",
          profileDurationMs(active.profile),
        );
      }
      return;
    }
    if (active.weightFallback || active.tareWeightDecigrams === null) {
      return;
    }
    const netWeight =
      this.scaleWeightDecigrams - active.tareWeightDecigrams;
    if (netWeight >= weightCutoff(active.weightControl)) {
      this.finishWeightedExtraction("weight-reached");
    }
  }

  private finishWeightedExtraction(
    completionReason: TerminalWeightRecord["completionReason"],
    elapsedMs?: number,
  ): void {
    const active = this.activeExtraction;
    if (active?.weightControl === null || active === null) {
      return;
    }
    const measured =
      this.scaleAvailable && active.tareWeightDecigrams !== null
        ? this.scaleWeightDecigrams - active.tareWeightDecigrams
        : null;
    this.terminalExtraction = {
      elapsedMs: elapsedMs ?? active.elapsedMs,
      extractionId: active.extractionId,
      idempotencyKey: active.idempotencyKey,
      outcome: completionReason === "stopped" ? "stopped" : "completed",
      selection: active.selection,
    };
    this.terminalWeight = {
      compensationDecigrams: active.weightControl.compensationDecigrams,
      completionReason,
      cutoffWeightDecigrams: weightCutoff(active.weightControl),
      extractionId: active.extractionId,
      fallbackOccurred: active.weightFallback,
      finalWeightDecigrams: measured,
      settled: this.scaleAvailable && this.scaleStable,
      settlingElapsedMs: 0,
      targetWeightDecigrams: active.weightControl.targetWeightDecigrams,
    };
    this.activeExtraction = null;
    if (this.weightedTrace?.extractionId === active.extractionId) {
      this.weightedTrace.lastCaptureUptimeMs =
        this.uptimeMs - WEIGHTED_TRACE_SAMPLE_INTERVAL_MS;
      this.captureWeightedTraceIfDue();
    }
  }

  private advanceScaleSettling(milliseconds: number): void {
    const terminal = this.terminalWeight;
    if (terminal === null || terminal.settled) {
      return;
    }
    terminal.settlingElapsedMs = Math.min(
      SCALE_SETTLING_TIMEOUT_MS,
      terminal.settlingElapsedMs + milliseconds,
    );
    if (this.scaleAvailable) {
      terminal.finalWeightDecigrams = this.scaleWeightDecigrams;
      if (this.scaleStable) {
        terminal.settled = true;
      }
    }
  }

  private captureWeightedTraceIfDue(): void {
    const trace = this.weightedTrace;
    if (
      trace === null ||
      trace.terminalCaptured ||
      this.uptimeMs - trace.lastCaptureUptimeMs <
        WEIGHTED_TRACE_SAMPLE_INTERVAL_MS
    ) {
      return;
    }

    const active = this.activeExtraction;
    const terminal = this.terminalWeight;
    if (
      active?.weightControl === null &&
      terminal?.extractionId !== trace.extractionId
    ) {
      return;
    }
    const extraction = this.getExtractionState();
    const running =
      active !== null &&
      active.weightControl !== null &&
      active.extractionId === trace.extractionId;
    const settlingElapsedMs = running ? 0 : (terminal?.settlingElapsedMs ?? 0);
    const phase = running
      ? extraction.phase === "pre-infusion" ||
        extraction.phase === "soak" ||
        extraction.phase === "main-extraction"
        ? extraction.phase
        : "main-extraction"
      : "settling";
    const availability = !this.scaleAvailable
      ? "unavailable"
      : this.scaleStable
        ? "ready"
        : "unstable";
    const netWeightDecigrams = running
      ? this.scaleAvailable && active.tareWeightDecigrams !== null
        ? this.scaleWeightDecigrams - active.tareWeightDecigrams
        : null
      : terminal?.finalWeightDecigrams ?? null;

    trace.sequence += 1;
    trace.lastCaptureUptimeMs = this.uptimeMs;
    trace.samples.push({
      sequence: trace.sequence,
      uptimeMs: this.uptimeMs,
      elapsedMs: Math.min(
        WEIGHT_EXTRACTION_CUTOFF_MS + WEIGHTED_TRACE_SETTLING_LIMIT_MS,
        running
          ? active.elapsedMs
          : (this.terminalExtraction?.elapsedMs ?? 0) + settlingElapsedMs,
      ),
      phase,
      boilerTemperatureC: roundTemperature(this.boilerTemperatureC),
      activeTargetC: this.brewTargetC,
      netWeightDecigrams,
      scaleAvailability: availability,
      pumpCommand: running ? extraction.pumpCommand : "off",
    });
    if (trace.samples.length > WEIGHTED_TRACE_RETENTION_SAMPLES) {
      trace.samples.splice(
        0,
        trace.samples.length - WEIGHTED_TRACE_RETENTION_SAMPLES,
      );
    }
    if (this.weightedTraceStatus() === "terminal") {
      trace.terminalCaptured = true;
    }
  }

  private weightedTraceStatus(): WeightedExtractionTracePage["status"] {
    const trace = this.weightedTrace;
    if (
      trace !== null &&
      this.activeExtraction?.extractionId === trace.extractionId &&
      this.activeExtraction.weightControl !== null
    ) {
      return "running";
    }
    const terminal = this.terminalWeight;
    return terminal !== null &&
      terminal.extractionId === trace?.extractionId &&
      !terminal.settled &&
      terminal.settlingElapsedMs < WEIGHTED_TRACE_SETTLING_LIMIT_MS
      ? "settling"
      : "terminal";
  }

  private advanceCooldown(milliseconds: number): void {
    const cooldown = this.cooldown;
    if (cooldown?.status === "pumping") {
      cooldown.pumpElapsedMs = Math.min(
        COOLDOWN_PUMP_LIMIT_MS,
        cooldown.pumpElapsedMs + milliseconds,
      );
      const outcome =
        this.boilerTemperatureC <= cooldown.brewTargetC
          ? "target-reached"
          : cooldown.pumpElapsedMs >= COOLDOWN_PUMP_LIMIT_MS
            ? "cutoff"
            : null;
      if (outcome !== null) {
        this.enterCooldownStabilization(outcome);
      }
      return;
    }

    if (cooldown?.status === "stabilizing") {
      cooldown.stabilizationElapsedMs = Math.min(
        COOLDOWN_STABILIZATION_MS,
        cooldown.stabilizationElapsedMs + milliseconds,
      );
      if (cooldown.stabilizationElapsedMs >= COOLDOWN_STABILIZATION_MS) {
        cooldown.status = "terminal";
      }
    }
  }

  private advanceTemperature(seconds: number): void {
    const target = this.controlTarget();
    this.boilerTemperatureC = moveToward(
      this.boilerTemperatureC,
      target,
      (this.boilerTemperatureC < target
        ? HEATING_RATE_C_PER_SECOND
        : COOLING_RATE_C_PER_SECOND) * seconds,
    );
  }

  private coolTemperature(seconds: number): void {
    this.boilerTemperatureC = moveToward(
      this.boilerTemperatureC,
      AMBIENT_TEMPERATURE_C,
      COOLING_RATE_C_PER_SECOND * seconds,
    );
  }

  private isActiveTemperatureReady(): boolean {
    return Math.abs(this.boilerTemperatureC - this.activeTarget()) <= READY_BAND_C;
  }

  private isHeaterActive(): boolean {
    if (this.fault || !this.heaterEnabled || this.isCooldownActive()) {
      return false;
    }

    return this.boilerTemperatureC < this.controlTarget();
  }

  private activeTemperatureBackAtTarget(): boolean {
    return this.boilerTemperatureC <= this.activeTarget();
  }

  private activeTarget(): number {
    return this.activeMode === "brew" ? this.brewTargetC : this.steamTargetC;
  }

  private controlTarget(): number {
    if (this.getCompensationState().status !== "active") {
      return this.activeTarget();
    }
    return Math.min(this.brewTargetC + 2, BREW_OVER_TEMPERATURE_C - 1);
  }

  private activeModeOverTemperature(): boolean {
    const limit =
      this.activeMode === "brew"
        ? BREW_OVER_TEMPERATURE_C
        : STEAM_OVER_TEMPERATURE_C;
    return this.boilerTemperatureC >= limit;
  }

  private resetVolatileState(): void {
    this.bootCounter += 1;
    this.bootId = simulatorBootId(this.bootCounter);
    this.historySequence = 0;
    this.lastHistorySecond = 0;
    this.history = [];
    this.activeMode = "brew";
    this.boilerTemperatureC = AMBIENT_TEMPERATURE_C;
    this.heaterEnabled = true;
    this.fault = null;
    this.readyElapsedMs = 0;
    this.steamTimeoutRemainingMs = null;
    this.uptimeMs = 0;
    this.activeExtraction = null;
    this.terminalExtraction = null;
    this.scaleCalibrationInProgress = false;
    this.terminalWeight = null;
    this.scaleWarningExtractionId = null;
    this.weightedTrace = null;
    this.extractionCounter = 0;
    this.cooldown = null;
    this.cooldownCounter = 0;
  }

  private isCooldownActive(): boolean {
    return (
      this.cooldown?.status === "pumping" ||
      this.cooldown?.status === "stabilizing"
    );
  }

  private enterCooldownStabilization(
    outcome: Exclude<CooldownOutcome, "failed">,
  ): boolean {
    const cooldown = this.cooldown;
    if (cooldown?.status !== "pumping") {
      return true;
    }
    if (!this.attemptOutputCommand("pump-off")) {
      this.abortCooldownForOutputFailure();
      return false;
    }
    cooldown.status = "stabilizing";
    cooldown.stabilizationElapsedMs = 0;
    cooldown.outcome = outcome;
    return true;
  }

  private attemptOutputCommand(command: SimulatedOutputCommand): boolean {
    if (!this.failNextOutputCommands.delete(command)) {
      return true;
    }
    return false;
  }

  private abortCooldownForOutputFailure(): void {
    this.attemptOutputCommand("pump-off");
    this.attemptOutputCommand("heater-off");
    this.fault = {
      code: "internal_error",
      message: "A simulated cooldown output command failed.",
    };
    this.readyElapsedMs = 0;
    this.failCooldown();
  }

  private failCooldown(): void {
    const cooldown = this.cooldown;
    if (cooldown === null || cooldown.status === "terminal") {
      return;
    }
    cooldown.status = "terminal";
    cooldown.outcome = "failed";
  }
}

function profileDurationMs(profile: ExtractionProfile | null): number {
  if (profile === null) {
    throw new Error("A profile extraction requires a profile snapshot.");
  }
  return (
    (profile.preInfusionSeconds +
      profile.soakSeconds +
      profile.mainExtractionSeconds) *
    1_000
  );
}

function sameSelection(
  left: ExtractionSelection,
  right: ExtractionSelection,
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === "manual" ||
      (right.kind === "profile" && left.profileId === right.profileId))
  );
}

function sameStart(
  leftSelection: ExtractionSelection,
  leftWeightControl: WeightControl | null,
  rightSelection: ExtractionSelection,
  rightWeightControl: WeightControl | null,
): boolean {
  return (
    sameSelection(leftSelection, rightSelection) &&
    ((leftWeightControl === null && rightWeightControl === null) ||
      (leftWeightControl !== null &&
        rightWeightControl !== null &&
        leftWeightControl.targetWeightDecigrams ===
          rightWeightControl.targetWeightDecigrams &&
        leftWeightControl.compensationDecigrams ===
          rightWeightControl.compensationDecigrams))
  );
}

function weightCutoff(control: WeightControl): number {
  return control.targetWeightDecigrams - control.compensationDecigrams;
}

function cloneProfileSet(profiles: ProfileSet): ProfileSet {
  return ProfileSetSchema.parse(JSON.parse(JSON.stringify(profiles)));
}

function moveToward(current: number, target: number, maximumDelta: number): number {
  if (current < target) {
    return Math.min(target, current + maximumDelta);
  }
  return Math.max(target, current - maximumDelta);
}

function machineOperatingMode(
  temperatureC: number,
  targetC: number,
): "warmup" | "idle_stable" {
  return Math.abs(temperatureC - targetC) <= READY_BAND_C
    ? "idle_stable"
    : "warmup";
}

function roundTemperature(value: number): number {
  return Math.round(value * 10) / 10;
}

function simulatorBootId(counter: number): string {
  return counter.toString(16).padStart(32, "0");
}
