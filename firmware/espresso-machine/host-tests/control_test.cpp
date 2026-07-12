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
  const bool* heater_level{nullptr};
  bool heater_was_high_during_save{false};
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
    state_.heater_was_high_during_save =
        state_.heater_level != nullptr && *state_.heater_level;
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

class FakeSafetyLease final : public SsrSafetyLease {
 public:
  explicit FakeSafetyLease(FakeDigitalOutput& output) : output_(output) {}

  bool initialize() override {
    tripped_ = false;
    return true;
  }
  bool arm(std::uint32_t duration_ms) override {
    last_duration_ms = duration_ms;
    ++arm_count;
    return !fail_arm;
  }
  bool disarm() override {
    ++disarm_count;
    return !fail_disarm;
  }
  bool tripped() const override { return tripped_; }

  void expire() {
    output_.set_level(false);
    tripped_ = true;
  }

  FakeDigitalOutput& output_;
  std::uint32_t last_duration_ms{0};
  int arm_count{0};
  int disarm_count{0};
  bool fail_arm{false};
  bool fail_disarm{false};
  bool tripped_{false};
};

ThermocoupleReading ok(float temperature_c) {
  return {ThermocoupleStatus::kOk, temperature_c, 0};
}

ThermocoupleReading reading(float boiler_c) {
  return ok(boiler_c);
}

ThermocoupleReading open_boiler() {
  ThermocoupleReading value{};
  value.status = ThermocoupleStatus::kOpenCircuit;
  return value;
}

struct ControllerHarness {
  explicit ControllerHarness(TemperatureTargets targets = {})
      : controller(targets, ssr) {
    assert(ssr.initialize());
  }

  FakeDigitalOutput output{};
  FakeSafetyLease safety_lease{output};
  FailOffSsr ssr{output, safety_lease};
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

  auto snapshot = harness.controller.update(reading(92.0F), 1000);
  assert(snapshot.status == ControlStatus::kHeating);
  snapshot = harness.controller.update(reading(92.0F), 3999);
  assert(snapshot.status == ControlStatus::kHeating);
  snapshot = harness.controller.update(reading(92.0F), 4000);
  assert(snapshot.status == ControlStatus::kReady);

  snapshot = harness.controller.update(reading(91.9F), 4100);
  assert(snapshot.status == ControlStatus::kHeating);
  snapshot = harness.controller.update(reading(93.0F), 5000);
  assert(snapshot.status == ControlStatus::kHeating);
  snapshot = harness.controller.update(reading(93.0F), 8000);
  assert(snapshot.status == ControlStatus::kReady);
}

void test_steam_timeout_returns_to_brew_after_first_ready() {
  ControllerHarness harness({93, 115});
  assert(harness.controller.set_mode(ControlMode::kSteam, 0));

  auto snapshot = harness.controller.update(reading(115.0F), 0);
  assert(snapshot.mode == ControlMode::kSteam);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.steam_timeout.active);

  snapshot = harness.controller.update(reading(115.0F),
                                       philcoino::config::kReadyStabilityMs);
  assert(snapshot.mode == ControlMode::kSteam);
  assert(snapshot.status == ControlStatus::kReady);
  assert(snapshot.steam_timeout.active);
  assert(snapshot.steam_timeout.remaining_ms ==
         philcoino::config::kSteamReadyTimeoutMs);

  const auto ready_at = philcoino::config::kReadyStabilityMs;
  snapshot = harness.controller.update(
      reading(110.0F),
      ready_at + philcoino::config::kSteamReadyTimeoutMs - 1U);
  assert(snapshot.mode == ControlMode::kSteam);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.steam_timeout.active);
  assert(snapshot.steam_timeout.remaining_ms == 1U);

  snapshot = harness.controller.update(
      reading(110.0F),
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
  state.heater_level = &harness.output.level;

  assert(!harness.controller.update_brew_target(84, storage, 0));
  assert(harness.controller.targets().brew_c == 93);
  assert(state.save_count == 0);

  state.fail_save = true;
  auto snapshot = harness.controller.update(readings(80.0F, 90.0F), 0);
  assert(snapshot.heater_enabled);
  assert(harness.output.level);
  assert(!harness.controller.update_steam_target(116, storage, 0));
  assert(harness.controller.targets().steam_c == 115);
  assert(state.targets.steam_c == 115);
  assert(!harness.output.level);
  assert(!state.heater_was_high_during_save);
  assert(harness.safety_lease.disarm_count == 1);

  state.fail_save = false;
  assert(harness.controller.update_steam_target(116, storage, 0));
  assert(harness.controller.targets().steam_c == 116);
  assert(state.targets.steam_c == 116);
  assert(state.save_count == 1);
}

