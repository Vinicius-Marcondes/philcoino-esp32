import type {
  CompensationState,
  CooldownState,
  HeaterSettingsRequest,
  MachineState,
  ModeRequest,
  ScaleTraceResponse,
  StartCooldownRequest,
  TemperatureSettingsRequest,
  WeightedExtractionTraceCursor,
} from "../src/index.ts";

const brewUpdate: TemperatureSettingsRequest = { brewTargetC: 93 };
const steamUpdate: TemperatureSettingsRequest = { steamTargetC: 115 };
const bothUpdate: TemperatureSettingsRequest = {
  brewTargetC: 93,
  steamTargetC: 115,
};
const modeUpdate: ModeRequest = { mode: "steam" };
const heaterUpdate: HeaterSettingsRequest = { heaterEnabled: false };
const traceCursor: WeightedExtractionTraceCursor = {
  extractionId: "run-1",
  bootId: "00112233445566778899aabbccddeeff",
  afterSequence: 2,
};
const scaleTrace: ScaleTraceResponse = {
  scale: {
    availability: "ready",
    calibrationStatus: "calibrated",
    stable: false,
    grossWeightDecigrams: 910,
    netWeightDecigrams: 110,
    activeExtraction: {
      extractionId: "run-1",
      mode: "weight",
      targetWeightDecigrams: 350,
      compensationDecigrams: 20,
      cutoffWeightDecigrams: 330,
      netWeightDecigrams: 110,
    },
    terminalExtraction: null,
    warning: null,
  },
  trace: null,
};
const cooldownStart: StartCooldownRequest = {
  idempotencyKey: "cooldown-01J2ABCDEF1",
};
const compensation: CompensationState = {
  status: "active",
  phase: "manual",
};
const cooldown: CooldownState = {
  status: "pumping",
  cooldownId: "cooldown-184220",
  brewTargetC: 93,
  elapsedMs: 12_000,
  remainingMs: 33_000,
  pumpCommand: "running",
  heaterInhibited: true,
  outcome: null,
};
const faultState: MachineState = {
  status: "fault",
  activeMode: "brew",
  boilerTemperatureC: 24.5,
  brewTargetC: 93,
  steamTargetC: 115,
  heaterEnabled: false,
  heaterActive: false,
  fault: {
    code: "sensor_failure",
    message: "The boiler thermocouple reading is unavailable.",
  },
  steamTimeoutRemainingMs: null,
  steamControl: {
    settings: {
      initialCompensationC: 12,
      decayDurationMs: 720_000,
      readyTimeoutMs: 300_000,
    },
    compensationActive: false,
    appliedCompensationC: 0,
    controlTemperatureC: null,
    heatSoakElapsedMs: null,
  },
  uptimeMs: 185000,
};

// @ts-expect-error A temperature update must contain at least one target.
const emptyUpdate: TemperatureSettingsRequest = {};

// @ts-expect-error Remote off mode is outside the v1 safety boundary.
const invalidMode: ModeRequest = { mode: "off" };

void [
  brewUpdate,
  steamUpdate,
  bothUpdate,
  modeUpdate,
  heaterUpdate,
  traceCursor,
  scaleTrace,
  cooldownStart,
  compensation,
  cooldown,
  faultState,
  emptyUpdate,
  invalidMode,
];
