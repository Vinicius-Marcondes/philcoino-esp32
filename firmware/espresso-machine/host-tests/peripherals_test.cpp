#include <algorithm>
#include <array>
#include <atomic>
#include <cassert>
#include <condition_variable>
#include <cstddef>
#include <cstdint>
#include <string>
#include <mutex>
#include <thread>
#include <vector>

#include "philcoino/config.hpp"
#include "philcoino/peripherals.hpp"

namespace {

using namespace philcoino::peripherals;

class FakeMax6675Transport final : public Max6675Transport {
 public:
  bool read_frame(std::uint16_t& frame) override {
    assert(!read_active);
    read_active = true;
    ++read_count;
    frame = next_frame;
    read_active = false;
    return succeeds;
  }

  std::uint16_t next_frame{0};
  bool succeeds{true};
  std::size_t read_count{0};
  bool read_active{false};
};

class FakeHx711Transport final : public Hx711Transport {
 public:
  Hx711Reading read() override {
    ++read_count;
    if (next_reading < readings.size()) {
      return readings[next_reading++];
    }
    return {Hx711Status::kNotReady, 0};
  }

  std::vector<Hx711Reading> readings{};
  std::size_t next_reading{0};
  std::size_t read_count{0};
};

class FakeHx711ReadyWaiter final : public Hx711ReadyWaiter {
 public:
  bool wait(std::uint32_t timeout_ms) override {
    ++wait_count;
    last_timeout_ms = timeout_ms;
    if (pending_notifications == 0U) return false;
    pending_notifications = 0U;
    return true;
  }

  void notify_from_isr() { ++pending_notifications; }

  std::uint32_t pending_notifications{0};
  std::uint32_t last_timeout_ms{0};
  std::size_t wait_count{0};
};

struct MemoryState {
  bool present{false};
  bool fail_load{false};
  bool fail_save{false};
  TemperatureTargets targets{};
};

struct TemperatureCalibrationMemoryState {
  bool present{false};
  bool fail_load{false};
  bool fail_save{false};
  TemperatureCalibration calibration{};
};

struct SteamControlMemoryState {
  bool present{false};
  bool fail_load{false};
  bool fail_save{false};
  SteamControlSettings settings{};
  int save_count{0};
};

class SteamControlMemoryBackend final : public SteamControlSettingsBackend {
 public:
  explicit SteamControlMemoryBackend(SteamControlMemoryState& state)
      : state_(state) {}

  BackendLoadResult load(SteamControlSettings& settings) override {
    if (state_.fail_load) return BackendLoadResult::kError;
    if (!state_.present) return BackendLoadResult::kNotFound;
    settings = state_.settings;
    return BackendLoadResult::kOk;
  }

  bool save(const SteamControlSettings& settings) override {
    ++state_.save_count;
    if (state_.fail_save) return false;
    state_.settings = settings;
    state_.present = true;
    return true;
  }

 private:
  SteamControlMemoryState& state_;
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
    return true;
  }

 private:
  MemoryState& state_;
};

class TemperatureCalibrationMemoryBackend final
    : public TemperatureCalibrationBackend {
 public:
  explicit TemperatureCalibrationMemoryBackend(
      TemperatureCalibrationMemoryState& state)
      : state_(state) {}

  BackendLoadResult load(TemperatureCalibration& calibration) override {
    if (state_.fail_load) {
      return BackendLoadResult::kError;
    }
    if (!state_.present) {
      return BackendLoadResult::kNotFound;
    }
    calibration = state_.calibration;
    return BackendLoadResult::kOk;
  }

  bool save(const TemperatureCalibration& calibration) override {
    if (state_.fail_save) {
      return false;
    }
    state_.calibration = calibration;
    state_.present = true;
    return true;
  }

 private:
  TemperatureCalibrationMemoryState& state_;
};

enum class OutputEvent {
  kLow,
  kHigh,
  kConfigure,
  kLeaseInitialize,
  kLeaseArm,
  kLeaseDisarm,
};

