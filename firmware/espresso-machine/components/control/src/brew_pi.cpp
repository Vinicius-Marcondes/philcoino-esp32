#include "philcoino/brew_pi.hpp"

#include <algorithm>
#include <cmath>

#include "philcoino/config.hpp"

namespace philcoino::control {
namespace {

bool finite(float value) { return std::isfinite(value); }

float clamp_duty(float value) {
  if (!finite(value)) return 0.0F;
  return std::clamp(value, 0.0F, 1.0F);
}

}  // namespace

BrewPiConfig default_brew_pi_config() {
  return {
      config::kBrewPiKp,
      config::kBrewPiKi,
      config::kBrewPiFilterAlpha,
      config::kBrewPiIntegralMinimum,
      config::kBrewPiIntegralMaximum,
      config::kTemperatureControllerIntervalMs,
  };
}

const char* selected_controller_name(SelectedController controller) {
  return controller == SelectedController::kPi ? "pi" : "legacy_curve";
}

const char* pi_saturation_name(PiSaturation saturation) {
  switch (saturation) {
    case PiSaturation::kNone: return "none";
    case PiSaturation::kLower: return "lower";
    case PiSaturation::kUpper: return "upper";
  }
  return "none";
}

BrewPiController::BrewPiController(BrewPiConfig configuration)
    : configuration_(configuration),
      configuration_valid_(valid_configuration()) {}

bool BrewPiController::valid_configuration() const {
  return finite(configuration_.kp) && configuration_.kp >= 0.0F &&
         configuration_.kp <= 16.0F && finite(configuration_.ki) &&
         configuration_.ki >= 0.0F && configuration_.ki <= 16.0F &&
         finite(configuration_.filter_alpha) &&
         configuration_.filter_alpha > 0.0F &&
         configuration_.filter_alpha <= 1.0F &&
         finite(configuration_.integral_min) &&
         finite(configuration_.integral_max) &&
         configuration_.integral_min < configuration_.integral_max &&
         configuration_.integral_min >= -10000.0F &&
         configuration_.integral_max <= 10000.0F &&
         configuration_.interval_ms == 500U;
}

void BrewPiController::reset() {
  diagnostics_ = {};
  initialized_ = false;
  last_update_ms_ = 0;
  filtered_temperature_c_ = 0.0F;
  integral_state_ = 0.0F;
}

BrewPiDiagnostics BrewPiController::fail_reset(float temperature_c,
                                               float target_c) {
  reset();
  if (finite(temperature_c) && finite(target_c)) {
    diagnostics_.filtered_temperature_c = temperature_c;
    diagnostics_.error_c = target_c - temperature_c;
  }
  return diagnostics_;
}

BrewPiDiagnostics BrewPiController::calculate(float filtered_temperature_c,
                                              float private_target_c,
                                              bool integrate) {
  BrewPiDiagnostics next{};
  next.valid = true;
  next.filtered_temperature_c = filtered_temperature_c;
  next.error_c = private_target_c - filtered_temperature_c;
  next.proportional_contribution = configuration_.kp * next.error_c;

  const float dt_seconds =
      static_cast<float>(configuration_.interval_ms) / 1000.0F;
  const float candidate_integral = std::clamp(
      integral_state_ + next.error_c * dt_seconds,
      configuration_.integral_min, configuration_.integral_max);
  const float candidate_output =
      next.proportional_contribution + configuration_.ki * candidate_integral;
  const bool drives_upper = candidate_output > 1.0F && next.error_c > 0.0F;
  const bool drives_lower = candidate_output < 0.0F && next.error_c < 0.0F;

  next.integration_frozen = !integrate;
  if (integrate && !drives_upper && !drives_lower) {
    integral_state_ = candidate_integral;
  } else if (integrate && (drives_upper || drives_lower)) {
    next.anti_windup_active = true;
  }

  next.integral_state = integral_state_;
  next.integral_contribution = configuration_.ki * integral_state_;
  const float raw_output =
      next.proportional_contribution + next.integral_contribution;
  next.saturation = raw_output > 1.0F
                        ? PiSaturation::kUpper
                        : raw_output < 0.0F ? PiSaturation::kLower
                                           : PiSaturation::kNone;
  next.requested_duty = clamp_duty(raw_output);

  if (!finite(next.error_c) ||
      !finite(next.proportional_contribution) ||
      !finite(next.integral_contribution) ||
      !finite(next.integral_state)) {
    return fail_reset(filtered_temperature_c, private_target_c);
  }
  diagnostics_ = next;
  return diagnostics_;
}

BrewPiDiagnostics BrewPiController::update(const BrewPiInput& input) {
  if (!configuration_valid_ || !input.sensor_valid ||
      !finite(input.temperature_c) || !finite(input.private_target_c)) {
    return fail_reset(input.temperature_c, input.private_target_c);
  }

  if (!initialized_) {
    initialized_ = true;
    last_update_ms_ = input.now_ms;
    filtered_temperature_c_ = input.temperature_c;
    return calculate(filtered_temperature_c_, input.private_target_c, false);
  }

  const auto elapsed_ms =
      static_cast<std::uint32_t>(input.now_ms - last_update_ms_);
  if (elapsed_ms != configuration_.interval_ms) {
    return fail_reset(input.temperature_c, input.private_target_c);
  }

  last_update_ms_ = input.now_ms;
  filtered_temperature_c_ =
      configuration_.filter_alpha * input.temperature_c +
      (1.0F - configuration_.filter_alpha) * filtered_temperature_c_;
  return calculate(filtered_temperature_c_, input.private_target_c,
                   !input.inhibited);
}

}  // namespace philcoino::control
