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
  MachineStateSchema,
  MachineStateV2Schema,
  ProfileSetSchema,
  RunningExtractionStateSchema,
  STEAM_TARGET_MAX_C,
  STEAM_TARGET_MIN_C,
  STEAM_TIMEOUT_MS,
  TemperatureSettingsResponseSchema,
  type DeviceResponse,
  type ActiveCooldownState,
  type CompensationState,
  type CooldownOutcome,
  type CooldownState,
  type Fault,
  type FaultCode,
  type HealthResponse,
  type HeaterSettingsResponse,
  type MachineState,
  type MachineStateV2,
  type Mode,
  type OverTemperatureDismissResponse,
  type TemperatureSettingsRequest,
  type TemperatureSettingsResponse,
  type ExtractionProfile,
  type ExtractionSelection,
  type ExtractionState,
  type ProfileSet,
  type RunningExtractionState,
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
  | { ok: true; extraction: RunningExtractionState }
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
  | { ok: false; reason: "brew-mode-required" | "profile-not-configured" };

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

  getProfiles(): ProfileSet {
    return cloneProfileSet(this.profiles);
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
  ): StartExtractionResult {
    const current = this.getExtractionState();
    if (current.status === "running") {
      if (this.activeExtraction?.idempotencyKey === idempotencyKey) {
        return { ok: true, extraction: current };
      }
      return {
        ok: false,
        reason: "active",
        activeExtraction: current,
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

    this.extractionCounter += 1;
    this.activeExtraction = {
      elapsedMs: 0,
      extractionId: `sim-run-${this.extractionCounter}`,
      idempotencyKey,
      profile: profile === null ? null : { ...profile },
      selection,
    };
    return {
      ok: true,
      extraction: RunningExtractionStateSchema.parse(this.getExtractionState()),
    };
  }

  stopExtraction(): ExtractionState {
    this.activeExtraction = null;
    return this.getExtractionState();
  }

  getExtractionState(): ExtractionState {
    if (this.activeExtraction === null) {
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
      remainingMs: totalMs - active.elapsedMs,
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
    const extraction = this.getExtractionState();
    if (extraction.status === "running") {
      return {
        ok: false,
        reason: "extraction-active",
        activeExtraction: extraction,
      };
    }

    const current = this.getCooldownState();
    if (this.cooldown?.idempotencyKey === idempotencyKey) {
      return { ok: true, cooldown: current };
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
      const stepMs = Math.min(
        remainingMs,
        MAX_SIMULATION_STEP_MS,
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
  }

  private advanceExtraction(milliseconds: number): void {
    if (this.activeExtraction === null) {
      return;
    }
    const durationMs =
      this.activeExtraction.selection.kind === "manual"
        ? MANUAL_EXTRACTION_CUTOFF_MS
        : profileDurationMs(this.activeExtraction.profile);
    const nextElapsedMs = this.activeExtraction.elapsedMs + milliseconds;
    if (nextElapsedMs >= durationMs) {
      this.activeExtraction = null;
      return;
    }
    this.activeExtraction.elapsedMs = nextElapsedMs;
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
    this.activeMode = "brew";
    this.boilerTemperatureC = AMBIENT_TEMPERATURE_C;
    this.heaterEnabled = true;
    this.fault = null;
    this.readyElapsedMs = 0;
    this.steamTimeoutRemainingMs = null;
    this.uptimeMs = 0;
    this.activeExtraction = null;
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

function cloneProfileSet(profiles: ProfileSet): ProfileSet {
  return ProfileSetSchema.parse(JSON.parse(JSON.stringify(profiles)));
}

function moveToward(current: number, target: number, maximumDelta: number): number {
  if (current < target) {
    return Math.min(target, current + maximumDelta);
  }
  return Math.max(target, current - maximumDelta);
}

function roundTemperature(value: number): number {
  return Math.round(value * 10) / 10;
}