class FakeDigitalOutput final : public DigitalOutput {
 public:
  bool set_level(bool high) override {
    events.push_back(high ? OutputEvent::kHigh : OutputEvent::kLow);
    const bool failed = (high && fail_high) || (!high && fail_low);
    if (!failed || !preserve_level_on_failure) {
      level = high;
    }
    return !failed;
  }

  bool configure_output() override {
    events.push_back(OutputEvent::kConfigure);
    configured = true;
    return !fail_configure;
  }

  std::vector<OutputEvent> events{};
  bool level{true};
  bool configured{false};
  bool fail_low{false};
  bool fail_high{false};
  bool fail_configure{false};
  bool preserve_level_on_failure{false};
};

class FakeOutputCriticalSection final : public OutputCriticalSection {
 public:
  void enter() override {
    assert(!entered);
    entered = true;
  }
  void exit() override {
    assert(entered);
    entered = false;
  }

  bool entered{false};
};

class MutexOutputCriticalSection final : public OutputCriticalSection {
 public:
  void enter() override { mutex_.lock(); }
  void exit() override { mutex_.unlock(); }

 private:
  std::mutex mutex_;
};

class BlockingHighOutput final : public DigitalOutput {
 public:
  bool set_level(bool high) override {
    if (high) {
      std::unique_lock<std::mutex> lock(barrier_mutex_);
      high_entered_ = true;
      barrier_.notify_all();
      barrier_.wait(lock, [this] { return release_high_; });
    }
    level = high;
    events.push_back(high ? OutputEvent::kHigh : OutputEvent::kLow);
    return true;
  }

  bool configure_output() override { return true; }

  void wait_for_high() {
    std::unique_lock<std::mutex> lock(barrier_mutex_);
    barrier_.wait(lock, [this] { return high_entered_; });
  }

  void release_high() {
    std::lock_guard<std::mutex> lock(barrier_mutex_);
    release_high_ = true;
    barrier_.notify_all();
  }

  std::vector<OutputEvent> events{};
  bool level{true};

 private:
  std::condition_variable barrier_;
  std::mutex barrier_mutex_;
  bool high_entered_{false};
  bool release_high_{false};
};

class FakeSafetyLease final : public SsrSafetyLease {
 public:
  explicit FakeSafetyLease(FakeDigitalOutput& output, bool off_high = false)
      : output_(output), off_high_(off_high) {}

  bool initialize() override {
    output_.events.push_back(OutputEvent::kLeaseInitialize);
    tripped_ = false;
    return !fail_initialize;
  }
  bool arm(std::uint32_t duration_ms) override {
    output_.events.push_back(OutputEvent::kLeaseArm);
    durations.push_back(duration_ms);
    return !fail_arm;
  }
  bool disarm() override {
    output_.events.push_back(OutputEvent::kLeaseDisarm);
    return !fail_disarm;
  }
  bool tripped() const override { return tripped_; }

  void expire() {
    output_.set_level(off_high_);
    tripped_ = true;
  }

  FakeDigitalOutput& output_;
  std::vector<std::uint32_t> durations{};
  bool off_high_{false};
  bool fail_initialize{false};
  bool fail_arm{false};
  bool fail_disarm{false};
  bool tripped_{false};
};

class SimpleSafetyLease final : public SsrSafetyLease {
 public:
  bool initialize() override { return true; }
  bool arm(std::uint32_t) override { return !tripped_; }
  bool disarm() override {
    ++disarm_count;
    return true;
  }
  bool tripped() const override { return tripped_; }

  int disarm_count{0};

 private:
  bool tripped_{false};
};

