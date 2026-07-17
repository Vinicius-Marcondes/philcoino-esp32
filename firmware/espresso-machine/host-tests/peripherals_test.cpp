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

struct MemoryState {
  bool present{false};
  bool fail_load{false};
  bool fail_save{false};
  TemperatureTargets targets{};
};

struct ProfileMemoryState {
  bool present{false};
  bool fail_load{false};
  bool fail_save{false};
  ExtractionProfiles profiles{};
};

class ProfileMemoryBackend final : public ProfileBackend {
 public:
  explicit ProfileMemoryBackend(ProfileMemoryState& state) : state_(state) {}

  BackendLoadResult load(ExtractionProfiles& profiles) override {
    if (state_.fail_load) {
      return BackendLoadResult::kError;
    }
    if (!state_.present) {
      return BackendLoadResult::kNotFound;
    }
    profiles = state_.profiles;
    return BackendLoadResult::kOk;
  }

  bool save(const ExtractionProfiles& profiles) override {
    if (state_.fail_save) {
      return false;
    }
    state_.profiles = profiles;
    state_.present = true;
    return true;
  }

 private:
  ProfileMemoryState& state_;
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

class FakeOledTransport final : public OledTransport {
 public:
  bool write_command(const std::uint8_t* bytes, std::size_t length) override {
    commands.insert(commands.end(), bytes, bytes + length);
    return succeed;
  }

  bool write_data(const std::uint8_t* bytes, std::size_t length) override {
    data.assign(bytes, bytes + length);
    return succeed;
  }

