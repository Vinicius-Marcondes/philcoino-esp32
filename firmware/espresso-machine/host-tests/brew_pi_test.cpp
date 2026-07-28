#include <cassert>
#include <cmath>
#include <limits>

#include "philcoino/brew_pi.hpp"

namespace {

using namespace philcoino::control;

bool near(float left, float right, float tolerance = 0.0001F) {
  return std::fabs(left - right) <= tolerance;
}

void test_fixed_interval_arithmetic_and_filtering() {
  BrewPiController controller({0.5F, 0.2F, 0.5F, -10.0F, 10.0F, 500U});
  auto result = controller.update({true, false, 90.0F, 91.0F, 1000U});
  assert(result.valid);
  assert(near(result.filtered_temperature_c, 90.0F));
  assert(near(result.proportional_contribution, 0.5F));
  assert(near(result.integral_state, 0.0F));
  assert(near(result.requested_duty, 0.5F));
  assert(result.integration_frozen);

  result = controller.update({true, false, 90.5F, 91.0F, 1500U});
  assert(result.valid);
  assert(near(result.filtered_temperature_c, 90.25F));
  assert(near(result.error_c, 0.75F));
  assert(near(result.integral_state, 0.375F));
  assert(near(result.proportional_contribution, 0.375F));
  assert(near(result.integral_contribution, 0.075F));
  assert(near(result.requested_duty, 0.45F));
}

void test_conditional_anti_windup_in_both_directions() {
  BrewPiController upper({2.0F, 1.0F, 1.0F, -10.0F, 10.0F, 500U});
  upper.update({true, false, 90.0F, 91.0F, 0U});
  const auto upper_result =
      upper.update({true, false, 90.0F, 91.0F, 500U});
  assert(upper_result.saturation == PiSaturation::kUpper);
  assert(upper_result.anti_windup_active);
  assert(near(upper_result.integral_state, 0.0F));
  assert(near(upper_result.requested_duty, 1.0F));

  BrewPiController lower({2.0F, 1.0F, 1.0F, -10.0F, 10.0F, 500U});
  lower.update({true, false, 91.0F, 90.0F, 0U});
  const auto lower_result =
      lower.update({true, false, 91.0F, 90.0F, 500U});
  assert(lower_result.saturation == PiSaturation::kLower);
  assert(lower_result.anti_windup_active);
  assert(near(lower_result.integral_state, 0.0F));
  assert(near(lower_result.requested_duty, 0.0F));
}

void test_freeze_reset_bounds_and_invalid_inputs() {
  BrewPiController controller({0.0F, 1.0F, 1.0F, -0.2F, 0.2F, 500U});
  controller.update({true, false, 90.0F, 91.0F, 100U});
  auto result = controller.update({true, false, 90.0F, 91.0F, 600U});
  assert(near(result.integral_state, 0.2F));
  assert(near(result.requested_duty, 0.2F));

  result = controller.update({true, true, 89.0F, 91.0F, 1100U});
  assert(result.valid && result.integration_frozen);
  assert(near(result.integral_state, 0.2F));

  result = controller.update({true, false, 89.0F, 91.0F, 1900U});
  assert(!result.valid);
  assert(near(result.requested_duty, 0.0F));
  result = controller.update({true, false, 89.0F, 91.0F, 2400U});
  assert(result.valid);
  assert(near(result.integral_state, 0.0F));

  result = controller.update(
      {true, false, std::numeric_limits<float>::quiet_NaN(), 91.0F, 2900U});
  assert(!result.valid);
  controller.reset();
  assert(!controller.diagnostics().valid);
  assert(near(controller.diagnostics().integral_state, 0.0F));
}

void test_invalid_configuration_fails_closed() {
  BrewPiController invalid({0.1F, 0.1F, 0.0F, -1.0F, 1.0F, 500U});
  assert(!invalid.configuration_valid());
  const auto result =
      invalid.update({true, false, 90.0F, 93.0F, 500U});
  assert(!result.valid);
  assert(near(result.requested_duty, 0.0F));
}

}  // namespace

int main() {
  test_fixed_interval_arithmetic_and_filtering();
  test_conditional_anti_windup_in_both_directions();
  test_freeze_reset_bounds_and_invalid_inputs();
  test_invalid_configuration_fails_closed();
  return 0;
}