void test_thermocouple() {
  static_assert(kMax6675SampleIntervalMs >= kMax6675ConversionMs);

  FakeMax6675Transport transport;
  transport.next_frame = static_cast<std::uint16_t>(373U << 3U);
  Max6675 sensor(transport, 0);

  const auto early = sensor.read(219);
  assert(early.status == ThermocoupleStatus::kNotReady);
  assert(transport.read_count == 0);

  const auto first = sensor.read(220);
  assert(first.status == ThermocoupleStatus::kOk);
  assert(first.temperature_c == 93.25F);
  assert(transport.read_count == 1);

  sensor.read(439);
  assert(transport.read_count == 1);

  transport.next_frame = 0x0004;
  const auto open = sensor.read(440);
  assert(open.status == ThermocoupleStatus::kOpenCircuit);

  transport.next_frame = 0x0002;
  const auto invalid = sensor.read(660);
  assert(invalid.status == ThermocoupleStatus::kInvalidFrame);

  transport.succeeds = false;
  const auto transport_error = sensor.read(880);
  assert(transport_error.status == ThermocoupleStatus::kTransportError);

  FakeMax6675Transport rollover_transport;
  rollover_transport.next_frame = static_cast<std::uint16_t>(400U << 3U);
  Max6675 rollover_sensor(rollover_transport, 0xFFFFFF80U);
  assert(rollover_sensor.read(0x0000005BU).status ==
         ThermocoupleStatus::kNotReady);
  assert(rollover_sensor.read(0x0000005CU).status == ThermocoupleStatus::kOk);
}

void test_event_driven_hx711_acquisition() {
  FakeHx711Transport transport;
  transport.readings = {
      {Hx711Status::kOk, 11111},
      {Hx711Status::kNotReady, 0},
      {Hx711Status::kOk, 12345},
      {Hx711Status::kNotReady, 0},
      {Hx711Status::kNotReady, 0},
      {Hx711Status::kNotReady, 0},
      {Hx711Status::kNotReady, 0},
      {Hx711Status::kNotReady, 0},
      {Hx711Status::kOk, 23456},
      {Hx711Status::kTransportError, 0},
      {Hx711Status::kSaturated, 0},
  };
  Hx711 hx711(transport);
  FakeHx711ReadyWaiter waiter;
  Hx711EventDrivenAcquisition acquisition(hx711, waiter);

  const auto already_ready = acquisition.acquire(
      philcoino::config::kScaleUnavailableTimeoutMs);
  assert(already_ready.status == Hx711Status::kOk);
  assert(already_ready.raw == 11111);
  assert(transport.read_count == 1U);
  assert(waiter.wait_count == 0U);

  waiter.notify_from_isr();
  waiter.notify_from_isr();
  assert(transport.read_count == 1U);
  const auto ready_before_wait = acquisition.acquire(
      philcoino::config::kScaleUnavailableTimeoutMs);
  assert(ready_before_wait.status == Hx711Status::kOk);
  assert(ready_before_wait.raw == 12345);
  assert(waiter.pending_notifications == 0U);
  assert(waiter.wait_count == 1U);
  assert(transport.read_count == 3U);

  const auto first_timeout = acquisition.acquire(
      philcoino::config::kScaleUnavailableTimeoutMs);
  const auto repeated_timeout = acquisition.acquire(
      philcoino::config::kScaleUnavailableTimeoutMs);
  assert(first_timeout.status == Hx711Status::kNotReady);
  assert(repeated_timeout.status == Hx711Status::kNotReady);
  assert(waiter.wait_count == 3U);
  assert(waiter.last_timeout_ms ==
         philcoino::config::kScaleUnavailableTimeoutMs);
  assert(transport.read_count == 7U);

  waiter.notify_from_isr();
  const auto recovered = acquisition.acquire(
      philcoino::config::kScaleUnavailableTimeoutMs);
  assert(recovered.status == Hx711Status::kOk);
  assert(recovered.raw == 23456);

  waiter.notify_from_isr();
  assert(acquisition.acquire(philcoino::config::kScaleUnavailableTimeoutMs)
             .status == Hx711Status::kTransportError);
  waiter.notify_from_isr();
  assert(acquisition.acquire(philcoino::config::kScaleUnavailableTimeoutMs)
             .status == Hx711Status::kSaturated);
  assert(waiter.wait_count == 4U);
  assert(transport.read_count == 11U);
}

