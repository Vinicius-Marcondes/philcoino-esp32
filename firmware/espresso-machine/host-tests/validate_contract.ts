import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ApiErrorResponseSchema,
  HealthResponseSchema,
  MachineStateV4Schema,
} from "../../../packages/protocol/src/schemas.ts";

const directory = process.argv[2];
if (!directory) {
  throw new Error("Usage: bun validate_contract.ts <capture-directory>");
}

const captures = [
  ["health-v4.json", HealthResponseSchema],
  ["state-brew-v4.json", MachineStateV4Schema],
  ["settings-v4.json", MachineStateV4Schema],
  ["heater-disabled-v4.json", MachineStateV4Schema],
  ["extraction-running-v4.json", MachineStateV4Schema],
  ["extraction-stopped-v4.json", MachineStateV4Schema],
  ["boiler-calibration-active-v4.json", MachineStateV4Schema],
  ["steam-calibration-active-v4.json", MachineStateV4Schema],
  ["state-steam-over-temperature-v4.json", MachineStateV4Schema],
  ["unauthorized-v4.json", ApiErrorResponseSchema],
] as const;

for (const [filename, schema] of captures) {
  const payload: unknown = JSON.parse(
    await readFile(join(directory, filename), "utf8"),
  );
  schema.parse(payload);
}

console.log(`Validated ${captures.length} API v4 firmware response captures.`);
