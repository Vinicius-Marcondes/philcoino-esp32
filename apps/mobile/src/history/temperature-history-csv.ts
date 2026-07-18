import type { TemperatureHistorySample } from "./temperature-history";

const CSV_HEADERS = [
  "recorded_at_utc",
  "device_id",
  "machine_uptime_ms",
  "boiler_temperature_c",
  "brew_target_c",
  "steam_target_c",
  "active_mode",
  "active_target_c",
  "heater_enabled",
  "heater_active",
  "machine_status",
  "fault_code",
] as const;

export function temperatureHistoryToCsv(
  samples: TemperatureHistorySample[],
): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const sample of samples) {
    lines.push(
      [
        new Date(sample.recordedAtMs).toISOString(),
        sample.deviceId,
        sample.uptimeMs,
        sample.boilerTemperatureC,
        sample.brewTargetC,
        sample.steamTargetC,
        sample.activeMode,
        sample.activeTargetC,
        sample.heaterEnabled,
        sample.heaterActive,
        sample.machineStatus,
        sample.faultCode ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

function csvCell(value: boolean | number | string): string {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
