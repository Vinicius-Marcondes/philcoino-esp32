import type {
  HeaterSettingsRequest,
  MachineState,
  ModeRequest,
  TemperatureSettingsRequest,
} from "../src/index.ts";

const brewUpdate: TemperatureSettingsRequest = { brewTargetC: 93 };
const steamUpdate: TemperatureSettingsRequest = { steamTargetC: 115 };
const bothUpdate: TemperatureSettingsRequest = {
  brewTargetC: 93,
  steamTargetC: 115,
};
const modeUpdate: ModeRequest = { mode: "steam" };
const heaterUpdate: HeaterSettingsRequest = { heaterEnabled: false };
const faultState: MachineState = {
  status: "fault",
  activeMode: "brew",
  brewTemperatureC: 24.5,
  steamTemperatureC: 24.7,
  brewTargetC: 93,
  steamTargetC: 115,
  heaterEnabled: false,
  heaterActive: false,
  fault: {
    code: "sensor_failure",
    message: "Brew thermocouple is unavailable.",
  },
  steamTimeoutRemainingMs: null,
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
  faultState,
  emptyUpdate,
  invalidMode,
];
