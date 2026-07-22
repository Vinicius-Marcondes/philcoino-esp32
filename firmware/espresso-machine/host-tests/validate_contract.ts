import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DeviceResponseSchema,
  ErrorResponseSchema,
  ApiV2ErrorResponseSchema,
  CooldownActiveConflictResponseSchema,
  HeaterSettingsResponseSchema,
  HealthResponseSchema,
  HistoryPageSchema,
  MachineStateSchema,
  MachineStateWithPredictionV2Schema,
  MachineStateV2Schema,
  ModeResponseSchema,
  ProfileSetSchema,
  ExtractionActiveConflictResponseSchema,
  StartExtractionResponseSchema,
  StopExtractionResponseSchema,
  StartCooldownResponseSchema,
  StopCooldownResponseSchema,
  TemperatureSettingsResponseSchema,
} from "../../../packages/protocol/src/schemas.ts";

const directory = process.argv[2];
if (!directory) {
  throw new Error("Usage: bun validate_contract.ts <capture-directory>");
}

const captures = [
  ["health.json", HealthResponseSchema],
  ["device.json", DeviceResponseSchema],
  ["state.json", MachineStateSchema],
  ["state-steam.json", MachineStateSchema],
  ["state-fault.json", MachineStateSchema],
  ["temperatures-response.json", TemperatureSettingsResponseSchema],
  ["mode-response.json", ModeResponseSchema],
  ["heater-response.json", HeaterSettingsResponseSchema],
  ["error.json", ErrorResponseSchema],
  ["state-v2.json", MachineStateV2Schema],
  ["state-prediction-v2.json", MachineStateWithPredictionV2Schema],
  ["history-v2.json", HistoryPageSchema],
  ["profiles-v2.json", ProfileSetSchema],
  ["extraction-running-v2.json", StartExtractionResponseSchema],
  ["extraction-conflict-v2.json", ExtractionActiveConflictResponseSchema],
  ["extraction-idle-v2.json", StopExtractionResponseSchema],
  ["state-compensation-v2.json", MachineStateV2Schema],
  ["cooldown-start-v2.json", StartCooldownResponseSchema],
  ["cooldown-replay-v2.json", StartCooldownResponseSchema],
  ["cooldown-conflict-v2.json", CooldownActiveConflictResponseSchema],
  ["cooldown-stop-v2.json", StopCooldownResponseSchema],
  ["state-cooldown-v2.json", MachineStateV2Schema],
  ["cooldown-terminal-v2.json", StartCooldownResponseSchema],
  ["state-cooldown-after-extraction-v2.json", MachineStateV2Schema],
  ["state-extraction-after-cooldown-v2.json", MachineStateV2Schema],
  ["cooldown-not-required-v2.json", ApiV2ErrorResponseSchema],
  ["cooldown-sensor-unavailable-v2.json", ApiV2ErrorResponseSchema],
  ["cooldown-machine-faulted-v2.json", ApiV2ErrorResponseSchema],
  ["brew-mode-required-v2.json", ApiV2ErrorResponseSchema],
  ["state-cooldown-failed-v2.json", MachineStateV2Schema],
  ["state-cooldown-failed-running-v2.json", MachineStateV2Schema],
] as const;

for (const [filename, schema] of captures) {
  const payload: unknown = JSON.parse(await readFile(join(directory, filename), "utf8"));
  schema.parse(payload);
}

console.log(`Validated ${captures.length} firmware response captures.`);
