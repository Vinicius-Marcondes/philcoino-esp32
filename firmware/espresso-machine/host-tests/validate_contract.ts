import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DeviceResponseSchema,
  ErrorResponseSchema,
  HeaterSettingsResponseSchema,
  HealthResponseSchema,
  MachineStateSchema,
  MachineStateV2Schema,
  ModeResponseSchema,
  ProfileSetSchema,
  ExtractionActiveConflictResponseSchema,
  StartExtractionResponseSchema,
  StopExtractionResponseSchema,
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
  ["state-fault.json", MachineStateSchema],
  ["temperatures-response.json", TemperatureSettingsResponseSchema],
  ["mode-response.json", ModeResponseSchema],
  ["heater-response.json", HeaterSettingsResponseSchema],
  ["error.json", ErrorResponseSchema],
  ["state-v2.json", MachineStateV2Schema],
  ["profiles-v2.json", ProfileSetSchema],
  ["extraction-running-v2.json", StartExtractionResponseSchema],
  ["extraction-conflict-v2.json", ExtractionActiveConflictResponseSchema],
  ["extraction-idle-v2.json", StopExtractionResponseSchema],
] as const;

for (const [filename, schema] of captures) {
  const payload: unknown = JSON.parse(await readFile(join(directory, filename), "utf8"));
  schema.parse(payload);
}

console.log(`Validated ${captures.length} firmware response captures.`);