void test_target_storage() {
  MemoryState state;
  {
    MemoryBackend backend(state);
    TargetStorage storage(backend);
    TemperatureTargets targets{};
    assert(storage.load(targets) == TargetLoadResult::kInitializedDefaults);
    assert(targets.brew_c == 93);
    assert(targets.steam_c == 115);
    assert(storage.save({95, 135}));
    assert(!storage.save({84, 135}));
  }
  {
    MemoryBackend restarted_backend(state);
    TargetStorage restarted_storage(restarted_backend);
    TemperatureTargets restored{};
    assert(restarted_storage.load(restored) == TargetLoadResult::kOk);
    assert(restored.brew_c == 95);
    assert(restored.steam_c == 135);
  }

  state.targets = {96, 115};
  MemoryBackend corrupt_backend(state);
  TargetStorage corrupt_storage(corrupt_backend);
  TemperatureTargets corrupt{};
  assert(corrupt_storage.load(corrupt) == TargetLoadResult::kCorrupt);
}

void test_temperature_calibration_storage_and_conversion() {
  TemperatureCalibrationMemoryState state;
  TemperatureCalibrationMemoryBackend backend(state);
  TemperatureCalibrationStorage storage(backend);
  TemperatureCalibration calibration{99, true};

  assert(storage.load(calibration) ==
         TemperatureCalibrationLoadResult::kNotCalibrated);
  assert(calibration.offset_c == 0);
  assert(!calibration.calibrated);
  assert(!state.present);

  assert(storage.save({0, true}));
  TemperatureCalibration restored{};
  assert(storage.load(restored) == TemperatureCalibrationLoadResult::kOk);
  assert(restored.offset_c == 0);
  assert(restored.calibrated);

  for (const auto value : std::array<TemperatureCalibration, 3>{
           TemperatureCalibration{-8, true},
           TemperatureCalibration{5, true},
           TemperatureCalibration{0, true},
       }) {
    assert(storage.save(value));
    assert(effective_temperature_c(
               static_cast<float>(
                   philcoino::config::kTemperatureCalibrationReferenceC -
                   value.offset_c),
               value) == 100.0F);
  }

  assert(!storage.save({-21, true}));
  assert(!storage.save({11, true}));
  assert(!storage.save({0, false}));

  state.calibration = {-21, true};
  assert(storage.load(restored) ==
         TemperatureCalibrationLoadResult::kCorrupt);
  state.fail_load = true;
  assert(storage.load(restored) == TemperatureCalibrationLoadResult::kError);
  state.fail_load = false;
  state.fail_save = true;
  assert(!storage.save({-8, true}));

  assert(targets_are_reachable({95, 120}, {-8, true}));
  assert(targets_are_reachable({95, 120}, {10, true}));
  assert(targets_are_reachable({95, 115}, {-20, true}));
  assert(!targets_are_reachable({95, 116}, {-20, true}));
  assert(target_is_reachable(115, {-20, true}));
  assert(!target_is_reachable(116, {-20, true}));
  assert(target_is_reachable(135, {0, false}));
  assert(!target_is_reachable(135, {-1, true}));
}

