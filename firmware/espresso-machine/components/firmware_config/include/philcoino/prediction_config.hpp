#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace philcoino::config {

inline constexpr std::size_t kTemperaturePredictionFeatureCount = 11;

struct LinearTemperatureModel {
  float intercept{0.0F};
  std::array<float, kTemperaturePredictionFeatureCount> coefficients{};
};

struct TemperaturePredictionBounds {
  std::array<float, kTemperaturePredictionFeatureCount> minimum{};
  std::array<float, kTemperaturePredictionFeatureCount> maximum{};
};

struct TemperaturePredictionConfig {
  std::uint32_t model_version{0};
  std::uint32_t feature_schema_version{0};
  std::uint32_t training_data_hash{0};
  std::uint32_t expected_checksum{0};
  float filter_alpha{0.25F};
  float prediction_deadband_c{0.2F};
  float prediction_gain_per_c{0.25F};
  float hard_cutoff_margin_c{0.3F};
  float activation_band_c{8.0F};
  float maximum_absolute_slope_c_per_s{10.0F};
  float maximum_prediction_delta_c{30.0F};
  float recovery_stable_slope_c_per_s{0.05F};
  std::uint32_t minimum_sample_interval_ms{250};
  std::uint32_t maximum_sample_interval_ms{1000};
  TemperaturePredictionBounds bounds{};
  LinearTemperatureModel horizon_5s{};
  LinearTemperatureModel horizon_10s{};
  LinearTemperatureModel horizon_20s{};
};

// Manually supplied prototype coefficients. This deliberately conservative,
// passive-only seed model extrapolates the filtered three-second slope. It is
// not evidence of thermal accuracy and must be replaced by validated,
// traceable coefficients before predictive heater correction is considered.
inline constexpr TemperaturePredictionConfig kTemperaturePredictionConfig{
    1U,
    1U,
    0x50524F54U,
    0xBAD68DD7U,
    0.25F,
    0.2F,
    0.25F,
    0.3F,
    8.0F,
    10.0F,
    30.0F,
    0.05F,
    250U,
    1000U,
    {{{0.0F, 85.0F, -75.0F, -10.0F, 0.0F, 0.0F, 0.0F, 0.0F,
       0.0F, 0.0F, 0.0F}},
     {{160.0F, 120.0F, 120.0F, 10.0F, 5.0F, 15.0F, 30.0F, 5.0F,
       15.0F, 1.0F, 4.0F}}},
    {0.0F, {{1.0F, 0.0F, 0.0F, 5.0F, 0.0F, 0.0F, 0.0F, 0.0F,
             0.0F, 0.0F, 0.0F}}},
    {0.0F, {{1.0F, 0.0F, 0.0F, 10.0F, 0.0F, 0.0F, 0.0F, 0.0F,
             0.0F, 0.0F, 0.0F}}},
    {0.0F, {{1.0F, 0.0F, 0.0F, 20.0F, 0.0F, 0.0F, 0.0F, 0.0F,
             0.0F, 0.0F, 0.0F}}},
};

}  // namespace philcoino::config
