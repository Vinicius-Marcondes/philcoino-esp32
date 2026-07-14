#include <cassert>
#include <cstdint>
#include <limits>
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

class FakeProfileBackend final : public ProfileBackend {
 public:
  BackendLoadResult load(ExtractionProfiles& profiles) override {
    profiles = saved;
    return BackendLoadResult::kOk;
  }
  bool save(const ExtractionProfiles& profiles) override {
    ++save_count;
    if (fail_save) {
      return false;
    }
    saved = profiles;
    return true;
  }

  ExtractionProfiles saved{default_extraction_profiles()};
  int save_count{0};
  bool fail_save{false};
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

struct ExtractionHarness {
  ExtractionHarness()
      : pump(output), controller(default_extraction_profiles(), pump) {
    assert(pump.initialize());
  }

  FakeDigitalOutput output{};
  FailOffPump pump;
  ExtractionController controller;
};

constexpr char kStartKey[] = "start-01J2ABCDEF1234";
constexpr char kOtherStartKey[] = "start-01J2OTHERKEY99";

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

  auto snapshot = harness.controller.update(reading(110.0F), 0);
  assert(snapshot.mode == ControlMode::kSteam);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.steam_timeout.active);

  snapshot = harness.controller.update(reading(110.0F),
                                       philcoino::config::kReadyStabilityMs);
  assert(snapshot.mode == ControlMode::kSteam);
  assert(snapshot.status == ControlStatus::kReady);
  assert(snapshot.steam_timeout.active);
  assert(snapshot.steam_timeout.remaining_ms ==
         philcoino::config::kSteamReadyTimeoutMs);

  const auto ready_at = philcoino::config::kReadyStabilityMs;
  snapshot = harness.controller.update(
      reading(105.0F),
      ready_at + philcoino::config::kSteamReadyTimeoutMs - 1U);
  assert(snapshot.mode == ControlMode::kSteam);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.steam_timeout.active);
  assert(snapshot.steam_timeout.remaining_ms == 1U);

  snapshot = harness.controller.update(
      reading(105.0F),
      ready_at + philcoino::config::kSteamReadyTimeoutMs);
  assert(snapshot.mode == ControlMode::kBrew);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.steam_timeout.active);
}

void test_steam_offset_is_applied_once_for_cutoff_readiness_and_snapshot() {
  ControllerHarness harness({93, 120});
  assert(harness.controller.set_mode(ControlMode::kSteam, 0));

  auto snapshot = harness.controller.update(reading(115.0F), 0);
  assert(snapshot.mode == ControlMode::kSteam);
  assert(snapshot.boiler_temperature.temperature_c == 120.0F);
  const auto oled_temperature = display_temperature(snapshot);
  assert(oled_temperature.valid);
  assert(oled_temperature.value_c == 120.0F);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.heater_enabled);
  assert(!harness.output.level);
  assert(!snapshot.steam_timeout.active);

  snapshot = harness.controller.update(
      reading(115.0F), philcoino::config::kReadyStabilityMs - 1U);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(!snapshot.steam_timeout.active);

  snapshot = harness.controller.update(
      reading(115.0F), philcoino::config::kReadyStabilityMs);
  assert(snapshot.boiler_temperature.temperature_c == 120.0F);
  assert(snapshot.status == ControlStatus::kReady);
  assert(!snapshot.heater_enabled);
  assert(snapshot.steam_timeout.active);
  assert(snapshot.steam_timeout.remaining_ms ==
         philcoino::config::kSteamReadyTimeoutMs);
}