void test_steam_control_settings_storage_defaults_validation_and_failures() {
  SteamControlMemoryState missing{};
  SteamControlMemoryBackend missing_backend(missing);
  SteamControlSettingsStorage missing_storage(missing_backend);
  SteamControlSettings settings{};
  assert(missing_storage.load(settings) ==
         SteamControlSettingsLoadResult::kInitializedDefaults);
  assert(missing.present);
  assert(missing.save_count == 1);
  assert(settings.initial_compensation_c ==
         philcoino::config::kSteamCompensationInitialDefaultC);
  assert(settings.decay_duration_ms ==
         philcoino::config::kSteamCompensationDecayDefaultMs);
  assert(settings.ready_timeout_ms ==
         philcoino::config::kSteamReadyTimeoutMs);

  const SteamControlSettings tuned{15, 10U * 60U * 1000U,
                                   7U * 60U * 1000U};
  assert(missing_storage.save(tuned));
  SteamControlSettings loaded{};
  assert(missing_storage.load(loaded) ==
         SteamControlSettingsLoadResult::kOk);
  assert(loaded.initial_compensation_c == 15);
  assert(loaded.decay_duration_ms == 600000U);
  assert(loaded.ready_timeout_ms == 420000U);

  SteamControlMemoryState corrupt{};
  corrupt.present = true;
  corrupt.settings = {21, 60000U, 60000U};
  SteamControlMemoryBackend corrupt_backend(corrupt);
  SteamControlSettingsStorage corrupt_storage(corrupt_backend);
  assert(corrupt_storage.load(loaded) ==
         SteamControlSettingsLoadResult::kCorrupt);

  SteamControlMemoryState unreadable{};
  unreadable.fail_load = true;
  SteamControlMemoryBackend unreadable_backend(unreadable);
  SteamControlSettingsStorage unreadable_storage(unreadable_backend);
  assert(unreadable_storage.load(loaded) ==
         SteamControlSettingsLoadResult::kError);

  SteamControlMemoryState unsavable{};
  unsavable.fail_save = true;
  SteamControlMemoryBackend unsavable_backend(unsavable);
  SteamControlSettingsStorage unsavable_storage(unsavable_backend);
  assert(unsavable_storage.load(loaded) ==
         SteamControlSettingsLoadResult::kError);
  assert(!unsavable_storage.save(tuned));
}

ExtractionProfile configured_profile(const char* name, std::uint8_t pre,
                                     std::uint8_t soak, std::uint8_t main) {
  ExtractionProfile profile{};
  profile.configured = true;
  for (std::size_t index = 0;
       name[index] != '\0' && index + 1U < profile.name.size(); ++index) {
    profile.name[index] = name[index];
  }
  profile.pre_infusion_seconds = pre;
  profile.soak_seconds = soak;
  profile.main_extraction_seconds = main;
  return profile;
}

void test_inline_profile_validation() {
  assert(extraction_profile_is_valid(
      configured_profile("Long40", 5U, 5U, 30U)));
  assert(!extraction_profile_is_valid(
      configured_profile("Bad name", 0U, 0U, 30U)));
  auto invalid = configured_profile("Valid", 0U, 0U, 30U);
  invalid.name.fill('A');
  assert(!extraction_profile_is_valid(invalid));
  assert(!extraction_profile_is_valid(
      configured_profile("NoPre", 0U, 5U, 25U)));
  assert(!extraction_profile_is_valid(
      configured_profile("TooLong", 30U, 20U, 11U)));
  invalid = {};
  invalid.name[0] = 'X';
  assert(!extraction_profile_is_valid(invalid));
}

