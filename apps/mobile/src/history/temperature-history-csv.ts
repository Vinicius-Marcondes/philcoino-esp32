import type { TemperatureHistorySample } from "./temperature-history";

export const TEMPERATURE_HISTORY_CSV_HEADER = [
  "recorded_at_utc",
  "device_id",
  "machine_uptime_ms",
  "boiler_temperature_c",
  "brew_target_c",
  "steam_target_c",
  "active_mode",
  "active_target_c",
  "steam_control_temperature_c",
  "steam_applied_compensation_c",
  "steam_compensation_active",
  "steam_heat_soak_elapsed_ms",
  "heater_enabled",
  "heater_active",
  "pump_command",
  "machine_status",
  "fault_code",
].join(",");

export function temperatureHistoryCsvRow(
  sample: TemperatureHistorySample,
): string {
  return [
    new Date(sample.recordedAtMs).toISOString(),
    sample.deviceId,
    sample.uptimeMs,
    sample.boilerTemperatureC,
    sample.brewTargetC,
    sample.steamTargetC,
    sample.activeMode,
    sample.activeTargetC,
    sample.steamControl?.controlTemperatureC ?? "",
    sample.steamControl?.appliedCompensationC ?? "",
    sample.steamControl?.compensationActive ?? "",
    sample.steamControl?.heatSoakElapsedMs ?? "",
    sample.heaterEnabled,
    sample.heaterActive,
    sample.pumpCommand ?? "",
    sample.machineStatus,
    sample.faultCode ?? "",
  ].map(csvCell).join(",");
}

export function temperatureHistoryToCsv(
  samples: TemperatureHistorySample[],
): string {
  return `${[
    TEMPERATURE_HISTORY_CSV_HEADER,
    ...samples.map(temperatureHistoryCsvRow),
  ].join("\r\n")}\r\n`;
}

function csvCell(value: boolean | number | string): string {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