void test_steam_offset_is_applied_once_to_duty_and_recovery() {
  ControllerHarness duty({93, 120});
  assert(duty.controller.set_mode(ControlMode::kSteam, 0));
  auto snapshot = duty.controller.update(reading(114.0F), 0);
  assert(snapshot.boiler_temperature.temperature_c == 119.0F);
  assert(snapshot.heater_enabled);
  snapshot = duty.controller.update(
      reading(114.0F), philcoino::config::kMinimumHeaterPulseMs - 1U);
  assert(snapshot.heater_enabled);
  snapshot = duty.controller.update(
      reading(114.0F), philcoino::config::kMinimumHeaterPulseMs);
  assert(!snapshot.heater_enabled);

  ControllerHarness recovery({93, 120});
  assert(recovery.controller.set_mode(ControlMode::kSteam, 0));
  snapshot = recovery.controller.update(reading(115.0F), 0);
  assert(!snapshot.heater_enabled);
  snapshot = recovery.controller.update(reading(112.0F), 1000);
  assert(snapshot.boiler_temperature.temperature_c == 117.0F);
  assert(snapshot.heater_enabled);
  snapshot = recovery.controller.update(reading(112.0F), 4999);
  assert(snapshot.heater_enabled);
  snapshot = recovery.controller.update(reading(112.0F), 5000);
  assert(!snapshot.heater_enabled);
}

void test_steam_heating_timeout_tracks_corrected_demand() {
  ControllerHarness harness({93, 120});
  assert(harness.controller.set_mode(ControlMode::kSteam, 0));

  auto snapshot = harness.controller.update(reading(115.0F), 0);
  assert(!snapshot.heater_enabled);
  snapshot = harness.controller.update(
      reading(115.0F), philcoino::config::kHeatingTimeoutMs + 1U);
  assert(!snapshot.fault_active);
  assert(snapshot.status == ControlStatus::kReady);

  const auto reset_at_ms = philcoino::config::kHeatingTimeoutMs + 2U;
  assert(harness.controller.set_mode(ControlMode::kBrew, reset_at_ms));
  assert(harness.controller.set_mode(ControlMode::kSteam, reset_at_ms + 1U));
  const auto demand_started_ms = reset_at_ms + 2U;
  snapshot = harness.controller.update(reading(113.5F), demand_started_ms);
  assert(snapshot.heater_enabled);
  snapshot = harness.controller.update(
      reading(113.5F),
      demand_started_ms + philcoino::config::kHeatingTimeoutMs - 1U);
  assert(!snapshot.fault_active);
  snapshot = harness.controller.update(
      reading(113.5F),
      demand_started_ms + philcoino::config::kHeatingTimeoutMs);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kHeatingTimeout);
  assert(!snapshot.heater_enabled);
}

void test_mode_changes_recompute_effective_temperature_and_reset_steam_state() {
  ControllerHarness harness({93, 120});
  auto snapshot = harness.controller.update(reading(92.0F), 0);
  assert(snapshot.mode == ControlMode::kBrew);
  assert(snapshot.boiler_temperature.temperature_c == 92.0F);
  assert(display_temperature(snapshot).value_c == 92.0F);

  assert(harness.controller.set_mode(ControlMode::kSteam, 1000));
  snapshot = harness.controller.snapshot(1000);
  assert(snapshot.mode == ControlMode::kSteam);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.boiler_temperature.temperature_c == 97.0F);
  assert(display_temperature(snapshot).value_c == 97.0F);
  assert(!snapshot.steam_timeout.active);
  assert(!snapshot.heater_enabled);

  assert(harness.controller.set_mode(ControlMode::kBrew, 2000));
  snapshot = harness.controller.snapshot(2000);
  assert(snapshot.mode == ControlMode::kBrew);
  assert(snapshot.status == ControlStatus::kHeating);
  assert(snapshot.boiler_temperature.temperature_c == 92.0F);
  assert(display_temperature(snapshot).value_c == 92.0F);
  assert(!snapshot.steam_timeout.active);
  assert(!snapshot.heater_enabled);
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
  auto snapshot = harness.controller.update(reading(80.0F), 0);
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

  auto snapshot = harness.controller.update(reading(80.0F), 0);
  assert(snapshot.heater_enabled);
  assert(harness.safety_lease.arm_count == 1);
  assert(harness.safety_lease.last_duration_ms ==
         philcoino::config::kHeaterSafetyLeaseMs);
  const auto first_event_count = harness.output.events.size();

  snapshot = harness.controller.update(
      reading(80.0F), kMax6675SampleIntervalMs);
  assert(snapshot.heater_enabled);
  assert(harness.safety_lease.arm_count == 2);
  assert(harness.output.events.size() == first_event_count + 1U);
  assert(harness.output.events.back());
}