void test_safety_lease_renews_without_normal_off_transition() {
  ControllerHarness harness({93, 115});

  auto snapshot = harness.controller.update(readings(80.0F, 90.0F), 0);
  assert(snapshot.heater_enabled);
  assert(harness.safety_lease.arm_count == 1);
  assert(harness.safety_lease.last_duration_ms ==
         philcoino::config::kHeaterSafetyLeaseMs);
  const auto first_event_count = harness.output.events.size();

  snapshot = harness.controller.update(
      readings(80.0F, 90.0F), kMax6675SampleIntervalMs);
  assert(snapshot.heater_enabled);
  assert(harness.safety_lease.arm_count == 2);
  assert(harness.output.events.size() == first_event_count + 1U);
  assert(harness.output.events.back());
}

void test_safety_lease_expiry_latches_internal_fault_until_reboot() {
  ControllerHarness harness({93, 115});

  auto snapshot = harness.controller.update(readings(80.0F, 90.0F), 0);
  assert(snapshot.heater_enabled);
  harness.safety_lease.expire();
  assert(!harness.output.level);
  assert(!harness.ssr.is_enabled());

  snapshot = harness.controller.update(
      readings(80.0F, 90.0F), kMax6675SampleIntervalMs);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kInternalError);
  assert(!snapshot.heater_enabled);
  assert(!harness.controller.set_heater_enabled(true, 1000));
  assert(harness.controller.has_fault());
  assert(!harness.output.level);
}

void test_safety_lease_control_failures_latch_internal_fault() {
  ControllerHarness arm_failure({93, 115});
  arm_failure.safety_lease.fail_arm = true;
  auto snapshot = arm_failure.controller.update(readings(80.0F, 90.0F), 0);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kInternalError);
  assert(!snapshot.heater_enabled);
  assert(!arm_failure.output.level);

  ControllerHarness disarm_failure({93, 115});
  disarm_failure.safety_lease.fail_disarm = true;
  snapshot = disarm_failure.controller.update(readings(95.0F, 90.0F), 0);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kInternalError);
  assert(!snapshot.heater_enabled);
  assert(!disarm_failure.output.level);
}

void test_over_target_brew_disables_heater_while_not_ready() {
  ControllerHarness harness({85, 115});

  auto snapshot = harness.controller.update(reading(84.0F), 0);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);
  assert(harness.output.level);

  snapshot = harness.controller.update(reading(92.0F), 500);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.heater_enabled);
  assert(!harness.output.level);
}

void test_brew_heat_ramp_pulses_near_target() {
  ControllerHarness harness({85, 115});

  auto snapshot = harness.controller.update(reading(83.5F), 0);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);
  assert(harness.output.level);

  snapshot = harness.controller.update(
      reading(83.5F), philcoino::config::kMinimumHeaterPulseMs);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);
  assert(harness.output.level);

  snapshot = harness.controller.update(reading(83.5F), 1500);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.heater_enabled);
  assert(!harness.output.level);

  snapshot = harness.controller.update(
      reading(83.5F), philcoino::config::kHeaterControlWindowMs - 1U);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.heater_enabled);

  snapshot = harness.controller.update(
      reading(83.5F), philcoino::config::kHeaterControlWindowMs);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);
  assert(harness.output.level);
}

