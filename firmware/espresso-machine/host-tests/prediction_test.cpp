#include <cassert>
#include <cmath>
#include <limits>

#include "philcoino/prediction.hpp"
#include "philcoino/prediction_config.hpp"

namespace {

using namespace philcoino::control;

bool close(float left, float right, float tolerance = 0.0001F) {
  return std::fabs(left - right) <= tolerance;
}

PredictionInput input(std::uint32_t now_ms, float temperature_c,
                      bool heater = false, bool pump = false) {
  return {
      true,
      false,
      temperature_c,
      0.0F,
      93.0F,
      0.6F,
      heater,
      pump,
      PredictionOperatingMode::kWarmup,
      now_ms,
  };
}

void test_production_configuration_is_versioned_and_valid() {
  const auto& configuration =
      philcoino::config::kTemperaturePredictionConfig;
  assert(configuration.model_version == 1U);
  assert(configuration.feature_schema_version == 1U);
  assert(temperature_prediction_checksum(configuration) ==
         configuration.expected_checksum);
  assert(temperature_prediction_config_is_valid(configuration));
}

void test_filter_history_prediction_and_command_integrals() {
  PredictiveTemperatureMonitor monitor(
      philcoino::config::kTemperaturePredictionConfig);
  PredictionDiagnostics result{};
  for (std::uint32_t now_ms = 0; now_ms <= 30000U; now_ms += 500U) {
    const float temperature = 88.0F + static_cast<float>(now_ms) / 10000.0F;
    result = monitor.update(input(now_ms, temperature, true, now_ms >= 25000U));
  }

  assert(result.usable);
  assert(result.run_mode == PredictionRunMode::kPassive);
  assert(result.fallback_reason == PredictionFallbackReason::kNone);
  assert(close(result.features.heat_5s, 5.0F));
  assert(close(result.features.heat_15s, 15.0F));
  assert(close(result.features.heat_30s, 30.0F));
  assert(close(result.features.pump_5s, 5.0F));
  assert(close(result.commanded_heater_duty_1s, 1.0F));
  assert(close(result.predicted_temperature_5s_c,
               result.features.temperature_filtered_c +
                   5.0F * result.features.temperature_slope_c_per_s));
  assert(close(result.predicted_temperature_10s_c,
               result.features.temperature_filtered_c +
                   10.0F * result.features.temperature_slope_c_per_s));
  assert(close(result.predicted_temperature_20s_c,
               result.features.temperature_filtered_c +
                   20.0F * result.features.temperature_slope_c_per_s));
  assert(result.hypothetical_heater_duty <=
         result.features.baseline_heater_duty);
}

void mature(PredictiveTemperatureMonitor& monitor, float start_temperature_c,
            float rise_c_per_s = 0.0F) {
  for (std::uint32_t now_ms = 0; now_ms <= 30000U; now_ms += 500U) {
    monitor.update(input(
        now_ms,
        start_temperature_c +
            rise_c_per_s * static_cast<float>(now_ms) / 1000.0F,
        true));
  }
}

void test_hypothetical_hard_cutoff_only_reduces_baseline() {
  PredictiveTemperatureMonitor monitor(
      philcoino::config::kTemperaturePredictionConfig);
  PredictionDiagnostics result{};
  for (std::uint32_t now_ms = 0; now_ms <= 30000U; now_ms += 500U) {
    result = monitor.update(input(
        now_ms, 90.0F + static_cast<float>(now_ms) / 10000.0F, true));
  }

  assert(result.usable);
  assert(result.predicted_peak_c > result.features.target_temperature_c);
  assert(close(result.hypothetical_correction_duty,
               result.features.baseline_heater_duty));
  assert(close(result.hypothetical_heater_duty, 0.0F));
}

void test_history_maturity_and_timing_reset() {
  PredictiveTemperatureMonitor monitor(
      philcoino::config::kTemperaturePredictionConfig);
  auto result = monitor.update(input(0U, 90.0F));
  assert(!result.usable);
  assert(result.fallback_reason == PredictionFallbackReason::kHistoryImmature);

  result = monitor.update(input(2000U, 90.0F));
  assert(!result.usable);
  assert(result.fallback_reason == PredictionFallbackReason::kTimingInvalid);

  result = monitor.update(input(2500U, 90.0F));
  assert(!result.usable);
  assert(result.fallback_reason == PredictionFallbackReason::kHistoryImmature);
}

void test_invalid_inputs_fall_back_without_a_correction() {
  PredictiveTemperatureMonitor monitor(
      philcoino::config::kTemperaturePredictionConfig);
  auto invalid_sensor = input(0U, 90.0F);
  invalid_sensor.sensor_valid = false;
  auto result = monitor.update(invalid_sensor);
  assert(!result.usable);
  assert(result.fallback_reason == PredictionFallbackReason::kSensorInvalid);
  assert(close(result.hypothetical_correction_duty, 0.0F));

  auto invalid_configuration =
      philcoino::config::kTemperaturePredictionConfig;
  invalid_configuration.horizon_5s.coefficients[0] =
      std::numeric_limits<float>::infinity();
  PredictiveTemperatureMonitor disabled(invalid_configuration);
  result = disabled.update(input(0U, 90.0F));
  assert(!result.usable);
  assert(result.run_mode == PredictionRunMode::kDisabled);
  assert(result.fallback_reason == PredictionFallbackReason::kModelInvalid);

  invalid_configuration = philcoino::config::kTemperaturePredictionConfig;
  invalid_configuration.model_version = 2U;
  invalid_configuration.expected_checksum =
      temperature_prediction_checksum(invalid_configuration);
  assert(!temperature_prediction_config_is_valid(invalid_configuration));
}

void test_runtime_sanity_fallbacks_are_specific() {
  PredictiveTemperatureMonitor controller_fault(
      philcoino::config::kTemperaturePredictionConfig);
  auto fault_input = input(0U, 90.0F);
  fault_input.controller_fault = true;
  auto result = controller_fault.update(fault_input);
  assert(result.fallback_reason == PredictionFallbackReason::kControllerFault);

  PredictiveTemperatureMonitor out_of_bounds(
      philcoino::config::kTemperaturePredictionConfig);
  mature(out_of_bounds, 90.0F);
  auto bounds_input = input(30500U, 90.0F);
  bounds_input.target_temperature_c = 121.0F;
  result = out_of_bounds.update(bounds_input);
  assert(result.fallback_reason ==
         PredictionFallbackReason::kInputOutOfBounds);

  auto slope_configuration = philcoino::config::kTemperaturePredictionConfig;
  slope_configuration.maximum_absolute_slope_c_per_s = 1.0F;
  slope_configuration.expected_checksum =
      temperature_prediction_checksum(slope_configuration);
  PredictiveTemperatureMonitor implausible_slope(slope_configuration);
  PredictionDiagnostics slope_result{};
  for (std::uint32_t now_ms = 0; now_ms <= 30000U; now_ms += 500U) {
    slope_result = implausible_slope.update(
        input(now_ms, now_ms < 27000U ? 90.0F : 160.0F, true));
  }
  assert(slope_result.fallback_reason ==
         PredictionFallbackReason::kSlopeImplausible);

  auto non_finite_configuration =
      philcoino::config::kTemperaturePredictionConfig;
  non_finite_configuration.horizon_5s.coefficients[0] =
      std::numeric_limits<float>::max();
  non_finite_configuration.expected_checksum =
      temperature_prediction_checksum(non_finite_configuration);
  PredictiveTemperatureMonitor non_finite(non_finite_configuration);
  mature(non_finite, 90.0F);
  result = non_finite.update(input(30500U, 90.0F));
  assert(result.fallback_reason ==
         PredictionFallbackReason::kPredictionNonFinite);

  auto implausible_configuration =
      philcoino::config::kTemperaturePredictionConfig;
  implausible_configuration.horizon_5s.intercept = 100.0F;
  implausible_configuration.expected_checksum =
      temperature_prediction_checksum(implausible_configuration);
  PredictiveTemperatureMonitor implausible(implausible_configuration);
  mature(implausible, 90.0F);
  result = implausible.update(input(30500U, 90.0F));
  assert(result.fallback_reason ==
         PredictionFallbackReason::kPredictionImplausible);
}

}  // namespace

int main() {
  test_production_configuration_is_versioned_and_valid();
  test_filter_history_prediction_and_command_integrals();
  test_hypothetical_hard_cutoff_only_reduces_baseline();
  test_history_maturity_and_timing_reset();
  test_invalid_inputs_fall_back_without_a_correction();
  test_runtime_sanity_fallbacks_are_specific();
  return 0;
}
