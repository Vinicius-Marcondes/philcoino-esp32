#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "philcoino/prediction_config.hpp"

namespace philcoino::control {

enum class PredictionOperatingMode : std::uint8_t {
  kWarmup = 0,
  kIdleStable = 1,
  kBrewing = 2,
  kPostBrewRecovery = 3,
  kFault = 4,
};

enum class PredictionRunMode : std::uint8_t { kDisabled, kPassive };

enum class PredictionFallbackReason : std::uint8_t {
  kNone,
  kModelInvalid,
  kHistoryImmature,
  kSensorInvalid,
  kTimingInvalid,
  kSlopeImplausible,
  kInputOutOfBounds,
  kPredictionNonFinite,
  kPredictionImplausible,
  kControllerFault,
};

const char* prediction_operating_mode_name(PredictionOperatingMode mode);
const char* prediction_run_mode_name(PredictionRunMode mode);
const char* prediction_fallback_reason_name(PredictionFallbackReason reason);

struct PredictionFeatures {
  float temperature_filtered_c{0.0F};
  float target_temperature_c{0.0F};
  float temperature_error_c{0.0F};
  float temperature_slope_c_per_s{0.0F};
  float temperature_acceleration_c_per_s2{0.0F};
  float heat_5s{0.0F};
  float heat_15s{0.0F};
  float heat_30s{0.0F};
  float pump_5s{0.0F};
  float pump_15s{0.0F};
  float baseline_heater_duty{0.0F};
  PredictionOperatingMode operating_mode{PredictionOperatingMode::kWarmup};
};

struct PredictionDiagnostics {
  PredictionRunMode run_mode{PredictionRunMode::kDisabled};
  PredictionFallbackReason fallback_reason{
      PredictionFallbackReason::kModelInvalid};
  bool usable{false};
  float temperature_raw_c{0.0F};
  PredictionFeatures features{};
  float predicted_temperature_5s_c{0.0F};
  float predicted_temperature_10s_c{0.0F};
  float predicted_temperature_20s_c{0.0F};
  float predicted_peak_c{0.0F};
  float hypothetical_correction_duty{0.0F};
  float hypothetical_heater_duty{0.0F};
  float commanded_heater_duty_1s{0.0F};
  std::uint32_t model_version{0};
  std::uint32_t feature_schema_version{0};
  std::uint32_t training_data_hash{0};
};

struct PredictionInput {
  bool sensor_valid{false};
  bool controller_fault{false};
  float temperature_raw_c{0.0F};
  float active_temperature_offset_c{0.0F};
  float target_temperature_c{0.0F};
  float baseline_heater_duty{0.0F};
  bool heater_command_active{false};
  bool pump_command_active{false};
  PredictionOperatingMode operating_mode{PredictionOperatingMode::kWarmup};
  std::uint32_t now_ms{0};
};

std::uint32_t temperature_prediction_checksum(
    const config::TemperaturePredictionConfig& configuration);
bool temperature_prediction_config_is_valid(
    const config::TemperaturePredictionConfig& configuration);

class PredictiveTemperatureMonitor {
 public:
  explicit PredictiveTemperatureMonitor(
      const config::TemperaturePredictionConfig& configuration);

  void reset();
  PredictionDiagnostics update(const PredictionInput& input);
  const PredictionDiagnostics& diagnostics() const { return diagnostics_; }

 private:
  struct CommandInterval {
    std::uint32_t ended_at_ms{0};
    std::uint32_t duration_ms{0};
    bool heater_active{false};
    bool pump_active{false};
  };

  struct TemperatureSample {
    std::uint32_t at_ms{0};
    float temperature_c{0.0F};
    float slope_c_per_s{0.0F};
    bool slope_valid{false};
  };

  static constexpr std::size_t kCommandHistoryCapacity = 128;
  static constexpr std::size_t kTemperatureHistoryCapacity = 16;

  void reset_histories();
  void append_command_interval(const CommandInterval& interval);
  void append_temperature_sample(const TemperatureSample& sample);
  float command_activity_seconds(std::uint32_t window_ms,
                                 bool heater) const;
  bool calculate_slope(std::uint32_t now_ms, float temperature_c,
                       float& slope) const;
  bool calculate_acceleration(std::uint32_t now_ms, float slope,
                              float& acceleration) const;
  float predict(const config::LinearTemperatureModel& model,
                const std::array<float,
                                 config::kTemperaturePredictionFeatureCount>&
                    features) const;

  const config::TemperaturePredictionConfig& configuration_;
  bool configuration_valid_{false};
  bool initialized_{false};
  bool filter_initialized_{false};
  std::uint32_t previous_update_ms_{0};
  float filtered_raw_temperature_c_{0.0F};
  std::array<CommandInterval, kCommandHistoryCapacity> command_history_{};
  std::size_t command_history_start_{0};
  std::size_t command_history_count_{0};
  std::array<TemperatureSample, kTemperatureHistoryCapacity>
      temperature_history_{};
  std::size_t temperature_history_start_{0};
  std::size_t temperature_history_count_{0};
  PredictionDiagnostics diagnostics_{};
};

}  // namespace philcoino::control