void test_fail_off_pump() {
  FakeOutputCriticalSection critical_section;
  FakeDigitalOutput output;
  FailOffPump pump(output, critical_section);
  assert(pump.initialize());
  assert((output.events == std::vector<OutputEvent>{OutputEvent::kLow,
                                                    OutputEvent::kConfigure,
                                                    OutputEvent::kLow}));
  assert(!output.level);
  assert(pump.command() == PumpCommand::kOff);
  assert(pump.set_running(true));
  assert(output.level);
  assert(pump.command() == PumpCommand::kRunning);
  assert(pump.force_off());
  assert(!output.level);
  assert(pump.command() == PumpCommand::kOff);

  FakeDigitalOutput configuration_error;
  configuration_error.fail_configure = true;
  FailOffPump failed_pump(configuration_error, critical_section);
  assert(!failed_pump.initialize());
  assert(!configuration_error.level);
  assert(failed_pump.command() == PumpCommand::kOff);
  assert(!failed_pump.set_running(true));

  FakeDigitalOutput high_error;
  FailOffPump high_error_pump(high_error, critical_section);
  assert(high_error_pump.initialize());
  high_error.fail_high = true;
  const auto failure_start = high_error.events.size();
  assert(!high_error_pump.set_running(true));
  assert((std::vector<OutputEvent>(high_error.events.begin() + failure_start,
                                  high_error.events.end()) ==
          std::vector<OutputEvent>{OutputEvent::kHigh, OutputEvent::kLow}));
  assert(!high_error.level);
  assert(high_error_pump.command() == PumpCommand::kOff);

  FakeDigitalOutput stuck_high;
  FailOffPump stuck_high_pump(stuck_high, critical_section);
  assert(stuck_high_pump.initialize());
  assert(stuck_high_pump.set_running(true));
  stuck_high.fail_low = true;
  stuck_high.preserve_level_on_failure = true;
  assert(!stuck_high_pump.force_off());
  assert(stuck_high.level);
  assert(stuck_high_pump.command() == PumpCommand::kRunning);
  assert(stuck_high_pump.output_state_unknown());
  assert(!stuck_high_pump.set_running(true));
  assert(stuck_high_pump.output_state_unknown());
  stuck_high.fail_low = false;
  assert(stuck_high_pump.force_off());
  assert(stuck_high_pump.command() == PumpCommand::kOff);
  assert(!stuck_high_pump.output_state_unknown());
}

void test_fail_off_ssr() {
  FakeOutputCriticalSection critical_section;
  FakeDigitalOutput output;
  FakeSafetyLease safety_lease(output);
  FailOffSsr ssr(output, safety_lease, critical_section);
  assert(ssr.initialize());
  assert((output.events == std::vector<OutputEvent>{OutputEvent::kLow,
                                                    OutputEvent::kConfigure,
                                                    OutputEvent::kLow,
                                                    OutputEvent::kLeaseInitialize}));
  assert(!output.level);
  assert(!ssr.is_enabled());
  assert(ssr.set_enabled(true));
  assert((safety_lease.durations ==
          std::vector<std::uint32_t>{
              philcoino::config::kHeaterSafetyLeaseMs}));
  assert(ssr.is_enabled());

  const auto renewal_start = output.events.size();
  assert(ssr.set_enabled(true));
  assert((std::vector<OutputEvent>(output.events.begin() + renewal_start,
                                  output.events.end()) ==
          std::vector<OutputEvent>{OutputEvent::kLeaseArm,
                                   OutputEvent::kHigh}));

  const auto off_start = output.events.size();
  assert(ssr.set_enabled(false));
  assert((std::vector<OutputEvent>(output.events.begin() + off_start,
                                  output.events.end()) ==
          std::vector<OutputEvent>{OutputEvent::kLow,
                                   OutputEvent::kLeaseDisarm}));

  assert(ssr.set_enabled(true));
  output.fail_high = true;
  assert(!ssr.set_enabled(true));
  assert(!output.level);
  assert(!ssr.is_enabled());

  FakeDigitalOutput configuration_error;
  configuration_error.fail_configure = true;
  FakeSafetyLease configuration_error_lease(configuration_error);
  FailOffSsr failed_ssr(configuration_error, configuration_error_lease,
                        critical_section);
  assert(!failed_ssr.initialize());
  assert(!configuration_error.level);
  assert(!failed_ssr.set_enabled(true));
  assert(!configuration_error.level);

  FakeDigitalOutput active_low_output;
  FakeSafetyLease active_low_lease(active_low_output, true);
  FailOffSsr active_low_ssr(active_low_output, active_low_lease,
                            critical_section, false);
  assert(active_low_ssr.initialize());
  assert(active_low_output.level);
  assert(active_low_ssr.set_enabled(true));
  assert(!active_low_output.level);
  assert(active_low_ssr.force_off());
  assert(active_low_output.level);

  FakeDigitalOutput lease_failure_output;
  FakeSafetyLease lease_failure(lease_failure_output);
  FailOffSsr lease_failure_ssr(lease_failure_output, lease_failure,
                               critical_section);
  lease_failure.fail_initialize = true;
  assert(!lease_failure_ssr.initialize());
  assert(!lease_failure_output.level);

  FakeDigitalOutput arm_failure_output;
  FakeSafetyLease arm_failure(arm_failure_output);
  FailOffSsr arm_failure_ssr(arm_failure_output, arm_failure,
                             critical_section);
  assert(arm_failure_ssr.initialize());
  arm_failure.fail_arm = true;
  assert(!arm_failure_ssr.set_enabled(true));
  assert(!arm_failure_output.level);

  FakeDigitalOutput disarm_failure_output;
  FakeSafetyLease disarm_failure(disarm_failure_output);
  FailOffSsr disarm_failure_ssr(disarm_failure_output, disarm_failure,
                                critical_section);
  assert(disarm_failure_ssr.initialize());
  assert(disarm_failure_ssr.set_enabled(true));
  disarm_failure.fail_disarm = true;
  assert(!disarm_failure_ssr.set_enabled(false));
  assert(!disarm_failure_output.level);

  FakeDigitalOutput expired_output;
  FakeSafetyLease expiring_lease(expired_output);
  FailOffSsr expired_ssr(expired_output, expiring_lease, critical_section);
  assert(expired_ssr.initialize());
  assert(expired_ssr.set_enabled(true));
  expiring_lease.expire();
  assert(!expired_output.level);
  assert(expired_ssr.safety_cutoff_tripped());
  assert(!expired_ssr.is_enabled());
  assert(!expired_ssr.set_enabled(true));
  assert(!expired_output.level);
}

