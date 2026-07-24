#include "philcoino/peripherals.hpp"

#include <algorithm>
#include <array>
#include <cinttypes>
#include <cstdio>

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

std::array<std::uint8_t, 5> glyph(char value) {
  switch (value) {
    case 'A': return {0x7E, 0x11, 0x11, 0x11, 0x7E};
    case 'B': return {0x7F, 0x49, 0x49, 0x49, 0x36};
    case 'D': return {0x7F, 0x41, 0x41, 0x22, 0x1C};
    case 'E': return {0x7F, 0x49, 0x49, 0x49, 0x41};
    case 'F': return {0x7F, 0x09, 0x09, 0x09, 0x01};
    case 'G': return {0x3E, 0x41, 0x49, 0x49, 0x7A};
    case 'H': return {0x7F, 0x08, 0x08, 0x08, 0x7F};
    case 'I': return {0x00, 0x41, 0x7F, 0x41, 0x00};
    case 'L': return {0x7F, 0x40, 0x40, 0x40, 0x40};
    case 'M': return {0x7F, 0x02, 0x0C, 0x02, 0x7F};
    case 'N': return {0x7F, 0x04, 0x08, 0x10, 0x7F};
    case 'O': return {0x3E, 0x41, 0x41, 0x41, 0x3E};
    case 'P': return {0x7F, 0x09, 0x09, 0x09, 0x06};
    case 'K': return {0x7F, 0x08, 0x14, 0x22, 0x41};
    case 'R': return {0x7F, 0x09, 0x19, 0x29, 0x46};
    case 'S': return {0x46, 0x49, 0x49, 0x49, 0x31};
    case 'T': return {0x01, 0x01, 0x7F, 0x01, 0x01};
    case 'U': return {0x3F, 0x40, 0x40, 0x40, 0x3F};
    case 'W': return {0x3F, 0x40, 0x38, 0x40, 0x3F};
    case 'Y': return {0x07, 0x08, 0x70, 0x08, 0x07};
    case '0': return {0x3E, 0x51, 0x49, 0x45, 0x3E};
    case '1': return {0x00, 0x42, 0x7F, 0x40, 0x00};
    case '2': return {0x42, 0x61, 0x51, 0x49, 0x46};
    case '3': return {0x21, 0x41, 0x45, 0x4B, 0x31};
    case '4': return {0x18, 0x14, 0x12, 0x7F, 0x10};
    case '5': return {0x27, 0x45, 0x45, 0x45, 0x39};
    case '6': return {0x3C, 0x4A, 0x49, 0x49, 0x30};
    case '7': return {0x01, 0x71, 0x09, 0x05, 0x03};
    case '8': return {0x36, 0x49, 0x49, 0x49, 0x36};
    case '9': return {0x06, 0x49, 0x49, 0x29, 0x1E};
    case '.': return {0x00, 0x60, 0x60, 0x00, 0x00};
    case '/': return {0x20, 0x10, 0x08, 0x04, 0x02};
    case '-': return {0x08, 0x08, 0x08, 0x08, 0x08};
    case ' ': return {0x00, 0x00, 0x00, 0x00, 0x00};
    default: return {0x02, 0x01, 0x51, 0x09, 0x06};
  }
}

const char* mode_name(DisplayMode mode) {
  switch (mode) {
    case DisplayMode::kBrew: return "BREW";
    case DisplayMode::kSteam: return "STEAM";
    case DisplayMode::kUnknown: return "---";
  }
  return "---";
}

const char* status_name(DisplayStatus status) {
  switch (status) {
    case DisplayStatus::kBoot: return "BOOT";
    case DisplayStatus::kHeating: return "HEATING";
    case DisplayStatus::kCooling: return "COOLING";
    case DisplayStatus::kReady: return "READY";
    case DisplayStatus::kFault: return "FAULT";
  }
  return "FAULT";
}

const char* wifi_status_name(DisplayWifiStatus status) {
  switch (status) {
    case DisplayWifiStatus::kOff: return "OFF";
    case DisplayWifiStatus::kConnecting: return "WAIT";
    case DisplayWifiStatus::kConnected: return "ON";
    case DisplayWifiStatus::kRetrying: return "RETRY";
    case DisplayWifiStatus::kFailed: return "FAIL";
  }
  return "FAIL";
}

bool ascii_alphanumeric(char value) {
  return (value >= 'A' && value <= 'Z') ||
         (value >= 'a' && value <= 'z') ||
         (value >= '0' && value <= '9');
}

ExtractionProfile make_profile(const char* name, std::uint8_t pre_infusion,
                               std::uint8_t soak,
                               std::uint8_t main_extraction) {
  ExtractionProfile profile{};
  profile.configured = true;
  for (std::size_t index = 0;
       name[index] != '\0' && index + 1U < profile.name.size(); ++index) {
    profile.name[index] = name[index];
  }
  profile.pre_infusion_seconds = pre_infusion;
  profile.soak_seconds = soak;
  profile.main_extraction_seconds = main_extraction;
  return profile;
}

}  // namespace