void test_safety_lease_expiry_latches_internal_fault_until_reboot() {
  ControllerHarness harness({93, 115});

  auto snapshot = harness.controller.update(reading(80.0F), 0);
  assert(snapshot.heater_enabled);
  harness.safety_lease.expire();
  assert(!harness.output.level);
  assert(!harness.ssr.is_enabled());

  snapshot = harness.controller.update(
      reading(80.0F), kMax6675SampleIntervalMs);
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
  auto snapshot = arm_failure.controller.update(reading(80.0F), 0);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kInternalError);
  assert(!snapshot.heater_enabled);
  assert(!arm_failure.output.level);

  ControllerHarness disarm_failure({93, 115});
  disarm_failure.safety_lease.fail_disarm = true;
  snapshot = disarm_failure.controller.update(reading(95.0F), 0);
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

void test_extraction_compensation_is_phase_exact_and_duty_only() {
  ControllerHarness harness({93, 115});

  auto snapshot = harness.controller.update(reading(93.0F), 0);
  assert(!harness.controller.extraction_compensation_active());
  assert(!snapshot.heater_enabled);

  harness.controller.set_extraction_phase(ExtractionPhase::kPreInfusion, 100);
  snapshot = harness.controller.update(reading(93.0F), 100);
  assert(!harness.controller.extraction_compensation_active());
  assert(!snapshot.heater_enabled);

  harness.controller.set_extraction_phase(ExtractionPhase::kSoak, 200);
  snapshot = harness.controller.update(reading(93.0F), 200);
  assert(!harness.controller.extraction_compensation_active());
  assert(!snapshot.heater_enabled);

  harness.controller.set_extraction_phase(ExtractionPhase::kManual, 300);
  snapshot = harness.controller.update(reading(93.0F), 300);
  assert(harness.controller.extraction_compensation_active());
  assert(snapshot.heater_enabled);
  assert(snapshot.targets.brew_c == 93);
  assert(snapshot.boiler_temperature.temperature_c == 93.0F);

  snapshot = harness.controller.update(
      reading(93.0F), 300 + philcoino::config::kReadyStabilityMs);
  assert(snapshot.status == ControlStatus::kReady);
  assert(snapshot.targets.brew_c == 93);

  harness.controller.set_extraction_phase(ExtractionPhase::kMainExtraction,
                                          4000);
  snapshot = harness.controller.update(reading(93.0F), 4000);
  assert(harness.controller.extraction_compensation_active());
  assert(snapshot.heater_enabled);

  harness.controller.set_extraction_phase(ExtractionPhase::kIdle, 4500);
  snapshot = harness.controller.update(reading(93.0F), 4500);
  assert(!harness.controller.extraction_compensation_active());
  assert(!snapshot.heater_enabled);
}

void test_extraction_compensation_clamps_below_brew_over_temperature() {
  ControllerHarness harness({95, 115});
  harness.controller.set_extraction_phase(ExtractionPhase::kManual, 0);

  auto snapshot = harness.controller.update(reading(96.99F), 0);
  assert(harness.controller.extraction_compensation_active());
  assert(snapshot.heater_enabled);
  assert(!snapshot.fault_active);

  snapshot = harness.controller.update(reading(97.0F), 500);
  assert(!snapshot.heater_enabled);
  assert(!snapshot.fault_active);

  snapshot = harness.controller.update(reading(97.99F), 1000);
  assert(!snapshot.heater_enabled);
  assert(!snapshot.fault_active);

  snapshot = harness.controller.update(
      reading(static_cast<float>(philcoino::config::kBrewOverTemperatureC)),
      1500);
  assert(snapshot.fault.code == FaultCode::kOverTemperature);
  assert(!harness.controller.extraction_compensation_active());
  assert(!snapshot.heater_enabled);
}

