#include "philcoino/prediction.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace philcoino::control {
namespace {

constexpr std::uint32_t kExpectedFeatureSchemaVersion = 1U;
constexpr std::uint32_t kExpectedModelVersion = 1U;

void checksum_u32(std::uint32_t value, std::uint32_t& checksum) {
  for (unsigned shift = 0; shift < 32; shift += 8) {
    checksum ^= (value >> shift) & 0xFFU;
    checksum *= 16777619U;
  }
}

void checksum_float(float value, std::uint32_t& checksum) {
  std::uint32_t bits = 0;
  static_assert(sizeof(bits) == sizeof(value));
  std::memcpy(&bits, &value, sizeof(bits));
  checksum_u32(bits, checksum);
}

bool finite_model(const config::LinearTemperatureModel& model) {
  if (!std::isfinite(model.intercept)) return false;
  return std::all_of(model.coefficients.begin(), model.coefficients.end(),
                     [](float value) { return std::isfinite(value); });
}

}  // namespace

const char* prediction_operating_mode_name(PredictionOperatingMode mode) {
  switch (mode) {
    case PredictionOperatingMode::kWarmup: return "warmup";
    case PredictionOperatingMode::kIdleStable: return "idle_stable";
    case PredictionOperatingMode::kBrewing: return "brewing";
    case PredictionOperatingMode::kPostBrewRecovery:
      return "post_brew_recovery";
    case PredictionOperatingMode::kFault: return "fault";
  }
  return "fault";
}

const char* prediction_run_mode_name(PredictionRunMode mode) {
  return mode == PredictionRunMode::kPassive ? "passive" : "disabled";
}

const char* prediction_fallback_reason_name(PredictionFallbackReason reason) {
  switch (reason) {
    case PredictionFallbackReason::kNone: return "none";
    case PredictionFallbackReason::kModelInvalid: return "model_invalid";
    case PredictionFallbackReason::kHistoryImmature: return "history_immature";
    case PredictionFallbackReason::kSensorInvalid: return "sensor_invalid";
    case PredictionFallbackReason::kTimingInvalid: return "timing_invalid";
    case PredictionFallbackReason::kSlopeImplausible:
      return "slope_implausible";
    case PredictionFallbackReason::kInputOutOfBounds:
      return "input_out_of_bounds";
    case PredictionFallbackReason::kPredictionNonFinite:
      return "prediction_non_finite";
    case PredictionFallbackReason::kPredictionImplausible:
      return "prediction_implausible";
    case PredictionFallbackReason::kControllerFault: return "controller_fault";
  }
  return "model_invalid";
}

std::uint32_t temperature_prediction_checksum(
    const config::TemperaturePredictionConfig& configuration) {
  std::uint32_t checksum = 2166136261U;
  checksum_u32(configuration.model_version, checksum);
  checksum_u32(configuration.feature_schema_version, checksum);
  checksum_u32(configuration.training_data_hash, checksum);
  checksum_float(configuration.filter_alpha, checksum);
  checksum_float(configuration.prediction_deadband_c, checksum);
  checksum_float(configuration.prediction_gain_per_c, checksum);
  checksum_float(configuration.hard_cutoff_margin_c, checksum);
  checksum_float(configuration.activation_band_c, checksum);
  checksum_float(configuration.maximum_absolute_slope_c_per_s, checksum);
  checksum_float(configuration.maximum_prediction_delta_c, checksum);
  checksum_float(configuration.recovery_stable_slope_c_per_s, checksum);
  checksum_u32(configuration.minimum_sample_interval_ms, checksum);
  checksum_u32(configuration.maximum_sample_interval_ms, checksum);
  for (float value : configuration.bounds.minimum) checksum_float(value, checksum);
  for (float value : configuration.bounds.maximum) checksum_float(value, checksum);
  const config::LinearTemperatureModel* models[] = {
      &configuration.horizon_5s,
      &configuration.horizon_10s,
      &configuration.horizon_20s,
  };
  for (const auto* model : models) {
    checksum_float(model->intercept, checksum);
    for (float value : model->coefficients) checksum_float(value, checksum);
  }
  return checksum;
}

