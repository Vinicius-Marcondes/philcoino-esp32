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
  "pump_active",
  "machine_status",
  "fault_code",
  "controller_firmware_version",
  "controller_selected",
  "controller_pi_kp",
  "controller_pi_ki",
  "controller_filter_alpha",
  "controller_interval_ms",
  "ssr_window_ms",
  "temperature_raw_c",
  "temperature_filtered_c",
  "controller_base_target_c",
  "controller_private_target_c",
  "controller_error_c",
  "legacy_requested_duty",
  "pi_requested_duty",
  "pi_proportional_contribution",
  "pi_integral_contribution",
  "pi_integral_state",
  "pi_saturation",
  "pi_anti_windup_active",
  "heater_command_active",
  "delivered_command_duty_1s",
  "pump_command",
  "extraction_phase",
  "controller_operating_mode",
] as const;

export function temperatureHistoryToCsv(
  samples: TemperatureHistorySample[],
): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const sample of samples) {
    const configuration = sample.controllerConfiguration;
    const diagnostics = sample.controllerDiagnostics;
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
        sample.pumpActive ?? "",
        sample.machineStatus,
        sample.faultCode ?? "",
        configuration?.firmwareVersion ?? "",
        configuration?.selectedController ?? "",
        configuration?.piKp ?? "",
        configuration?.piKi ?? "",
        configuration?.filterAlpha ?? "",
        configuration?.controllerIntervalMs ?? "",
        configuration?.ssrWindowMs ?? "",
        diagnostics?.temperatureRawC ?? "",
        diagnostics?.temperatureFilteredC ?? "",
        diagnostics?.baseTargetC ?? "",
        diagnostics?.privateTargetC ?? "",
        diagnostics?.errorC ?? "",
        diagnostics?.legacyRequestedDuty ?? "",
        diagnostics?.piRequestedDuty ?? "",
        diagnostics?.proportionalContribution ?? "",
        diagnostics?.integralContribution ?? "",
        diagnostics?.integralState ?? "",
        diagnostics?.piSaturation ?? "",
        diagnostics?.piAntiWindupActive ?? "",
        diagnostics?.heaterCommandActive ?? "",
        diagnostics?.deliveredCommandDuty1s ?? "",
        diagnostics?.pumpCommand ?? "",
        diagnostics?.extractionPhase ?? "",
        diagnostics?.operatingMode ?? "",
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