void test_brew_heat_ramp_scales_with_target() {
  ControllerHarness low_target_harness({85, 115});
  auto snapshot =
      low_target_harness.controller.update(reading(81.0F), 0);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = low_target_harness.controller.update(reading(81.0F), 9000);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  ControllerHarness high_target_harness({95, 115});
  snapshot = high_target_harness.controller.update(reading(91.0F), 0);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = high_target_harness.controller.update(reading(91.0F), 3000);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.heater_enabled);
}

void test_brew_heat_ramp_uses_full_heat_far_below_target() {
  ControllerHarness harness({85, 115});

  auto snapshot = harness.controller.update(reading(70.0F), 0);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(
      reading(70.0F), philcoino::config::kHeaterControlWindowMs - 1U);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);
}

void test_brew_recovery_heat_does_not_start_during_initial_warmup() {
  ControllerHarness harness({85, 115});

  auto snapshot = harness.controller.update(reading(83.0F), 0);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(reading(83.0F), 4000);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.heater_enabled);
}

void test_brew_recovery_heat_latches_after_extraction_drop() {
  ControllerHarness harness({85, 115});

  auto snapshot = harness.controller.update(reading(85.0F), 0);
  assert(!snapshot.heater_enabled);

  snapshot = harness.controller.update(reading(83.0F), 1000);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(reading(83.0F), 4000);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(reading(83.0F), 5000);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.heater_enabled);

  snapshot = harness.controller.update(
      reading(84.5F), philcoino::config::kHeaterControlWindowMs);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(reading(85.0F), 11000);
  assert(!snapshot.heater_enabled);
}

void test_boiler_sensor_fault_latches_off() {
  ControllerHarness harness({93, 115});
  auto snapshot = harness.controller.update(open_boiler(), 0);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault_active);
  assert(snapshot.fault.code == FaultCode::kSensorFailure);
  assert(!snapshot.heater_enabled);
  assert(!harness.output.level);

  snapshot = harness.controller.update(reading(93.0F), 1000);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kSensorFailure);
  assert(!snapshot.heater_enabled);
}

void test_steam_mode_uses_steam_over_temperature_limit() {
  ControllerHarness harness({93, 115});
  assert(harness.controller.set_mode(ControlMode::kSteam, 0));
  auto snapshot = harness.controller.update(
      reading(static_cast<float>(philcoino::config::kSteamOverTemperatureC)),
      0);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kOverTemperature);
  assert(!snapshot.heater_enabled);
}

void test_over_temperature_can_be_dismissed_after_cooldown() {
  ControllerHarness harness({93, 115});
  auto snapshot = harness.controller.update(
      reading(static_cast<float>(philcoino::config::kBrewOverTemperatureC)),
      0);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kOverTemperature);
  assert(!harness.controller.dismiss_over_temperature(1000));

  snapshot = harness.controller.update(reading(93.0F), 2000);
  assert(snapshot.status == ControlStatus::kFault);
  assert(harness.controller.dismiss_over_temperature(3000));
  snapshot = harness.controller.snapshot(3000);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.fault_active);
  assert(!snapshot.heater_enabled);
}

void test_over_temperature_dismissal_uses_active_mode_limit() {
  ControllerHarness harness({93, 115});
  assert(harness.controller.set_mode(ControlMode::kSteam, 0));
  auto snapshot = harness.controller.update(
      reading(static_cast<float>(philcoino::config::kSteamOverTemperatureC)),
      0);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kOverTemperature);
  snapshot = harness.controller.update(
      reading(static_cast<float>(philcoino::config::kSteamOverTemperatureC)),
      1000);
  assert(snapshot.status == ControlStatus::kFault);
  assert(!harness.controller.dismiss_over_temperature(2000));

  snapshot = harness.controller.update(
      reading(static_cast<float>(philcoino::config::kSteamOverTemperatureC) -
              1.0F),
      3000);
  assert(snapshot.status == ControlStatus::kFault);
  assert(!harness.controller.dismiss_over_temperature(4000));

  snapshot = harness.controller.update(reading(115.0F), 5000);
  assert(snapshot.status == ControlStatus::kFault);
  assert(harness.controller.dismiss_over_temperature(6000));
}