bool temperature_prediction_config_is_valid(
    const config::TemperaturePredictionConfig& configuration) {
  if (configuration.model_version != kExpectedModelVersion ||
      configuration.feature_schema_version != kExpectedFeatureSchemaVersion ||
      configuration.expected_checksum == 0U ||
      temperature_prediction_checksum(configuration) !=
          configuration.expected_checksum ||
      !std::isfinite(configuration.filter_alpha) ||
      configuration.filter_alpha <= 0.0F ||
      configuration.filter_alpha > 1.0F ||
      configuration.minimum_sample_interval_ms == 0U ||
      configuration.minimum_sample_interval_ms >
          configuration.maximum_sample_interval_ms ||
      !finite_model(configuration.horizon_5s) ||
      !finite_model(configuration.horizon_10s) ||
      !finite_model(configuration.horizon_20s)) {
    return false;
  }
  for (std::size_t i = 0; i < config::kTemperaturePredictionFeatureCount;
       ++i) {
    if (!std::isfinite(configuration.bounds.minimum[i]) ||
        !std::isfinite(configuration.bounds.maximum[i]) ||
        configuration.bounds.minimum[i] > configuration.bounds.maximum[i]) {
      return false;
    }
  }
  return std::isfinite(configuration.prediction_deadband_c) &&
         configuration.prediction_deadband_c >= 0.0F &&
         std::isfinite(configuration.prediction_gain_per_c) &&
         configuration.prediction_gain_per_c >= 0.0F &&
         std::isfinite(configuration.hard_cutoff_margin_c) &&
         configuration.hard_cutoff_margin_c >= 0.0F &&
         std::isfinite(configuration.activation_band_c) &&
         configuration.activation_band_c >= 0.0F &&
         std::isfinite(configuration.maximum_absolute_slope_c_per_s) &&
         configuration.maximum_absolute_slope_c_per_s > 0.0F &&
         std::isfinite(configuration.maximum_prediction_delta_c) &&
         configuration.maximum_prediction_delta_c > 0.0F &&
         std::isfinite(configuration.recovery_stable_slope_c_per_s) &&
         configuration.recovery_stable_slope_c_per_s >= 0.0F;
}

PredictiveTemperatureMonitor::PredictiveTemperatureMonitor(
    const config::TemperaturePredictionConfig& configuration)
    : configuration_(configuration),
      configuration_valid_(
          temperature_prediction_config_is_valid(configuration)) {
  reset();
}

void PredictiveTemperatureMonitor::reset_histories() {
  command_history_start_ = 0;
  command_history_count_ = 0;
  temperature_history_start_ = 0;
  temperature_history_count_ = 0;
}

void PredictiveTemperatureMonitor::reset() {
  initialized_ = false;
  filter_initialized_ = false;
  previous_update_ms_ = 0;
  filtered_raw_temperature_c_ = 0.0F;
  reset_histories();
  diagnostics_ = {};
  diagnostics_.run_mode = configuration_valid_ ? PredictionRunMode::kPassive
                                                : PredictionRunMode::kDisabled;
  diagnostics_.fallback_reason =
      configuration_valid_ ? PredictionFallbackReason::kHistoryImmature
                           : PredictionFallbackReason::kModelInvalid;
  diagnostics_.model_version = configuration_.model_version;
  diagnostics_.feature_schema_version = configuration_.feature_schema_version;
  diagnostics_.training_data_hash = configuration_.training_data_hash;
}

