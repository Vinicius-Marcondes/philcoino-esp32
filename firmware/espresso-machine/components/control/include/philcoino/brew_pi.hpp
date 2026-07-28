#pragma once

#include <cstdint>

namespace philcoino::control {

enum class SelectedController { kLegacyCurve, kPi };
enum class PiSaturation { kNone, kLower, kUpper };

struct BrewPiConfig {
  float kp{0.0F};
  float ki{0.0F};
  float filter_alpha{1.0F};
  float integral_min{-1.0F};
  float integral_max{1.0F};
  std::uint32_t interval_ms{500U};
};

struct BrewPiInput {
  bool sensor_valid{false};
  bool inhibited{true};
  float temperature_c{0.0F};
  float private_target_c{0.0F};
  std::uint32_t now_ms{0};
};

struct BrewPiDiagnostics {
  bool valid{false};
  float filtered_temperature_c{0.0F};
  float error_c{0.0F};
  float requested_duty{0.0F};
  float proportional_contribution{0.0F};
  float integral_contribution{0.0F};
  float integral_state{0.0F};
  PiSaturation saturation{PiSaturation::kNone};
  bool anti_windup_active{false};
  bool integration_frozen{false};
};

BrewPiConfig default_brew_pi_config();
const char* selected_controller_name(SelectedController controller);
const char* pi_saturation_name(PiSaturation saturation);

class BrewPiController {
 public:
  explicit BrewPiController(
      BrewPiConfig configuration = default_brew_pi_config());

  BrewPiDiagnostics update(const BrewPiInput& input);
  void reset();
  const BrewPiDiagnostics& diagnostics() const { return diagnostics_; }
  const BrewPiConfig& configuration() const { return configuration_; }
  bool configuration_valid() const { return configuration_valid_; }

 private:
  bool valid_configuration() const;
  BrewPiDiagnostics fail_reset(float temperature_c, float target_c);
  BrewPiDiagnostics calculate(float filtered_temperature_c,
                              float private_target_c,
                              bool integrate);

  BrewPiConfig configuration_{};
  BrewPiDiagnostics diagnostics_{};
  bool configuration_valid_{false};
  bool initialized_{false};
  std::uint32_t last_update_ms_{0};
  float filtered_temperature_c_{0.0F};
  float integral_state_{0.0F};
};

}  // namespace philcoino::control