void test_extraction_compensation_is_suppressed_by_steam_permission_and_faults() {
  ControllerHarness steam({93, 115});
  steam.controller.set_extraction_phase(ExtractionPhase::kMainExtraction, 0);
  assert(steam.controller.set_mode(ControlMode::kSteam, 0));
  auto snapshot = steam.controller.update(reading(110.0F), 0);
  assert(!steam.controller.extraction_compensation_active());
  assert(!snapshot.heater_enabled);

  ControllerHarness permission({93, 115});
  permission.controller.set_extraction_phase(ExtractionPhase::kManual, 0);
  assert(permission.controller.set_heater_enabled(false, 0));
  snapshot = permission.controller.update(reading(93.0F), 0);
  assert(!permission.controller.extraction_compensation_active());
  assert(!snapshot.heater_enabled);

  assert(permission.controller.set_heater_enabled(true, 100));
  snapshot = permission.controller.update(reading(93.0F), 100);
  assert(permission.controller.extraction_compensation_active());
  assert(snapshot.heater_enabled);

  permission.output.fail_high = true;
  permission.controller.set_extraction_phase(ExtractionPhase::kMainExtraction,
                                             200);
  snapshot = permission.controller.update(reading(93.0F), 200);
  assert(snapshot.fault.code == FaultCode::kInternalError);
  assert(!permission.controller.extraction_compensation_active());
  assert(!snapshot.heater_enabled);

  ControllerHarness sensor({93, 115});
  sensor.controller.set_extraction_phase(ExtractionPhase::kManual, 0);
  snapshot = sensor.controller.update(open_boiler(), 0);
  assert(snapshot.fault.code == FaultCode::kSensorFailure);
  assert(!sensor.controller.extraction_compensation_active());
  assert(!snapshot.heater_enabled);
}

void test_extraction_phase_changes_preserve_wrap_safe_heating_deadline() {
  ControllerHarness harness({93, 115});
  constexpr std::uint32_t started_ms = UINT32_MAX - 1000U;
  auto snapshot = harness.controller.update(reading(80.0F), started_ms);
  assert(snapshot.heater_enabled);

  harness.controller.set_extraction_phase(ExtractionPhase::kPreInfusion,
                                          started_ms + 100U);
  harness.controller.set_extraction_phase(ExtractionPhase::kSoak,
                                          started_ms + 200U);
  harness.controller.set_extraction_phase(ExtractionPhase::kMainExtraction,
                                          started_ms + 300U);
  snapshot = harness.controller.update(
      reading(80.0F), started_ms + philcoino::config::kHeatingTimeoutMs - 1U);
  assert(!snapshot.fault_active);

  snapshot = harness.controller.update(
      reading(80.0F), started_ms + philcoino::config::kHeatingTimeoutMs);
  assert(snapshot.fault.code == FaultCode::kHeatingTimeout);
  assert(!snapshot.heater_enabled);
}