void PredictiveTemperatureMonitor::append_command_interval(
    const CommandInterval& interval) {
  const auto index =
      (command_history_start_ + command_history_count_) %
      kCommandHistoryCapacity;
  if (command_history_count_ == kCommandHistoryCapacity) {
    command_history_[command_history_start_] = interval;
    command_history_start_ =
        (command_history_start_ + 1U) % kCommandHistoryCapacity;
  } else {
    command_history_[index] = interval;
    ++command_history_count_;
  }
}

void PredictiveTemperatureMonitor::append_temperature_sample(
    const TemperatureSample& sample) {
  const auto index =
      (temperature_history_start_ + temperature_history_count_) %
      kTemperatureHistoryCapacity;
  if (temperature_history_count_ == kTemperatureHistoryCapacity) {
    temperature_history_[temperature_history_start_] = sample;
    temperature_history_start_ =
        (temperature_history_start_ + 1U) % kTemperatureHistoryCapacity;
  } else {
    temperature_history_[index] = sample;
    ++temperature_history_count_;
  }
}

float PredictiveTemperatureMonitor::command_activity_seconds(
    std::uint32_t window_ms, bool heater) const {
  if (!initialized_) return 0.0F;
  const auto window_start = previous_update_ms_ - window_ms;
  std::uint64_t active_ms = 0;
  for (std::size_t i = 0; i < command_history_count_; ++i) {
    const auto& interval = command_history_[
        (command_history_start_ + i) % kCommandHistoryCapacity];
    if (heater ? !interval.heater_active : !interval.pump_active) continue;
    const auto interval_start = interval.ended_at_ms - interval.duration_ms;
    const auto age_at_start =
        static_cast<std::uint32_t>(previous_update_ms_ - interval_start);
    const auto age_at_end =
        static_cast<std::uint32_t>(previous_update_ms_ - interval.ended_at_ms);
    if (age_at_end >= window_ms) continue;
    const auto included_start = age_at_start > window_ms ? window_start
                                                          : interval_start;
    active_ms += static_cast<std::uint32_t>(interval.ended_at_ms - included_start);
  }
  return static_cast<float>(active_ms) / 1000.0F;
}

bool PredictiveTemperatureMonitor::calculate_slope(std::uint32_t now_ms,
                                                   float temperature_c,
                                                   float& slope) const {
  for (std::size_t i = 0; i < temperature_history_count_; ++i) {
    const auto& sample = temperature_history_[
        (temperature_history_start_ + i) % kTemperatureHistoryCapacity];
    const auto elapsed_ms = static_cast<std::uint32_t>(now_ms - sample.at_ms);
    if (elapsed_ms >= 3000U) {
      slope = (temperature_c - sample.temperature_c) /
              (static_cast<float>(elapsed_ms) / 1000.0F);
      return std::isfinite(slope);
    }
  }
  return false;
}

bool PredictiveTemperatureMonitor::calculate_acceleration(
    std::uint32_t now_ms, float slope, float& acceleration) const {
  for (std::size_t i = 0; i < temperature_history_count_; ++i) {
    const auto& sample = temperature_history_[
        (temperature_history_start_ + i) % kTemperatureHistoryCapacity];
    const auto elapsed_ms = static_cast<std::uint32_t>(now_ms - sample.at_ms);
    if (sample.slope_valid && elapsed_ms >= 3000U) {
      acceleration = (slope - sample.slope_c_per_s) /
                     (static_cast<float>(elapsed_ms) / 1000.0F);
      return std::isfinite(acceleration);
    }
  }
  return false;
}

float PredictiveTemperatureMonitor::predict(
    const config::LinearTemperatureModel& model,
    const std::array<float, config::kTemperaturePredictionFeatureCount>&
        features) const {
  float result = model.intercept;
  for (std::size_t i = 0; i < features.size(); ++i) {
    result += model.coefficients[i] * features[i];
  }
  return result;
}

