#include <cassert>
#include <cmath>
#include <cstdint>
#include <vector>

#include "philcoino/config.hpp"
#include "philcoino/control.hpp"
#include "philcoino/peripherals.hpp"

namespace {

using namespace philcoino::control;
using namespace philcoino::peripherals;

class FakeDigitalOutput final : public DigitalOutput {
 public:
  bool set_level(bool high) override {
    if (fail_write) return false;
    level = high;
    events.push_back(high);
    return true;
  }
  bool configure_output() override { return true; }
  bool level{false};
  bool fail_write{false};
  std::vector<bool> events{};
};

class FakeSafetyLease final : public SsrSafetyLease {
 public:
  bool initialize() override { return true; }
  bool arm(std::uint32_t) override { return !tripped_; }
  bool disarm() override { return true; }
  bool tripped() const override { return tripped_; }
  bool tripped_{false};
};

class FakeCriticalSection final : public OutputCriticalSection {
 public:
  void enter() override { assert(!entered); entered = true; }
  void exit() override { assert(entered); entered = false; }
  bool entered{false};
};

ThermocoupleReading reading(float temperature_c) {
  return {ThermocoupleStatus::kOk, temperature_c, 0};
}

struct Harness {
  explicit Harness(BrewPiConfig pi = default_brew_pi_config())
      : ssr(output, lease, critical), controller({93, 115}, ssr, pi) {
    assert(ssr.initialize());
  }
  FakeDigitalOutput output{};
  FakeSafetyLease lease{};
  FakeCriticalSection critical{};
  FailOffSsr ssr;
  TemperatureController controller;
};

void test_build_flag_selects_only_brew_duty_authority() {
  const BrewPiConfig zero_pi{0.0F, 0.0F, 1.0F, -10.0F, 10.0F, 500U};
  Harness brew(zero_pi);
  const auto snapshot =
      brew.controller.update(reading(85.0F), PumpCommand::kOff, 1000U);

  if (philcoino::config::kBrewPiControlEnabled) {
    assert(snapshot.controller.selected_controller == SelectedController::kPi);
    assert(snapshot.controller.legacy_requested_duty == 1.0F);
    assert(snapshot.controller.pi_requested_duty == 0.0F);
    assert(!snapshot.heater_enabled);
  } else {
    assert(snapshot.controller.selected_controller ==
           SelectedController::kLegacyCurve);
    assert(snapshot.controller.legacy_requested_duty == 1.0F);
    assert(snapshot.controller.pi_requested_duty == 0.0F);
    assert(snapshot.heater_enabled);
  }

  assert(brew.controller.set_mode(ControlMode::kSteam, 1500U));
  const auto steam =
      brew.controller.update(reading(100.0F), PumpCommand::kOff, 2000U);
  assert(steam.mode == ControlMode::kSteam);
  assert(steam.heater_enabled);
  assert(std::fabs(steam.boiler_temperature.temperature_c - 105.0F) <
         0.0001F);
}

void test_shadow_pi_cannot_change_legacy_trace_or_state() {
  if (philcoino::config::kBrewPiControlEnabled) return;

  Harness zero({0.0F, 0.0F, 1.0F, -10.0F, 10.0F, 500U});
  Harness aggressive({16.0F, 16.0F, 1.0F, -100.0F, 100.0F, 500U});
  for (std::uint32_t now_ms = 1000U; now_ms <= 15000U; now_ms += 500U) {
    const float temperature_c =
        now_ms < 8000U ? 84.0F + static_cast<float>(now_ms) / 2000.0F
                       : 92.0F;
    const auto pump = now_ms >= 5000U && now_ms < 9000U
                          ? PumpCommand::kRunning
                          : PumpCommand::kOff;
    const auto zero_snapshot =
        zero.controller.update(reading(temperature_c), pump, now_ms);
    const auto aggressive_snapshot =
        aggressive.controller.update(reading(temperature_c), pump, now_ms);
    assert(zero_snapshot.heater_enabled ==
           aggressive_snapshot.heater_enabled);
    assert(zero_snapshot.status == aggressive_snapshot.status);
    assert(zero_snapshot.fault_active == aggressive_snapshot.fault_active);
    assert(zero_snapshot.steam_timeout.active ==
           aggressive_snapshot.steam_timeout.active);
  }
  assert(zero.output.events == aggressive.output.events);
}

void test_private_bias_and_fail_off_paths_dominate_pi() {
  Harness harness({1.0F, 0.0F, 1.0F, -10.0F, 10.0F, 500U});
  auto snapshot =
      harness.controller.update(reading(93.5F), PumpCommand::kOff, 1000U);
  assert(snapshot.controller.base_target_c == 93.0F);
  assert(snapshot.controller.private_target_c == 93.0F);
  assert(snapshot.controller.pi_requested_duty == 0.0F);

  harness.controller.set_extraction_phase(ExtractionPhase::kManual, 1500U);
  snapshot =
      harness.controller.update(reading(93.5F), PumpCommand::kRunning, 1500U);
  assert(snapshot.controller.base_target_c == 93.0F);
  assert(snapshot.controller.private_target_c == 95.0F);
  assert(snapshot.controller.pi_requested_duty == 1.0F);
  assert(snapshot.controller.extraction_phase == ExtractionPhase::kManual);

  harness.controller.set_extraction_phase(ExtractionPhase::kPreInfusion,
                                          2000U);
  snapshot =
      harness.controller.update(reading(93.5F), PumpCommand::kRunning, 2000U);
  assert(snapshot.controller.private_target_c == 93.0F);
  assert(snapshot.controller.pi_requested_duty == 0.0F);

  assert(harness.controller.set_heater_enabled(false, 2500U));
  snapshot =
      harness.controller.update(reading(80.0F), PumpCommand::kOff, 2500U);
  assert(!snapshot.heater_enabled);
  assert(snapshot.controller.operating_mode ==
         ControllerOperatingMode::kInhibited);

  Harness fault({1.0F, 0.0F, 1.0F, -10.0F, 10.0F, 500U});
  snapshot = fault.controller.update(
      {ThermocoupleStatus::kOpenCircuit, 0.0F, 0}, PumpCommand::kOff, 1000U);
  assert(snapshot.fault_active);
  assert(!snapshot.heater_enabled);
  assert(snapshot.controller.pi_requested_duty == 0.0F);
}

void test_target_cooldown_output_and_fault_transitions_reset_or_inhibit_pi() {
  Harness harness({0.0F, 0.5F, 1.0F, -10.0F, 10.0F, 500U});
  harness.controller.update(reading(90.0F), PumpCommand::kOff, 1000U);
  auto snapshot =
      harness.controller.update(reading(90.0F), PumpCommand::kOff, 1500U);
  assert(snapshot.controller.integral_state > 0.0F);
  const float accumulated_integral = snapshot.controller.integral_state;

  assert(harness.controller.prepare_target_update({94, 115}, 2000U));
  snapshot =
      harness.controller.update(reading(90.0F), PumpCommand::kOff, 2000U);
  assert(!snapshot.heater_enabled);
  assert(snapshot.controller.operating_mode ==
         ControllerOperatingMode::kInhibited);
  assert(snapshot.controller.integral_state == accumulated_integral);
  assert(harness.controller.adopt_persisted_targets({94, 115}, 2500U));
  snapshot =
      harness.controller.update(reading(90.0F), PumpCommand::kOff, 2500U);
  assert(snapshot.controller.integral_state == 0.0F);

  assert(harness.controller.begin_cooldown_inhibit(3000U));
  snapshot =
      harness.controller.update(reading(80.0F), PumpCommand::kRunning, 3000U);
  assert(!snapshot.heater_enabled);
  assert(snapshot.controller.operating_mode ==
         ControllerOperatingMode::kInhibited);
  assert(harness.controller.end_cooldown_inhibit(3500U));

  Harness failed_output({1.0F, 0.0F, 1.0F, -10.0F, 10.0F, 500U});
  failed_output.output.fail_write = true;
  snapshot = failed_output.controller.update(reading(80.0F),
                                             PumpCommand::kOff, 1000U);
  assert(snapshot.fault_active);
  assert(snapshot.fault.code == FaultCode::kInternalError);
  assert(!snapshot.heater_enabled);

  Harness dismissed({0.0F, 0.5F, 1.0F, -10.0F, 10.0F, 500U});
  dismissed.controller.update(reading(90.0F), PumpCommand::kOff, 1000U);
  snapshot =
      dismissed.controller.update(reading(90.0F), PumpCommand::kOff, 1500U);
  assert(snapshot.controller.integral_state > 0.0F);
  snapshot =
      dismissed.controller.update(reading(98.0F), PumpCommand::kOff, 2000U);
  assert(snapshot.fault_active);
  dismissed.controller.update(reading(93.0F), PumpCommand::kOff, 2500U);
  assert(dismissed.controller.dismiss_over_temperature(3000U));
  snapshot = dismissed.controller.snapshot(3000U);
  assert(!snapshot.fault_active);
  assert(snapshot.controller.integral_state == 0.0F);
}

}  // namespace

int main() {
  test_build_flag_selects_only_brew_duty_authority();
  test_shadow_pi_cannot_change_legacy_trace_or_state();
  test_private_bias_and_fail_off_paths_dominate_pi();
  test_target_cooldown_output_and_fault_transitions_reset_or_inhibit_pi();
  return 0;
}