void test_only_over_temperature_fault_is_dismissible() {
  ControllerHarness harness({93, 115});
  harness.controller.latch_fault(FaultCode::kSensorFailure);
  harness.controller.update(reading(93.0F), 1000);
  assert(!harness.controller.dismiss_over_temperature(2000));
  assert(harness.controller.has_fault());
  assert(harness.controller.fault_code() == FaultCode::kSensorFailure);
}

void test_heating_timeout_latches_fault_and_forces_off() {
  ControllerHarness harness({93, 115});
  auto snapshot = harness.controller.update(reading(80.0F), 0);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(reading(80.0F),
                                       philcoino::config::kHeatingTimeoutMs - 1U);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);

  snapshot = harness.controller.update(reading(80.0F),
                                       philcoino::config::kHeatingTimeoutMs);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kHeatingTimeout);
  assert(!snapshot.heater_enabled);
  assert(!harness.output.level);
}

void test_manual_heater_disable_forces_off_without_timeout() {
  ControllerHarness harness({93, 115});
  auto snapshot = harness.controller.update(reading(80.0F), 0);
  assert(snapshot.heater_enabled_permission);
  assert(snapshot.heater_enabled);
  assert(harness.output.level);

  assert(harness.controller.set_heater_enabled(false, 1000));
  snapshot = harness.controller.update(reading(80.0F),
                                       philcoino::config::kHeatingTimeoutMs + 1000U);
  assert(snapshot.heater_enabled_permission == false);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.fault_active);
  assert(!snapshot.heater_enabled);
  assert(!harness.output.level);

  assert(harness.controller.set_heater_enabled(true,
                                               philcoino::config::kHeatingTimeoutMs + 2000U));
  snapshot = harness.controller.update(reading(80.0F),
                                       philcoino::config::kHeatingTimeoutMs + 2000U);
  assert(snapshot.heater_enabled_permission);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.heater_enabled);
  assert(!snapshot.fault_active);
}

void test_manual_heater_toggle_is_allowed_while_faulted() {
  ControllerHarness harness({93, 115});
  harness.controller.latch_fault(FaultCode::kSensorFailure);

  assert(harness.controller.set_heater_enabled(false, 1000));
  auto snapshot = harness.controller.snapshot(1000);
  assert(snapshot.status == ControlStatus::kFault);
  assert(!snapshot.heater_enabled_permission);
  assert(!snapshot.heater_enabled);

  assert(harness.controller.set_heater_enabled(true, 2000));
  snapshot = harness.controller.snapshot(2000);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.heater_enabled_permission);
  assert(!snapshot.heater_enabled);
}

void test_internal_output_failure_latches_fault() {
  ControllerHarness harness({93, 115});
  harness.output.fail_high = true;

  const auto snapshot = harness.controller.update(reading(80.0F), 0);
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
  test_safety_lease_renews_without_normal_off_transition();
  test_safety_lease_expiry_latches_internal_fault_until_reboot();
  test_safety_lease_control_failures_latch_internal_fault();
  test_over_target_brew_disables_heater_while_not_ready();
  test_brew_heat_ramp_pulses_near_target();
  test_brew_heat_ramp_scales_with_target();
  test_brew_heat_ramp_uses_full_heat_far_below_target();
  test_brew_recovery_heat_does_not_start_during_initial_warmup();
  test_brew_recovery_heat_latches_after_extraction_drop();
  test_boiler_sensor_fault_latches_off();
  test_steam_mode_uses_steam_over_temperature_limit();
  test_over_temperature_can_be_dismissed_after_cooldown();
  test_over_temperature_dismissal_uses_active_mode_limit();
  test_only_over_temperature_fault_is_dismissible();
  test_heating_timeout_latches_fault_and_forces_off();
  test_manual_heater_disable_forces_off_without_timeout();
  test_manual_heater_toggle_is_allowed_while_faulted();
  test_internal_output_failure_latches_fault();
  return 0;
}