PredictionDiagnostics PredictiveTemperatureMonitor::update(
    const PredictionInput& input) {
  diagnostics_ = {};
  diagnostics_.run_mode = configuration_valid_ ? PredictionRunMode::kPassive
                                                : PredictionRunMode::kDisabled;
  diagnostics_.fallback_reason = configuration_valid_
                                     ? PredictionFallbackReason::kHistoryImmature
                                     : PredictionFallbackReason::kModelInvalid;
  diagnostics_.temperature_raw_c = input.temperature_raw_c;
  diagnostics_.features.target_temperature_c = input.target_temperature_c;
  diagnostics_.features.baseline_heater_duty = input.baseline_heater_duty;
  diagnostics_.features.operating_mode = input.operating_mode;
  diagnostics_.hypothetical_heater_duty = input.baseline_heater_duty;
  diagnostics_.model_version = configuration_.model_version;
  diagnostics_.feature_schema_version = configuration_.feature_schema_version;
  diagnostics_.training_data_hash = configuration_.training_data_hash;

  if (!configuration_valid_) return diagnostics_;

  if (initialized_) {
    const auto interval_ms =
        static_cast<std::uint32_t>(input.now_ms - previous_update_ms_);
    if (interval_ms < configuration_.minimum_sample_interval_ms ||
        interval_ms > configuration_.maximum_sample_interval_ms) {
      reset_histories();
      filter_initialized_ = false;
      initialized_ = false;
      diagnostics_.fallback_reason = PredictionFallbackReason::kTimingInvalid;
      return diagnostics_;
    }
    // The controller samples the acknowledged command immediately before it
    // computes the next command, so these values describe the interval ending
    // at now_ms rather than the following interval.
    append_command_interval({input.now_ms, interval_ms,
                             input.heater_command_active,
                             input.pump_command_active});
  }

  initialized_ = true;
  previous_update_ms_ = input.now_ms;

  if (!input.sensor_valid || !std::isfinite(input.temperature_raw_c) ||
      !std::isfinite(input.active_temperature_offset_c)) {
    filter_initialized_ = false;
    temperature_history_start_ = 0;
    temperature_history_count_ = 0;
    diagnostics_.fallback_reason = PredictionFallbackReason::kSensorInvalid;
    return diagnostics_;
  }
  if (input.controller_fault) {
    diagnostics_.fallback_reason = PredictionFallbackReason::kControllerFault;
    return diagnostics_;
  }

  if (!filter_initialized_) {
    filtered_raw_temperature_c_ = input.temperature_raw_c;
    filter_initialized_ = true;
  } else {
    filtered_raw_temperature_c_ =
        configuration_.filter_alpha * input.temperature_raw_c +
        (1.0F - configuration_.filter_alpha) * filtered_raw_temperature_c_;
  }
  const float filtered_active_c =
      filtered_raw_temperature_c_ + input.active_temperature_offset_c;
  diagnostics_.features.temperature_filtered_c = filtered_active_c;
  diagnostics_.features.temperature_error_c =
      input.target_temperature_c - filtered_active_c;

  float slope = 0.0F;
  const bool slope_valid = calculate_slope(input.now_ms, filtered_active_c, slope);
  diagnostics_.features.temperature_slope_c_per_s = slope;
  float acceleration = 0.0F;
  if (slope_valid) calculate_acceleration(input.now_ms, slope, acceleration);
  diagnostics_.features.temperature_acceleration_c_per_s2 = acceleration;
  append_temperature_sample({input.now_ms, filtered_active_c, slope, slope_valid});

  diagnostics_.features.heat_5s = command_activity_seconds(5000U, true);
  diagnostics_.features.heat_15s = command_activity_seconds(15000U, true);
  diagnostics_.features.heat_30s = command_activity_seconds(30000U, true);
  diagnostics_.features.pump_5s = command_activity_seconds(5000U, false);
  diagnostics_.features.pump_15s = command_activity_seconds(15000U, false);
  diagnostics_.commanded_heater_duty_1s =
      command_activity_seconds(1000U, true);

  if (!slope_valid || diagnostics_.features.heat_30s < 0.0F ||
      command_history_count_ == 0U ||
      static_cast<std::uint32_t>(
          input.now_ms - command_history_[command_history_start_].ended_at_ms +
          command_history_[command_history_start_].duration_ms) < 30000U) {
    return diagnostics_;
  }
  if (std::fabs(slope) > configuration_.maximum_absolute_slope_c_per_s) {
    diagnostics_.fallback_reason = PredictionFallbackReason::kSlopeImplausible;
    return diagnostics_;
  }

  const std::array<float, config::kTemperaturePredictionFeatureCount> values{{
      filtered_active_c,
      input.target_temperature_c,
      input.target_temperature_c - filtered_active_c,
      slope,
      diagnostics_.features.heat_5s,
      diagnostics_.features.heat_15s,
      diagnostics_.features.heat_30s,
      diagnostics_.features.pump_5s,
      diagnostics_.features.pump_15s,
      input.baseline_heater_duty,
      static_cast<float>(input.operating_mode),
  }};
  for (std::size_t i = 0; i < values.size(); ++i) {
    if (!std::isfinite(values[i]) || values[i] < configuration_.bounds.minimum[i] ||
        values[i] > configuration_.bounds.maximum[i]) {
      diagnostics_.fallback_reason = PredictionFallbackReason::kInputOutOfBounds;
      return diagnostics_;
    }
  }

  diagnostics_.predicted_temperature_5s_c =
      predict(configuration_.horizon_5s, values);
  diagnostics_.predicted_temperature_10s_c =
      predict(configuration_.horizon_10s, values);
  diagnostics_.predicted_temperature_20s_c =
      predict(configuration_.horizon_20s, values);
  const float predictions[] = {diagnostics_.predicted_temperature_5s_c,
                               diagnostics_.predicted_temperature_10s_c,
                               diagnostics_.predicted_temperature_20s_c};
  for (float value : predictions) {
    if (!std::isfinite(value)) {
      diagnostics_.fallback_reason =
          PredictionFallbackReason::kPredictionNonFinite;
      return diagnostics_;
    }
    if (value < 0.0F || value > 160.0F ||
        std::fabs(value - filtered_active_c) >
            configuration_.maximum_prediction_delta_c) {
      diagnostics_.fallback_reason =
          PredictionFallbackReason::kPredictionImplausible;
      return diagnostics_;
    }
  }

  diagnostics_.predicted_peak_c =
      std::max({predictions[0], predictions[1], predictions[2]});
  diagnostics_.hypothetical_heater_duty = input.baseline_heater_duty;
  if (filtered_active_c >=
      input.target_temperature_c - configuration_.activation_band_c) {
    const float overshoot_risk =
        diagnostics_.predicted_peak_c - input.target_temperature_c;
    if (overshoot_risk > configuration_.prediction_deadband_c) {
      diagnostics_.hypothetical_correction_duty =
          std::min(input.baseline_heater_duty,
                   configuration_.prediction_gain_per_c * overshoot_risk);
      diagnostics_.hypothetical_heater_duty =
          input.baseline_heater_duty -
          diagnostics_.hypothetical_correction_duty;
    }
    if (diagnostics_.predicted_peak_c >=
        input.target_temperature_c + configuration_.hard_cutoff_margin_c) {
      diagnostics_.hypothetical_correction_duty = input.baseline_heater_duty;
      diagnostics_.hypothetical_heater_duty = 0.0F;
    }
  }
  diagnostics_.hypothetical_heater_duty = std::clamp(
      diagnostics_.hypothetical_heater_duty, 0.0F, input.baseline_heater_duty);
  diagnostics_.usable = true;
  diagnostics_.fallback_reason = PredictionFallbackReason::kNone;
  return diagnostics_;
}

}  // namespace philcoino::control
