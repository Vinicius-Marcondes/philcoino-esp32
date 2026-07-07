#include <cassert>
#include <cstdint>
#include <vector>

#include "philcoino/config.hpp"
#include "philcoino/control.hpp"
#include "philcoino/peripherals.hpp"

namespace {

using namespace philcoino::control;
using namespace philcoino::peripherals;

struct MemoryState {
  bool present{true};
  bool fail_load{false};
  bool fail_save{false};
  int save_count{0};
  TemperatureTargets targets{};
};

class MemoryBackend final : public TargetBackend {
 public:
  explicit MemoryBackend(MemoryState& state) : state_(state) {}

  BackendLoadResult load(TemperatureTargets& targets) override {
    if (state_.fail_load) {
      return BackendLoadResult::kError;
    }
    if (!state_.present) {
      return BackendLoadResult::kNotFound;
    }
    targets = state_.targets;
    return BackendLoadResult::kOk;
  }

  bool save(const TemperatureTargets& targets) override {
    if (state_.fail_save) {
      return false;
    }
    state_.targets = targets;
    state_.present = true;
    ++state_.save_count;
    return true;
  }

 private:
  MemoryState& state_;
};

class FakeDigitalOutput final : public DigitalOutput {
 public:
  bool set_level(bool high) override {
    level = high;
    events.push_back(high);
    if (high && fail_high) {
      return false;
    }
    if (!high && fail_low) {
      return false;
    }
    return true;
  }

  bool configure_output() override {
    configured = true;
    return !fail_configure;
  }

  std::vector<bool> events{};
  bool level{true};
  bool configured{false};
  bool fail_low{false};
  bool fail_high{false};
  bool fail_configure{false};
};

ThermocoupleReading ok(float temperature_c) {
  return {ThermocoupleStatus::kOk, temperature_c, 0};
}

ThermocoupleReadings readings(float brew_c, float steam_c) {
  return {ok(brew_c), ok(steam_c)};
}

ThermocoupleReadings open_steam(float brew_c) {
  ThermocoupleReadings value{};
  value.brew = ok(brew_c);
  value.steam.status = ThermocoupleStatus::kOpenCircuit;
  return value;
}

struct ControllerHarness {
  explicit ControllerHarness(TemperatureTargets targets = {})
      : controller(targets, ssr) {
    assert(ssr.initialize());
  }

  FakeDigitalOutput output{};
  FailOffSsr ssr{output};
  TemperatureController controller;
};

void test_boot_selects_brew_and_keeps_targets() {
  MemoryState state;
  state.targets = {95, 120};
  MemoryBackend backend(state);
  TargetStorage storage(backend);
  TemperatureTargets loaded{};
  assert(storage.load(loaded) == TargetLoadResult::kOk);
  assert(state.save_count == 0);

  ControllerHarness harness(loaded);
  assert(harness.controller.mode() == ControlMode::kBrew);
  assert(harness.controller.targets().brew_c == 95);
  assert(harness.controller.targets().steam_c == 120);
  assert(!harness.controller.has_fault());
  assert(state.save_count == 0);
}

void test_ready_requires_three_continuous_seconds() {
  ControllerHarness harness({93, 115});

  auto snapshot = harness.controller.update(readings(92.0F, 100.0F), 1000);
  assert(snapshot.status == ControlStatus::kHeating);
  snapshot = harness.controller.update(readings(92.0F, 100.0F), 3999);
  assert(snapshot.status == ControlStatus::kHeating);
  snapshot = harness.controller.update(readings(92.0F, 100.0F), 4000);
  assert(snapshot.status == ControlStatus::kReady);

  snapshot = harness.controller.update(readings(91.9F, 100.0F), 4100);
  assert(snapshot.status == ControlStatus::kHeating);
  snapshot = harness.controller.update(readings(93.0F, 100.0F), 5000);
  assert(snapshot.status == ControlStatus::kHeating);
  snapshot = harness.controller.update(readings(93.0F, 100.0F), 8000);
  assert(snapshot.status == ControlStatus::kReady);
}

void test_steam_timeout_returns_to_brew_after_first_ready() {
  ControllerHarness harness({93, 115});
  assert(harness.controller.set_mode(ControlMode::kSteam, 0));

  auto snapshot = harness.controller.update(readings(90.0F, 115.0F), 0);
  assert(snapshot.mode == ControlMode::kSteam);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.steam_timeout.active);

