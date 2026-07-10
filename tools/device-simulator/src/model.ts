import {
  BREW_TARGET_MAX_C,
  BREW_TARGET_MIN_C,
  DeviceResponseSchema,
  HeaterSettingsResponseSchema,
  HealthResponseSchema,
  MachineStateSchema,
  STEAM_TARGET_MAX_C,
  STEAM_TARGET_MIN_C,
  STEAM_TIMEOUT_MS,
  TemperatureSettingsResponseSchema,
  type DeviceResponse,
  type Fault,
  type FaultCode,
  type HealthResponse,
  type HeaterSettingsResponse,
  type MachineState,
  type Mode,
  type OverTemperatureDismissResponse,
  type TemperatureSettingsRequest,
  type TemperatureSettingsResponse,
} from "@philcoino/protocol";

const AMBIENT_TEMPERATURE_C = 24;
const HEATING_RATE_C_PER_SECOND = 20;
const COOLING_RATE_C_PER_SECOND = 2;
const READY_BAND_C = 1;
const READY_HOLD_MS = 3_000;
const MAX_SIMULATION_STEP_MS = 100;
const BREW_OVER_TEMPERATURE_C = 98;
const STEAM_OVER_TEMPERATURE_C = 130;

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
    this.resetVolatileState();
  }

  reset(): void {
    this.brewTargetC = this.initialBrewTargetC;
    this.steamTargetC = this.initialSteamTargetC;
    this.resetVolatileState();
  }

  private advanceStep(milliseconds: number): void {
    const timeoutWasActive = this.steamTimeoutRemainingMs !== null;
    const seconds = milliseconds / 1_000;

    if (this.fault) {
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

  private advanceTemperature(seconds: number): void {
    const target = this.activeTarget();
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
    if (this.fault || !this.heaterEnabled) {
      return false;
    }

    return this.boilerTemperatureC < this.activeTarget();
  }

  private activeTemperatureBackAtTarget(): boolean {
    return this.boilerTemperatureC <= this.activeTarget();
  }

  private activeTarget(): number {
    return this.activeMode === "brew" ? this.brewTargetC : this.steamTargetC;
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
  }
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