void format_display_temperature_line(char* output, std::size_t length,
                                     const DisplayTemperature& temperature,
                                     std::int32_t target) {
  if (temperature.valid) {
    std::snprintf(output, length, "TEMP %05.1f/%" PRId32,
                  static_cast<double>(temperature.value_c), target);
    return;
  }
  std::snprintf(output, length, "TEMP --.-/%" PRId32, target);
}

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

ExtractionProfiles default_extraction_profiles() {
  return {
      make_profile("Classic30", 0U, 0U, 30U),
      make_profile("Pre5Soak5", 5U, 5U, 25U),
      ExtractionProfile{},
      ExtractionProfile{},
  };
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

bool extraction_profiles_are_valid(const ExtractionProfiles& profiles) {
  return std::all_of(profiles.begin(), profiles.end(),
                     extraction_profile_is_valid);
}

ProfileStorage::ProfileStorage(ProfileBackend& backend) : backend_(backend) {}

ProfileLoadResult ProfileStorage::load(ExtractionProfiles& profiles) {
  const auto result = backend_.load(profiles);
  if (result == BackendLoadResult::kError) {
    return ProfileLoadResult::kError;
  }
  if (result == BackendLoadResult::kNotFound) {
    profiles = default_extraction_profiles();
    return backend_.save(profiles) ? ProfileLoadResult::kInitializedDefaults
                                   : ProfileLoadResult::kError;
  }
  return extraction_profiles_are_valid(profiles) ? ProfileLoadResult::kOk
                                                  : ProfileLoadResult::kCorrupt;
}

bool ProfileStorage::save(const ExtractionProfiles& profiles) {
  return extraction_profiles_are_valid(profiles) && backend_.save(profiles);
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

Ssd1306Display::Ssd1306Display(OledTransport& transport)
    : transport_(transport) {}

bool Ssd1306Display::initialize() {
  constexpr std::array<std::uint8_t, 25> commands{
      0xAE, 0xD5, 0x80, 0xA8, 0x1F, 0xD3, 0x00, 0x40, 0x8D,
      0x14, 0x20, 0x00, 0xA1, 0xC8, 0xDA, 0x02, 0x81, 0x8F,
      0xD9, 0xF1, 0xDB, 0x40, 0xA4, 0xA6, 0xAF};
  initialized_ = transport_.write_command(commands.data(), commands.size());
  return initialized_;
}

void format_display_workflow_line(char* output, std::size_t length,
                                  const DisplaySnapshot& snapshot) {
  if (output == nullptr || length == 0U) {
    return;
  }
  if (snapshot.cooldown_status == DisplayCooldownStatus::kPumping) {
    std::snprintf(output, length, "COOL CMD PUMP RUN");
    return;
  }
  if (snapshot.cooldown_status == DisplayCooldownStatus::kStabilizing) {
    std::snprintf(output, length, "STAB CMD PUMP OFF");
    return;
  }
  if (snapshot.extraction_active) {
    std::snprintf(output, length, "PUMP CMD %s %s%s",
                  snapshot.pump_command == PumpCommand::kRunning ? "RUN"
                                                                  : "OFF",
                  snapshot.extraction_phase,
                  snapshot.compensation_active ? " +2C" : "");
    return;
  }
  if (snapshot.pump_command == PumpCommand::kRunning) {
    std::snprintf(output, length, "PUMP CMD RUN FAULT");
    return;
  }
  std::snprintf(output, length, "HEATER %s WIFI %s",
                snapshot.heater_enabled ? "ON" : "OFF",
                wifi_status_name(snapshot.wifi_status));
}

bool Ssd1306Display::render(const DisplaySnapshot& snapshot) {
  if (!initialized_) {
    return false;
  }

  Framebuffer buffer{};
  std::array<char, 24> line{};
  format_display_temperature_line(
      line.data(), line.size(), snapshot.boiler,
      snapshot.mode == DisplayMode::kSteam ? snapshot.targets.steam_c
                                           : snapshot.targets.brew_c);
  draw_text(buffer, 0, line.data());
  std::snprintf(line.data(), line.size(), "B %" PRId32 " S %" PRId32,
                snapshot.targets.brew_c, snapshot.targets.steam_c);
  draw_text(buffer, 1, line.data());
  std::snprintf(line.data(), line.size(), "MODE %s %s", mode_name(snapshot.mode),
                status_name(snapshot.status));
  draw_text(buffer, 2, line.data());
  format_display_workflow_line(line.data(), line.size(), snapshot);
  draw_text(buffer, 3, line.data());

  constexpr std::array<std::uint8_t, 6> address_window{0x21, 0x00, 0x7F,
                                                       0x22, 0x00, 0x03};
  return transport_.write_command(address_window.data(), address_window.size()) &&
         transport_.write_data(buffer.data(), buffer.size());
}

void Ssd1306Display::draw_text(Framebuffer& buffer, std::size_t page,
                               const char* text) {
  if (page >= kHeight / 8 || text == nullptr) {
    return;
  }
  std::size_t column = 0;
  while (*text != '\0' && column + 5 < kWidth) {
    const auto character = glyph(*text++);
    for (const auto byte : character) {
      buffer[page * kWidth + column++] = byte;
    }
    buffer[page * kWidth + column++] = 0;
  }
}

}  // namespace philcoino::peripherals
