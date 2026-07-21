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
  "temperature_raw_c",
  "temperature_filtered_c",
  "prediction_active_target_c",
  "temperature_slope_c_per_s",
  "temperature_acceleration_c_per_s2",
  "baseline_heater_duty",
  "heater_command_duty",
  "commanded_heater_duty_1s",
  "heat_5s",
  "heat_15s",
  "heat_30s",
  "pump_5s",
  "pump_15s",
  "predicted_temperature_5s_c",
  "predicted_temperature_10s_c",
  "predicted_temperature_20s_c",
  "predicted_peak_c",
  "hypothetical_correction_duty",
  "hypothetical_heater_duty",
  "prediction_operating_mode",
  "prediction_run_mode",
  "prediction_usable",
  "prediction_fallback_reason",
  "prediction_model_version",
  "prediction_feature_schema_version",
  "prediction_training_data_hash",
] as const;

export function temperatureHistoryToCsv(
  samples: TemperatureHistorySample[],
): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const sample of samples) {
    const prediction = sample.predictiveTemperature;
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
        prediction?.temperatureRawC ?? "",
        prediction?.temperatureFilteredC ?? "",
        prediction?.activeTargetC ?? "",
        prediction?.temperatureSlopeCPerS ?? "",
        prediction?.temperatureAccelerationCPerS2 ?? "",
        prediction?.baselineHeaterDuty ?? "",
        prediction?.heaterCommandDuty ?? "",
        prediction?.commandedHeaterDuty1s ?? "",
        prediction?.heat5s ?? "",
        prediction?.heat15s ?? "",
        prediction?.heat30s ?? "",
        prediction?.pump5s ?? "",
        prediction?.pump15s ?? "",
        prediction?.predictedTemperature5sC ?? "",
        prediction?.predictedTemperature10sC ?? "",
        prediction?.predictedTemperature20sC ?? "",
        prediction?.predictedPeakC ?? "",
        prediction?.hypotheticalCorrectionDuty ?? "",
        prediction?.hypotheticalHeaterDuty ?? "",
        prediction?.operatingMode ?? "",
        prediction?.runMode ?? "",
        prediction?.usable ?? "",
        prediction?.fallbackReason ?? "",
        prediction?.modelVersion ?? "",
        prediction?.featureSchemaVersion ?? "",
        prediction?.trainingDataHash ?? "",
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