  std::vector<std::uint8_t> commands{};
  std::vector<std::uint8_t> data{};
  bool succeed{true};
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

void test_target_storage() {
  MemoryState state;
  {
    MemoryBackend backend(state);
    TargetStorage storage(backend);
    TemperatureTargets targets{};
    assert(storage.load(targets) == TargetLoadResult::kInitializedDefaults);
    assert(targets.brew_c == 93);
    assert(targets.steam_c == 115);
    assert(storage.save({95, 120}));
    assert(!storage.save({84, 120}));
  }
  {
    MemoryBackend restarted_backend(state);
    TargetStorage restarted_storage(restarted_backend);
    TemperatureTargets restored{};
    assert(restarted_storage.load(restored) == TargetLoadResult::kOk);
    assert(restored.brew_c == 95);
    assert(restored.steam_c == 120);
  }

  state.targets = {96, 115};
  MemoryBackend corrupt_backend(state);
  TargetStorage corrupt_storage(corrupt_backend);
  TemperatureTargets corrupt{};
  assert(corrupt_storage.load(corrupt) == TargetLoadResult::kCorrupt);
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

bool profiles_equal(const ExtractionProfiles& left,
                    const ExtractionProfiles& right) {
  for (std::size_t index = 0; index < left.size(); ++index) {
    if (left[index].configured != right[index].configured ||
        left[index].name != right[index].name ||
        left[index].pre_infusion_seconds !=
            right[index].pre_infusion_seconds ||
        left[index].soak_seconds != right[index].soak_seconds ||
        left[index].main_extraction_seconds !=
            right[index].main_extraction_seconds) {
      return false;
    }
  }
  return true;
}

void test_profile_storage() {
  ProfileMemoryState state;
  ExtractionProfiles profiles{};
  {
    ProfileMemoryBackend backend(state);
    ProfileStorage storage(backend);
    assert(storage.load(profiles) == ProfileLoadResult::kInitializedDefaults);
    assert(profiles_equal(profiles, default_extraction_profiles()));
    assert(profiles[0].configured);
    assert(profiles[1].configured);
    assert(!profiles[2].configured);
    assert(!profiles[3].configured);

    auto replacement = profiles;
    replacement[2] = configured_profile("Long40", 5U, 5U, 30U);
    assert(storage.save(replacement));
    assert(profiles_equal(state.profiles, replacement));

    state.fail_save = true;
    auto failed_replacement = replacement;
    failed_replacement[0] = configured_profile("Short20", 0U, 0U, 20U);
    assert(!storage.save(failed_replacement));
    assert(profiles_equal(state.profiles, replacement));
  }
  {
    ProfileMemoryBackend restarted_backend(state);
    ProfileStorage restarted_storage(restarted_backend);
    ExtractionProfiles restored{};
    assert(restarted_storage.load(restored) == ProfileLoadResult::kOk);
    assert(profiles_equal(restored, state.profiles));
  }

  auto invalid = default_extraction_profiles();
  invalid[0] = configured_profile("Bad name", 0U, 0U, 30U);
  assert(!extraction_profiles_are_valid(invalid));
  invalid[0] = configured_profile("Valid", 0U, 0U, 30U);
  invalid[0].name.fill('A');
  assert(!extraction_profiles_are_valid(invalid));
  invalid[0] = configured_profile("NoPre", 0U, 5U, 25U);
  assert(!extraction_profiles_are_valid(invalid));
  invalid[0] = configured_profile("TooLong", 30U, 20U, 11U);
  assert(!extraction_profiles_are_valid(invalid));
  invalid[0] = {};
  invalid[0].name[0] = 'X';
  assert(!extraction_profiles_are_valid(invalid));

  state.fail_save = false;
  state.profiles = invalid;
  ProfileMemoryBackend corrupt_backend(state);
  ProfileStorage corrupt_storage(corrupt_backend);
  ExtractionProfiles corrupt{};
  assert(corrupt_storage.load(corrupt) == ProfileLoadResult::kCorrupt);

  state.fail_load = true;
  ProfileMemoryBackend failed_backend(state);
  ProfileStorage failed_storage(failed_backend);
  assert(failed_storage.load(corrupt) == ProfileLoadResult::kError);
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

void test_oled() {
  FakeOledTransport transport;
  Ssd1306Display display(transport);
  DisplaySnapshot snapshot{};
  snapshot.boiler = {true, 93.25F};
  snapshot.targets = {93, 115};
  snapshot.mode = DisplayMode::kBrew;
  snapshot.status = DisplayStatus::kReady;
  snapshot.heater_enabled = true;

  std::array<char, 24> temperature_line{};
  format_display_temperature_line(temperature_line.data(),
                                  temperature_line.size(),
                                  {true, 120.0F}, 120);
  assert(std::string(temperature_line.data()) == "TEMP 120.0/120");
  format_display_temperature_line(temperature_line.data(),
                                  temperature_line.size(), {}, 120);
  assert(std::string(temperature_line.data()) == "TEMP --.-/120");

  assert(!display.render(snapshot));
  assert(display.initialize());
  assert(std::find(transport.commands.begin(), transport.commands.end(), 0x1F) !=
         transport.commands.end());
  assert(display.render(snapshot));
  assert(transport.data.size() == Ssd1306Display::kBufferSize);
  assert(std::any_of(transport.data.begin(), transport.data.end(),
                     [](std::uint8_t value) { return value != 0; }));
  const auto wifi_off_frame = transport.data;
  constexpr std::array wifi_states{
      DisplayWifiStatus::kConnecting,
      DisplayWifiStatus::kConnected,
      DisplayWifiStatus::kRetrying,
      DisplayWifiStatus::kFailed,
  };
  for (const auto wifi_status : wifi_states) {
    snapshot.wifi_status = wifi_status;
    assert(display.render(snapshot));
    assert(std::equal(wifi_off_frame.begin(),
                      wifi_off_frame.begin() + 3 * Ssd1306Display::kWidth,
                      transport.data.begin()));
    assert(!std::equal(wifi_off_frame.begin() + 3 * Ssd1306Display::kWidth,
                       wifi_off_frame.end(),
                       transport.data.begin() + 3 * Ssd1306Display::kWidth));
  }
  const auto idle_frame = transport.data;
  snapshot.extraction_active = true;
  snapshot.pump_command = PumpCommand::kOff;
  snapshot.extraction_phase = "SOAK";
  std::array<char, 24> workflow_line{};
  format_display_workflow_line(workflow_line.data(), workflow_line.size(),
                               snapshot);
  assert(std::string(workflow_line.data()) == "PUMP CMD OFF SOAK");
  assert(display.render(snapshot));
  assert(std::equal(idle_frame.begin(),
                    idle_frame.begin() + 3 * Ssd1306Display::kWidth,
                    transport.data.begin()));
  assert(!std::equal(idle_frame.begin() + 3 * Ssd1306Display::kWidth,
                     idle_frame.end(),
                     transport.data.begin() + 3 * Ssd1306Display::kWidth));
  snapshot.pump_command = PumpCommand::kRunning;
  snapshot.extraction_phase = "MAN";
  snapshot.compensation_active = true;
  format_display_workflow_line(workflow_line.data(), workflow_line.size(),
                               snapshot);
  assert(std::string(workflow_line.data()) == "PUMP CMD RUN MAN +2C");
  snapshot.extraction_active = false;
  snapshot.compensation_active = false;
  snapshot.cooldown_status = DisplayCooldownStatus::kPumping;
  format_display_workflow_line(workflow_line.data(), workflow_line.size(),
                               snapshot);
  assert(std::string(workflow_line.data()) == "COOL CMD PUMP RUN");
  snapshot.cooldown_status = DisplayCooldownStatus::kStabilizing;
  format_display_workflow_line(workflow_line.data(), workflow_line.size(),
                               snapshot);
  assert(std::string(workflow_line.data()) == "STAB CMD PUMP OFF");
  snapshot.cooldown_status = DisplayCooldownStatus::kIdle;
  snapshot.pump_command = PumpCommand::kRunning;
  format_display_workflow_line(workflow_line.data(), workflow_line.size(),
                               snapshot);
  assert(std::string(workflow_line.data()) == "PUMP CMD RUN FAULT");
  assert(transport.commands.size() == 61);
}

}  // namespace

int main() {
  test_thermocouple();
  test_target_storage();
  test_profile_storage();
  test_fail_off_pump();
  test_fail_off_ssr();
  test_emergency_inhibit_serializes_with_in_progress_high_commands();
  test_oled();
  return 0;
}