  snapshot = harness.controller.update(readings(90.0F, 115.0F),
                                       philcoino::config::kReadyStabilityMs);
  assert(snapshot.mode == ControlMode::kSteam);
  assert(snapshot.status == ControlStatus::kReady);
  assert(snapshot.steam_timeout.active);
  assert(snapshot.steam_timeout.remaining_ms ==
         philcoino::config::kSteamReadyTimeoutMs);

  const auto ready_at = philcoino::config::kReadyStabilityMs;
  snapshot = harness.controller.update(
      readings(90.0F, 110.0F),
      ready_at + philcoino::config::kSteamReadyTimeoutMs - 1U);
  assert(snapshot.mode == ControlMode::kSteam);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.steam_timeout.active);
  assert(snapshot.steam_timeout.remaining_ms == 1U);

  snapshot = harness.controller.update(
      readings(90.0F, 110.0F),
      ready_at + philcoino::config::kSteamReadyTimeoutMs);
  assert(snapshot.mode == ControlMode::kBrew);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.steam_timeout.active);
}

void test_target_updates_validate_and_persist_before_state_change() {
  MemoryState state;
  state.targets = {93, 115};
  MemoryBackend backend(state);
  TargetStorage storage(backend);
  ControllerHarness harness(state.targets);

  assert(!harness.controller.update_brew_target(84, storage, 0));
  assert(harness.controller.targets().brew_c == 93);
  assert(state.save_count == 0);

  state.fail_save = true;
  assert(!harness.controller.update_steam_target(116, storage, 0));
  assert(harness.controller.targets().steam_c == 115);
  assert(state.targets.steam_c == 115);

  state.fail_save = false;
  assert(harness.controller.update_steam_target(116, storage, 0));
  assert(harness.controller.targets().steam_c == 116);
  assert(state.targets.steam_c == 116);
  assert(state.save_count == 1);
}

void test_over_target_brew_disables_heater_while_not_ready() {
  ControllerHarness harness({85, 115});

  auto snapshot = harness.controller.update(readings(84.0F, 90.0F), 0);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);
  assert(harness.output.level);

  snapshot = harness.controller.update(readings(92.0F, 90.0F), 500);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.heater_enabled);
  assert(!harness.output.level);
}

void test_brew_heat_ramp_pulses_near_target() {
  ControllerHarness harness({85, 115});

  auto snapshot = harness.controller.update(readings(83.5F, 90.0F), 0);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);
  assert(harness.output.level);

  snapshot = harness.controller.update(
      readings(83.5F, 90.0F), philcoino::config::kMinimumHeaterPulseMs);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.heater_enabled);
  assert(!harness.output.level);

  snapshot = harness.controller.update(
      readings(83.5F, 90.0F), philcoino::config::kHeaterControlWindowMs - 1U);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.heater_enabled);

  snapshot = harness.controller.update(
      readings(83.5F, 90.0F), philcoino::config::kHeaterControlWindowMs);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);
  assert(harness.output.level);
}

void test_brew_heat_ramp_uses_full_heat_far_below_target() {
  ControllerHarness harness({85, 115});

  auto snapshot = harness.controller.update(readings(70.0F, 90.0F), 0);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(
      readings(70.0F, 90.0F), philcoino::config::kHeaterControlWindowMs - 1U);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);
}

void test_brew_recovery_heat_does_not_start_during_initial_warmup() {
  ControllerHarness harness({85, 115});

  auto snapshot = harness.controller.update(readings(83.0F, 90.0F), 0);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(readings(83.0F, 90.0F), 4000);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.heater_enabled);
}

void test_brew_recovery_heat_latches_after_extraction_drop() {
  ControllerHarness harness({85, 115});

  auto snapshot = harness.controller.update(readings(85.0F, 90.0F), 0);
  assert(!snapshot.heater_enabled);

  snapshot = harness.controller.update(readings(83.0F, 90.0F), 1000);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(readings(83.0F, 90.0F), 4000);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(readings(83.0F, 90.0F), 5000);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.heater_enabled);

  snapshot = harness.controller.update(
      readings(84.5F, 90.0F), philcoino::config::kHeaterControlWindowMs);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(readings(85.0F, 90.0F), 11000);
  assert(!snapshot.heater_enabled);
}

