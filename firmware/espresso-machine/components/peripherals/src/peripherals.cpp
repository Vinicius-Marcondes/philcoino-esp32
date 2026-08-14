#include "philcoino/peripherals.hpp"

#include <algorithm>
#include <array>

#include "philcoino/config.hpp"

namespace philcoino::peripherals {
namespace {

static_assert(config::kHeaterSafetyLeaseMs > 2U * kMax6675SampleIntervalMs);
static_assert(config::kHeaterSafetyLeaseMs < config::kHeaterControlWindowMs);

bool deadline_reached(std::uint32_t now, std::uint32_t deadline) {
  return static_cast<std::int32_t>(now - deadline) >= 0;
}

class ScopedOutputCriticalSection {
 public:
  explicit ScopedOutputCriticalSection(OutputCriticalSection& critical_section)
      : critical_section_(critical_section) {
    critical_section_.enter();
  }

  ~ScopedOutputCriticalSection() { critical_section_.exit(); }

  ScopedOutputCriticalSection(const ScopedOutputCriticalSection&) = delete;
  ScopedOutputCriticalSection& operator=(const ScopedOutputCriticalSection&) =
      delete;

 private:
  OutputCriticalSection& critical_section_;
};

bool ascii_alphanumeric(char value) {
  return (value >= 'A' && value <= 'Z') ||
         (value >= 'a' && value <= 'z') ||
         (value >= '0' && value <= '9');
}

}  // namespace

Max6675::Max6675(Max6675Transport& transport, std::uint32_t started_at_ms)
    : transport_(transport),
      ready_at_ms_(started_at_ms + kMax6675ConversionMs) {}

ThermocoupleReading Max6675::read(std::uint32_t now_ms) {
  if (!deadline_reached(now_ms, ready_at_ms_)) {
    return {};
  }

  ThermocoupleReading reading{};
  std::uint16_t frame = 0;
  if (transport_.read_frame(frame)) {
    reading = decode(frame);
  } else {
    reading.status = ThermocoupleStatus::kTransportError;
  }
  ready_at_ms_ = now_ms + kMax6675ConversionMs;
  return reading;
}

ThermocoupleReading Max6675::decode(std::uint16_t frame) {
  ThermocoupleReading reading{};
  reading.raw_frame = frame;
  if ((frame & 0x0004U) != 0U) {
    reading.status = ThermocoupleStatus::kOpenCircuit;
    return reading;
  }
  if ((frame & 0x8002U) != 0U) {
    reading.status = ThermocoupleStatus::kInvalidFrame;
    return reading;
  }
  reading.status = ThermocoupleStatus::kOk;
  reading.temperature_c = static_cast<float>((frame >> 3U) & 0x0FFFU) * 0.25F;
  return reading;
}

Hx711::Hx711(Hx711Transport& transport) : transport_(transport) {}

Hx711Reading Hx711::read() { return transport_.read(); }

Hx711EventDrivenAcquisition::Hx711EventDrivenAcquisition(
    Hx711& hx711, Hx711ReadyWaiter& waiter)
    : hx711_(hx711), waiter_(waiter) {}

Hx711Reading Hx711EventDrivenAcquisition::acquire(
    std::uint32_t timeout_ms) {
  // A conversion may have completed just before the task starts waiting. In
  // that case DT is already low and no new falling edge will arrive until the
  // current sample is clocked out. Always check the level-backed transport
  // first, then use the notification only to avoid polling while not ready.
  const auto immediate = hx711_.read();
  if (immediate.status != Hx711Status::kNotReady) {
    return immediate;
  }
  waiter_.wait(timeout_ms);
  return hx711_.read();
}

bool scale_calibration_is_valid(const ScaleCalibration& calibration) {
  if (calibration.reference_decigrams <
          config::kScaleCalibrationReferenceMinimumDecigrams ||
      calibration.reference_decigrams >
          config::kScaleCalibrationReferenceMaximumDecigrams) {
    return false;
  }
  const auto span = static_cast<std::int64_t>(calibration.reference_raw) -
                    static_cast<std::int64_t>(calibration.zero_raw);
  return span != 0 && span >= -0x7FFFFFLL && span <= 0x7FFFFFLL;
}

bool scale_raw_to_decigrams(const ScaleCalibration& calibration,
                            std::int32_t raw,
                            std::int32_t& decigrams) {
  if (!scale_calibration_is_valid(calibration)) {
    return false;
  }
  const auto span = static_cast<std::int64_t>(calibration.reference_raw) -
                    static_cast<std::int64_t>(calibration.zero_raw);
  const auto delta = static_cast<std::int64_t>(raw) -
                     static_cast<std::int64_t>(calibration.zero_raw);
  const auto scaled =
      delta * static_cast<std::int64_t>(calibration.reference_decigrams);
  const auto value = scaled / span;
  if (value < -500LL || value > 10500LL) {
    return false;
  }
  decigrams = static_cast<std::int32_t>(value);
  return true;
}

ScaleCalibrationStorage::ScaleCalibrationStorage(
    ScaleCalibrationBackend& backend)
    : backend_(backend) {}

ScaleCalibrationLoadResult ScaleCalibrationStorage::load(
    ScaleCalibration& calibration) {
  const auto result = backend_.load(calibration);
  if (result == BackendLoadResult::kNotFound) {
    calibration = {};
    return ScaleCalibrationLoadResult::kNotCalibrated;
  }
  if (result == BackendLoadResult::kError) {
    return ScaleCalibrationLoadResult::kError;
  }
  return scale_calibration_is_valid(calibration)
             ? ScaleCalibrationLoadResult::kOk
             : ScaleCalibrationLoadResult::kCorrupt;
}

bool ScaleCalibrationStorage::save(const ScaleCalibration& calibration) {
  return scale_calibration_is_valid(calibration) &&
         backend_.save(calibration);
}

bool targets_are_valid(const TemperatureTargets& targets) {
  return targets.brew_c >= config::kBrewTargetMinimumC &&
         targets.brew_c <= config::kBrewTargetMaximumC &&
         targets.steam_c >= config::kSteamTargetMinimumC &&
         targets.steam_c <= config::kSteamTargetMaximumC;
}

bool temperature_calibration_is_valid(
    const TemperatureCalibration& calibration) {
  if (!calibration.calibrated) {
    return calibration.offset_c == 0;
  }
  return calibration.offset_c >=
             config::kTemperatureCalibrationOffsetMinimumC &&
         calibration.offset_c <=
             config::kTemperatureCalibrationOffsetMaximumC;
}

float effective_temperature_c(
    float raw_temperature_c,
    const TemperatureCalibration& calibration) {
  return raw_temperature_c + static_cast<float>(calibration.offset_c);
}

bool target_is_reachable(
    std::int32_t effective_target_c,
    const TemperatureCalibration& calibration) {
  if (!temperature_calibration_is_valid(calibration)) {
    return false;
  }
  const auto raw_target_c = effective_target_c - calibration.offset_c;
  return raw_target_c <= config::kRawBoilerOverTemperatureC;
}

bool targets_are_reachable(
    const TemperatureTargets& targets,
    const TemperatureCalibration& calibration) {
  return targets_are_valid(targets) &&
         target_is_reachable(targets.brew_c, calibration) &&
         target_is_reachable(targets.steam_c, calibration);
}

bool steam_control_settings_are_valid(
    const SteamControlSettings& settings) {
  return settings.initial_compensation_c >=
             config::kSteamCompensationInitialMinimumC &&
         settings.initial_compensation_c <=
             config::kSteamCompensationInitialMaximumC &&
         settings.decay_duration_ms >=
             config::kSteamCompensationDecayMinimumMs &&
         settings.decay_duration_ms <=
             config::kSteamCompensationDecayMaximumMs &&
         settings.decay_duration_ms % config::kSteamSettingTimeStepMs == 0U &&
         settings.ready_timeout_ms >= config::kSteamReadyTimeoutMinimumMs &&
         settings.ready_timeout_ms <= config::kSteamReadyTimeoutMaximumMs &&
         settings.ready_timeout_ms % config::kSteamSettingTimeStepMs == 0U;
}

SteamControlSettingsStorage::SteamControlSettingsStorage(
    SteamControlSettingsBackend& backend)
    : backend_(backend) {}

SteamControlSettingsLoadResult SteamControlSettingsStorage::load(
    SteamControlSettings& settings) {
  const auto result = backend_.load(settings);
  if (result == BackendLoadResult::kError) {
    return SteamControlSettingsLoadResult::kError;
  }
  if (result == BackendLoadResult::kNotFound) {
    settings = {};
    return backend_.save(settings)
               ? SteamControlSettingsLoadResult::kInitializedDefaults
               : SteamControlSettingsLoadResult::kError;
  }
  return steam_control_settings_are_valid(settings)
             ? SteamControlSettingsLoadResult::kOk
             : SteamControlSettingsLoadResult::kCorrupt;
}

bool SteamControlSettingsStorage::save(
    const SteamControlSettings& settings) {
  return steam_control_settings_are_valid(settings) &&
         backend_.save(settings);
}

TemperatureCalibrationStorage::TemperatureCalibrationStorage(
    TemperatureCalibrationBackend& backend)
    : backend_(backend) {}

TemperatureCalibrationLoadResult TemperatureCalibrationStorage::load(
    TemperatureCalibration& calibration) {
  const auto result = backend_.load(calibration);
  if (result == BackendLoadResult::kNotFound) {
    calibration = {};
    return TemperatureCalibrationLoadResult::kNotCalibrated;
  }
  if (result == BackendLoadResult::kError) {
    return TemperatureCalibrationLoadResult::kError;
  }
  return temperature_calibration_is_valid(calibration) &&
                 calibration.calibrated
             ? TemperatureCalibrationLoadResult::kOk
             : TemperatureCalibrationLoadResult::kCorrupt;
}

bool TemperatureCalibrationStorage::save(
    const TemperatureCalibration& calibration) {
  return calibration.calibrated &&
         temperature_calibration_is_valid(calibration) &&
         backend_.save(calibration);
}

TargetStorage::TargetStorage(TargetBackend& backend) : backend_(backend) {}

TargetLoadResult TargetStorage::load(TemperatureTargets& targets) {
  const auto result = backend_.load(targets);
  if (result == BackendLoadResult::kError) {
    return TargetLoadResult::kError;
  }
  if (result == BackendLoadResult::kNotFound) {
    targets = {};
    return backend_.save(targets) ? TargetLoadResult::kInitializedDefaults
                                  : TargetLoadResult::kError;
  }
  return targets_are_valid(targets) ? TargetLoadResult::kOk
                                    : TargetLoadResult::kCorrupt;
}

bool TargetStorage::save(const TemperatureTargets& targets) {
  return targets_are_valid(targets) && backend_.save(targets);
}

bool extraction_profile_is_valid(const ExtractionProfile& profile) {
  if (!profile.configured) {
    return std::all_of(profile.name.begin(), profile.name.end(),
                       [](char value) { return value == '\0'; }) &&
           profile.pre_infusion_seconds == 0U && profile.soak_seconds == 0U &&
           profile.main_extraction_seconds == 0U;
  }

  std::size_t name_length = 0;
  while (name_length < profile.name.size() &&
         profile.name[name_length] != '\0') {
    if (!ascii_alphanumeric(profile.name[name_length])) {
      return false;
    }
    ++name_length;
  }
  if (name_length == 0U || name_length > 12U ||
      name_length == profile.name.size()) {
    return false;
  }
  if (!std::all_of(profile.name.begin() + name_length, profile.name.end(),
                   [](char value) { return value == '\0'; })) {
    return false;
  }
  if (profile.main_extraction_seconds == 0U ||
      (profile.pre_infusion_seconds == 0U && profile.soak_seconds != 0U)) {
    return false;
  }
  const auto total_seconds =
      static_cast<std::uint16_t>(profile.pre_infusion_seconds) +
      static_cast<std::uint16_t>(profile.soak_seconds) +
      static_cast<std::uint16_t>(profile.main_extraction_seconds);
  return total_seconds <= kMaximumExtractionDurationSeconds;
}

FailOffSsr::FailOffSsr(DigitalOutput& output, SsrSafetyLease& safety_lease,
                       OutputCriticalSection& critical_section,
                       bool active_high)
    : output_(output),
      safety_lease_(safety_lease),
      critical_section_(critical_section),
      active_high_(active_high) {}

bool FailOffSsr::initialize() {
  initialized_ = false;
  enabled_.store(false, std::memory_order_relaxed);
  emergency_inhibited_.store(false, std::memory_order_relaxed);
  if (!write_enabled_level(false)) {
    return false;
  }
  if (!output_.configure_output()) {
    write_enabled_level(false);
    return false;
  }
  if (!write_enabled_level(false)) {
    write_enabled_level(false);
    return false;
  }
  if (!safety_lease_.initialize()) {
    write_enabled_level(false);
    return false;
  }
  initialized_ = true;
  return true;
}

bool FailOffSsr::set_enabled(bool enabled) {
  if (!initialized_) {
    write_enabled_level(false);
    enabled_.store(false, std::memory_order_relaxed);
    return false;
  }

  if (safety_lease_.tripped() ||
      emergency_inhibited_.load(std::memory_order_acquire)) {
    ScopedOutputCriticalSection lock(critical_section_);
    write_enabled_level(false);
    enabled_.store(false, std::memory_order_relaxed);
    return false;
  }

  if (enabled) {
    if (!safety_lease_.arm(config::kHeaterSafetyLeaseMs) ||
        safety_lease_.tripped() ||
        emergency_inhibited_.load(std::memory_order_acquire)) {
      ScopedOutputCriticalSection lock(critical_section_);
      write_enabled_level(false);
      enabled_.store(false, std::memory_order_relaxed);
      return false;
    }
    ScopedOutputCriticalSection lock(critical_section_);
    if (emergency_inhibited_.load(std::memory_order_acquire) ||
        safety_lease_.tripped()) {
      write_enabled_level(false);
      enabled_.store(false, std::memory_order_relaxed);
      return false;
    }
    if (!write_enabled_level(true)) {
      const bool forced_off = write_enabled_level(false);
      if (forced_off) {
        safety_lease_.disarm();
      }
      enabled_.store(false, std::memory_order_relaxed);
      return false;
    }
    enabled_.store(true, std::memory_order_relaxed);
    return true;
  }

  ScopedOutputCriticalSection lock(critical_section_);
  const bool forced_off = write_enabled_level(false);
  enabled_.store(false, std::memory_order_relaxed);
  if (!forced_off) {
    return false;
  }
  return safety_lease_.disarm();
}

bool FailOffSsr::force_off() {
  ScopedOutputCriticalSection lock(critical_section_);
  enabled_.store(false, std::memory_order_relaxed);
  if (!write_enabled_level(false)) {
    return false;
  }
  if (emergency_inhibited_.load(std::memory_order_acquire)) {
    return true;
  }
  return safety_lease_.disarm();
}

bool FailOffSsr::emergency_off() {
  ScopedOutputCriticalSection lock(critical_section_);
  emergency_inhibited_.store(true, std::memory_order_release);
  enabled_.store(false, std::memory_order_relaxed);
  // Keep an already armed lease active as a second independent low transition.
  return write_enabled_level(false);
}

bool FailOffSsr::is_enabled() const {
  return enabled_.load(std::memory_order_relaxed) &&
         !emergency_inhibited_.load(std::memory_order_acquire) &&
         !safety_lease_.tripped();
}

bool FailOffSsr::emergency_inhibited() const {
  return emergency_inhibited_.load(std::memory_order_acquire);
}

bool FailOffSsr::safety_cutoff_tripped() const {
  return safety_lease_.tripped();
}

bool FailOffSsr::write_enabled_level(bool enabled) {
  const bool output_high = enabled ? active_high_ : !active_high_;
  return output_.set_level(output_high);
}

FailOffPump::FailOffPump(DigitalOutput& output,
                         OutputCriticalSection& critical_section,
                         bool active_high)
    : output_(output),
      critical_section_(critical_section),
      active_high_(active_high) {}

bool FailOffPump::initialize() {
  initialized_ = false;
  command_.store(PumpCommand::kOff, std::memory_order_relaxed);
  output_state_unknown_.store(true, std::memory_order_relaxed);
  emergency_inhibited_.store(false, std::memory_order_relaxed);
  if (!force_off()) {
    return false;
  }
  if (!output_.configure_output()) {
    force_off();
    return false;
  }
  if (!force_off()) {
    force_off();
    return false;
  }
  initialized_ = true;
  return true;
}

bool FailOffPump::set_running(bool running) {
  const auto requested = running ? PumpCommand::kRunning : PumpCommand::kOff;
  if (!initialized_) {
    force_off();
    return false;
  }
  if (running && (emergency_inhibited_.load(std::memory_order_acquire) ||
                  output_state_unknown_.load(std::memory_order_acquire))) {
    force_off();
    return false;
  }

  ScopedOutputCriticalSection lock(critical_section_);
  if (running && emergency_inhibited_.load(std::memory_order_acquire)) {
    const bool forced_off = write_command(PumpCommand::kOff);
    if (forced_off) {
      command_.store(PumpCommand::kOff, std::memory_order_relaxed);
      output_state_unknown_.store(false, std::memory_order_release);
    } else {
      output_state_unknown_.store(true, std::memory_order_release);
    }
    return false;
  }
  if (!write_command(requested)) {
    if (requested == PumpCommand::kRunning &&
        write_command(PumpCommand::kOff)) {
      command_.store(PumpCommand::kOff, std::memory_order_relaxed);
      output_state_unknown_.store(false, std::memory_order_release);
    } else {
      output_state_unknown_.store(true, std::memory_order_release);
    }
    return false;
  }
  command_.store(requested, std::memory_order_relaxed);
  output_state_unknown_.store(false, std::memory_order_release);
  return true;
}

bool FailOffPump::force_off() {
  ScopedOutputCriticalSection lock(critical_section_);
  const bool forced_off = write_command(PumpCommand::kOff);
  if (forced_off) {
    command_.store(PumpCommand::kOff, std::memory_order_relaxed);
    output_state_unknown_.store(false, std::memory_order_release);
  } else {
    output_state_unknown_.store(true, std::memory_order_release);
  }
  return forced_off;
}

bool FailOffPump::emergency_off() {
  ScopedOutputCriticalSection lock(critical_section_);
  emergency_inhibited_.store(true, std::memory_order_release);
  const bool forced_off = write_command(PumpCommand::kOff);
  if (forced_off) {
    command_.store(PumpCommand::kOff, std::memory_order_relaxed);
    output_state_unknown_.store(false, std::memory_order_release);
  } else {
    output_state_unknown_.store(true, std::memory_order_release);
  }
  return forced_off;
}

PumpCommand FailOffPump::command() const {
  return command_.load(std::memory_order_relaxed);
}

bool FailOffPump::output_state_unknown() const {
  return output_state_unknown_.load(std::memory_order_acquire);
}

bool FailOffPump::emergency_inhibited() const {
  return emergency_inhibited_.load(std::memory_order_acquire);
}

bool FailOffPump::write_command(PumpCommand command) {
  const bool running = command == PumpCommand::kRunning;
  return output_.set_level(running ? active_high_ : !active_high_);
}

}  // namespace philcoino::peripherals