void test_extraction_phase_changes_preserve_steam_deadline() {
  ControllerHarness harness({93, 115});
  constexpr std::uint32_t started_ms = UINT32_MAX - 2000U;
  assert(harness.controller.set_mode(ControlMode::kSteam, started_ms));
  auto snapshot = harness.controller.update(reading(110.0F), started_ms);
  assert(snapshot.status == ControlStatus::kHeating);

  const auto ready_at = started_ms + philcoino::config::kReadyStabilityMs;
  snapshot = harness.controller.update(reading(110.0F), ready_at);
  assert(snapshot.status == ControlStatus::kReady);
  assert(snapshot.steam_timeout.active);

  harness.controller.set_extraction_phase(ExtractionPhase::kManual,
                                          ready_at + 100U);
  assert(!harness.controller.extraction_compensation_active());
  snapshot = harness.controller.update(
      reading(110.0F),
      ready_at + philcoino::config::kSteamReadyTimeoutMs - 1U);
  assert(snapshot.mode == ControlMode::kSteam);
  assert(snapshot.steam_timeout.remaining_ms == 1U);

  snapshot = harness.controller.update(
      reading(110.0F),
      ready_at + philcoino::config::kSteamReadyTimeoutMs);
  assert(snapshot.mode == ControlMode::kBrew);
  assert(!snapshot.steam_timeout.active);
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

void test_steam_raw_sensor_failures_precede_offset_and_over_temperature() {
  for (const auto reading_value : {
           ThermocoupleReading{ThermocoupleStatus::kOpenCircuit, 125.0F, 0},
           ThermocoupleReading{ThermocoupleStatus::kInvalidFrame, 125.0F, 0},
           ThermocoupleReading{ThermocoupleStatus::kTransportError, 125.0F, 0},
           ThermocoupleReading{ThermocoupleStatus::kOk,
                               std::numeric_limits<float>::quiet_NaN(), 0},
           ThermocoupleReading{ThermocoupleStatus::kOk,
                               std::numeric_limits<float>::infinity(), 0},
       }) {
    ControllerHarness harness({93, 120});
    assert(harness.controller.set_mode(ControlMode::kSteam, 0));
    const auto snapshot = harness.controller.update(reading_value, 0);
    assert(snapshot.status == ControlStatus::kFault);
    assert(snapshot.fault.code == FaultCode::kSensorFailure);
    assert(!snapshot.heater_enabled);
    assert(!harness.output.level);
  }
}

void test_steam_mode_uses_steam_over_temperature_limit() {
  ControllerHarness harness({93, 120});
  assert(harness.controller.set_mode(ControlMode::kSteam, 0));
  auto snapshot = harness.controller.update(
      reading(static_cast<float>(
                  philcoino::config::kSteamOverTemperatureC -
                  philcoino::config::kSteamTemperatureOffsetC) -
              0.25F),
      0);
  assert(snapshot.boiler_temperature.temperature_c == 129.75F);
  assert(!snapshot.fault_active);
  assert(!snapshot.heater_enabled);

  snapshot = harness.controller.update(
      reading(static_cast<float>(
          philcoino::config::kSteamOverTemperatureC -
          philcoino::config::kSteamTemperatureOffsetC)),
      500);
  assert(snapshot.boiler_temperature.temperature_c == 130.0F);
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
      reading(static_cast<float>(
          philcoino::config::kSteamOverTemperatureC -
          philcoino::config::kSteamTemperatureOffsetC)),
      0);
  assert(snapshot.status == ControlStatus::kFault);
  assert(snapshot.fault.code == FaultCode::kOverTemperature);
  snapshot = harness.controller.update(
      reading(static_cast<float>(
          philcoino::config::kSteamOverTemperatureC -
          philcoino::config::kSteamTemperatureOffsetC)),
      1000);
  assert(snapshot.status == ControlStatus::kFault);
  assert(!harness.controller.dismiss_over_temperature(2000));

  snapshot = harness.controller.update(
      reading(static_cast<float>(
                  philcoino::config::kSteamOverTemperatureC -
                  philcoino::config::kSteamTemperatureOffsetC) -
              1.0F),
      3000);
  assert(snapshot.status == ControlStatus::kFault);
  assert(!harness.controller.dismiss_over_temperature(4000));

  snapshot = harness.controller.update(
      reading(115.0F - static_cast<float>(
                           philcoino::config::kSteamTemperatureOffsetC)),
      5000);
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

void test_manual_extraction_cutoff_replay_conflict_and_stop() {
  ExtractionHarness harness;
  assert(harness.controller.start(kStartKey,
                                  {ExtractionSelectionKind::kManual, 0}, 1000) ==
         StartExtractionResult::kStarted);
  const auto started = harness.controller.snapshot(1000);
  assert(started.status == ExtractionStatus::kRunning);
  assert(started.phase == ExtractionPhase::kManual);
  assert(started.pump_command == PumpCommand::kRunning);
  assert(started.remaining_ms == 60000U);

  assert(harness.controller.start(kStartKey,
                                  {ExtractionSelectionKind::kManual, 0}, 9000) ==
         StartExtractionResult::kReplay);
  assert(harness.controller.snapshot(9000).elapsed_ms == 8000U);
  assert(harness.controller.start(kOtherStartKey,
                                  {ExtractionSelectionKind::kManual, 0}, 9000) ==
         StartExtractionResult::kConflict);
  assert(harness.controller.update(60999) == ExtractionUpdateResult::kOk);
  assert(harness.output.level);
  assert(harness.controller.update(61000) ==
         ExtractionUpdateResult::kCompleted);
  assert(!harness.controller.active());
  assert(!harness.output.level);
  assert(harness.controller.stop());
  assert(!harness.output.level);
}

void test_profile_phases_exact_deadlines_and_delayed_completion() {
  ExtractionHarness harness;
  assert(harness.controller.start(
             kStartKey, {ExtractionSelectionKind::kProfile, 1}, 500) ==
         StartExtractionResult::kStarted);
  assert(harness.controller.snapshot(5499).phase ==
         ExtractionPhase::kPreInfusion);
  assert(harness.controller.update(5500) == ExtractionUpdateResult::kOk);
  auto snapshot = harness.controller.snapshot(5500);
  assert(snapshot.phase == ExtractionPhase::kSoak);
  assert(snapshot.pump_command == PumpCommand::kOff);
  assert(!harness.output.level);
  assert(harness.controller.update(10500) == ExtractionUpdateResult::kOk);
  snapshot = harness.controller.snapshot(10500);
  assert(snapshot.phase == ExtractionPhase::kMainExtraction);
  assert(snapshot.pump_command == PumpCommand::kRunning);
  assert(harness.output.level);
  assert(harness.controller.update(35500) ==
         ExtractionUpdateResult::kCompleted);
  assert(!harness.output.level);

  assert(harness.controller.start(
             kOtherStartKey, {ExtractionSelectionKind::kProfile, 0}, 40000) ==
         StartExtractionResult::kStarted);
  assert(harness.controller.snapshot(40000).phase ==
         ExtractionPhase::kMainExtraction);
  assert(harness.controller.update(80000) ==
         ExtractionUpdateResult::kCompleted);
  assert(!harness.output.level);
}

void test_profile_snapshot_export_and_empty_slot_rules() {
  ExtractionHarness harness;
  FakeProfileBackend backend;
  ProfileStorage storage(backend);
  auto replacement = default_extraction_profiles();
  replacement[0].main_extraction_seconds = 20U;
  assert(harness.controller.replace_profiles(replacement, storage) ==
         ReplaceProfilesResult::kReplaced);
  assert(backend.save_count == 1);
  assert(harness.controller.start(
             kStartKey, {ExtractionSelectionKind::kProfile, 0}, 0) ==
         StartExtractionResult::kStarted);

  auto later = replacement;
  later[0].main_extraction_seconds = 10U;
  assert(harness.controller.replace_profiles(later, storage) ==
         ReplaceProfilesResult::kActive);
  assert(backend.save_count == 1);
  assert(harness.controller.update(10000) == ExtractionUpdateResult::kOk);
  assert(harness.controller.snapshot(10000).remaining_ms == 10000U);
  assert(harness.controller.stop());

  backend.fail_save = true;
  assert(harness.controller.replace_profiles(later, storage) ==
         ReplaceProfilesResult::kPersistenceFailure);
  assert(harness.controller.profiles()[0].main_extraction_seconds == 20U);
  assert(harness.controller.start(
             kOtherStartKey, {ExtractionSelectionKind::kProfile, 2}, 0) ==
         StartExtractionResult::kProfileNotConfigured);
}

void test_extraction_wraparound_disconnect_and_heater_fault_independence() {
  ExtractionHarness extraction;
  ControllerHarness heater;
  constexpr std::uint32_t started = UINT32_MAX - 2999U;
  assert(extraction.controller.start(
             kStartKey, {ExtractionSelectionKind::kProfile, 1}, started) ==
         StartExtractionResult::kStarted);
  heater.controller.set_extraction_phase(ExtractionPhase::kPreInfusion,
                                         started);
  auto heater_snapshot = heater.controller.update(open_boiler(), started);
  assert(heater_snapshot.fault.code == FaultCode::kSensorFailure);
  assert(!heater.controller.extraction_compensation_active());
  assert(extraction.controller.active());
  assert(extraction.controller.update(2000U) == ExtractionUpdateResult::kOk);
  assert(extraction.controller.snapshot(2000U).phase == ExtractionPhase::kSoak);
  assert(extraction.controller.update(7000U) == ExtractionUpdateResult::kOk);
  assert(extraction.controller.snapshot(7000U).phase ==
         ExtractionPhase::kMainExtraction);
  assert(heater.controller.has_fault());
  assert(extraction.controller.update(32000U) ==
         ExtractionUpdateResult::kCompleted);
  assert(!extraction.output.level);
}

void test_pump_output_failures_end_extraction_off() {
  ExtractionHarness start_failure;
  start_failure.output.fail_high = true;
  assert(start_failure.controller.start(
             kStartKey, {ExtractionSelectionKind::kManual, 0}, 0) ==
         StartExtractionResult::kOutputFailure);
  assert(!start_failure.controller.active());
  assert(start_failure.pump.command() == PumpCommand::kOff);
  assert(!start_failure.output.level);

  ExtractionHarness transition_failure;
  assert(transition_failure.controller.start(
             kStartKey, {ExtractionSelectionKind::kProfile, 1}, 0) ==
         StartExtractionResult::kStarted);
  transition_failure.output.fail_low = true;
  assert(transition_failure.controller.update(5000) ==
         ExtractionUpdateResult::kOutputFailure);
  assert(!transition_failure.controller.active());
  assert(transition_failure.pump.command() == PumpCommand::kOff);
}

}  // namespace