void test_emergency_inhibit_serializes_with_in_progress_high_commands() {
  {
    MutexOutputCriticalSection critical_section;
    BlockingHighOutput output;
    SimpleSafetyLease safety_lease;
    FailOffSsr ssr(output, safety_lease, critical_section);
    assert(ssr.initialize());

    std::atomic<bool> emergency_started{false};
    std::thread enable([&] { assert(ssr.set_enabled(true)); });
    output.wait_for_high();
    std::thread emergency([&] {
      emergency_started.store(true, std::memory_order_release);
      assert(ssr.emergency_off());
    });
    while (!emergency_started.load(std::memory_order_acquire)) {
      std::this_thread::yield();
    }
    assert(!ssr.emergency_inhibited());
    output.release_high();
    enable.join();
    emergency.join();

    assert(ssr.emergency_inhibited());
    assert(!ssr.is_enabled());
    assert(!output.level);
    assert(safety_lease.disarm_count == 0);
    assert(ssr.force_off());
    assert(safety_lease.disarm_count == 0);
    assert(!ssr.set_enabled(true));
    assert(!output.level);
  }

  {
    MutexOutputCriticalSection critical_section;
    BlockingHighOutput output;
    FailOffPump pump(output, critical_section);
    assert(pump.initialize());

    std::atomic<bool> emergency_started{false};
    std::thread enable([&] { assert(pump.set_running(true)); });
    output.wait_for_high();
    std::thread emergency([&] {
      emergency_started.store(true, std::memory_order_release);
      assert(pump.emergency_off());
    });
    while (!emergency_started.load(std::memory_order_acquire)) {
      std::this_thread::yield();
    }
    assert(!pump.emergency_inhibited());
    output.release_high();
    enable.join();
    emergency.join();

    assert(pump.emergency_inhibited());
    assert(pump.command() == PumpCommand::kOff);
    assert(!output.level);
    assert(!pump.set_running(true));
    assert(!output.level);
  }
}

}  // namespace

int main() {
  test_thermocouple();
  test_event_driven_hx711_acquisition();
  test_target_storage();
  test_temperature_calibration_storage_and_conversion();
  test_steam_control_settings_storage_defaults_validation_and_failures();
  test_inline_profile_validation();
  test_fail_off_pump();
  test_fail_off_ssr();
  test_emergency_inhibit_serializes_with_in_progress_high_commands();
  return 0;
}