void test_sensor_faults_monitor_both_sensors_and_latch_off() {
  ControllerHarness harness({93, 115});
  auto snapshot = harness.controller.update(open_steam(80.0F), 0);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault_active);
  assert(snapshot.fault.code == FaultCode::kSensorFailure);
  assert(!snapshot.heater_enabled);
  assert(!harness.output.level);

  snapshot = harness.controller.update(readings(93.0F, 115.0F), 1000);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kSensorFailure);
  assert(!snapshot.heater_enabled);
}

void test_over_temperature_monitors_inactive_sensor() {
  ControllerHarness harness({93, 115});
  auto snapshot = harness.controller.update(
      readings(93.0F, static_cast<float>(philcoino::config::kSteamOverTemperatureC)),
      0);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kOverTemperature);
  assert(!snapshot.heater_enabled);
}

void test_over_temperature_can_be_dismissed_after_cooldown() {
  ControllerHarness harness({93, 115});
  auto snapshot = harness.controller.update(
      readings(static_cast<float>(philcoino::config::kBrewOverTemperatureC),
               100.0F),
      0);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kOverTemperature);
  assert(!harness.controller.dismiss_over_temperature(1000));

  snapshot = harness.controller.update(readings(93.0F, 100.0F), 2000);
  assert(snapshot.status == ControlStatus::kFault);
  assert(harness.controller.dismiss_over_temperature(3000));
  snapshot = harness.controller.snapshot(3000);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.fault_active);
  assert(!snapshot.heater_enabled);
}

void test_over_temperature_dismissal_requires_all_monitored_limits_clear() {
  ControllerHarness harness({93, 115});
  auto snapshot = harness.controller.update(
      readings(93.0F, static_cast<float>(philcoino::config::kSteamOverTemperatureC)),
      0);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kOverTemperature);
  snapshot = harness.controller.update(
      readings(93.0F, static_cast<float>(philcoino::config::kSteamOverTemperatureC)),
      1000);
  assert(snapshot.status == ControlStatus::kFault);
  assert(!harness.controller.dismiss_over_temperature(2000));

  snapshot = harness.controller.update(
      readings(93.0F,
               static_cast<float>(philcoino::config::kSteamOverTemperatureC) -
                   1.0F),
      3000);
  assert(snapshot.status == ControlStatus::kFault);
  assert(harness.controller.dismiss_over_temperature(4000));
}

void test_only_over_temperature_fault_is_dismissible() {
  ControllerHarness harness({93, 115});
  harness.controller.latch_fault(FaultCode::kSensorFailure);
  harness.controller.update(readings(93.0F, 100.0F), 1000);
  assert(!harness.controller.dismiss_over_temperature(2000));
  assert(harness.controller.has_fault());
  assert(harness.controller.fault_code() == FaultCode::kSensorFailure);
}

void test_heating_timeout_latches_fault_and_forces_off() {
  ControllerHarness harness({93, 115});
  auto snapshot = harness.controller.update(readings(80.0F, 90.0F), 0);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(readings(80.0F, 90.0F),
                                       philcoino::config::kHeatingTimeoutMs - 1U);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(readings(80.0F, 90.0F),
                                       philcoino::config::kHeatingTimeoutMs);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kHeatingTimeout);
  assert(!snapshot.heater_enabled);
  assert(!harness.output.level);
}

void test_internal_output_failure_latches_fault() {
  ControllerHarness harness({93, 115});
  harness.output.fail_high = true;

  const auto snapshot = harness.controller.update(readings(80.0F, 90.0F), 0);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kInternalError);
  assert(!snapshot.heater_enabled);
  assert(!harness.output.level);
}

}  // namespace

int main() {
  test_boot_selects_brew_and_keeps_targets();
  test_ready_requires_three_continuous_seconds();
  test_steam_timeout_returns_to_brew_after_first_ready();
  test_target_updates_validate_and_persist_before_state_change();
  test_over_target_brew_disables_heater_while_not_ready();
  test_brew_heat_ramp_pulses_near_target();
  test_brew_heat_ramp_uses_full_heat_far_below_target();
  test_brew_recovery_heat_does_not_start_during_initial_warmup();
  test_brew_recovery_heat_latches_after_extraction_drop();
  test_sensor_faults_monitor_both_sensors_and_latch_off();
  test_over_temperature_monitors_inactive_sensor();
  test_over_temperature_can_be_dismissed_after_cooldown();
  test_over_temperature_dismissal_requires_all_monitored_limits_clear();
  test_only_over_temperature_fault_is_dismissible();
  test_heating_timeout_latches_fault_and_forces_off();
  test_internal_output_failure_latches_fault();
  return 0;
}