int main() {
  test_boot_selects_brew_and_keeps_targets();
  test_ready_requires_three_continuous_seconds();
  test_steam_timeout_returns_to_brew_after_first_ready();
  test_steam_offset_is_applied_once_for_cutoff_readiness_and_snapshot();
  test_steam_offset_is_applied_once_to_duty_and_recovery();
  test_steam_heating_timeout_tracks_corrected_demand();
  test_mode_changes_recompute_effective_temperature_and_reset_steam_state();
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
  test_extraction_compensation_is_phase_exact_and_duty_only();
  test_extraction_compensation_clamps_below_brew_over_temperature();
  test_extraction_compensation_is_suppressed_by_steam_permission_and_faults();
  test_extraction_phase_changes_preserve_wrap_safe_heating_deadline();
  test_extraction_phase_changes_preserve_steam_deadline();
  test_boiler_sensor_fault_latches_off();
  test_steam_raw_sensor_failures_precede_offset_and_over_temperature();
  test_steam_mode_uses_steam_over_temperature_limit();
  test_over_temperature_can_be_dismissed_after_cooldown();
  test_over_temperature_dismissal_uses_active_mode_limit();
  test_only_over_temperature_fault_is_dismissible();
  test_heating_timeout_latches_fault_and_forces_off();
  test_manual_heater_disable_forces_off_without_timeout();
  test_manual_heater_toggle_is_allowed_while_faulted();
  test_internal_output_failure_latches_fault();
  test_manual_extraction_cutoff_replay_conflict_and_stop();
  test_profile_phases_exact_deadlines_and_delayed_completion();
  test_profile_snapshot_export_and_empty_slot_rules();
  test_extraction_wraparound_disconnect_and_heater_fault_independence();
  test_pump_output_failures_end_extraction_off();
  return 0;
}
