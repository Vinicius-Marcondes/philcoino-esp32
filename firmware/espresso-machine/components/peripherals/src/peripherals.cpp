#include "philcoino/peripherals.hpp"

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

void format_temperature_line(char* output, std::size_t length,
                             const char* label,
                             const DisplayTemperature& temperature,
                             std::int32_t target) {
  if (temperature.valid) {
    std::snprintf(output, length, "%s %05.1f/%" PRId32, label,
                  static_cast<double>(temperature.value_c), target);
    return;
  }
  std::snprintf(output, length, "%s --.-/%" PRId32, label, target);
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

FailOffSsr::FailOffSsr(DigitalOutput& output, SsrSafetyLease& safety_lease,
                       bool active_high)
    : output_(output), safety_lease_(safety_lease), active_high_(active_high) {}

bool FailOffSsr::initialize() {
  initialized_ = false;
  enabled_ = false;
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
    enabled_ = false;
    return false;
  }

  if (safety_lease_.tripped()) {
    write_enabled_level(false);
    enabled_ = false;
    return false;
  }

  if (enabled) {
    if (!safety_lease_.arm(config::kHeaterSafetyLeaseMs) ||
        safety_lease_.tripped()) {
      write_enabled_level(false);
      enabled_ = false;
      return false;
    }
    if (!write_enabled_level(true)) {
      const bool forced_off = write_enabled_level(false);
      if (forced_off) {
        safety_lease_.disarm();
      }
      enabled_ = false;
      return false;
    }
    enabled_ = true;
    return true;
  }

  const bool forced_off = write_enabled_level(false);
  enabled_ = enabled;
  if (!forced_off) {
    return false;
  }
  return safety_lease_.disarm();
}

bool FailOffSsr::force_off() {
  enabled_ = false;
  if (!write_enabled_level(false)) {
    return false;
  }
  return safety_lease_.disarm();
}

bool FailOffSsr::is_enabled() const {
  return enabled_ && !safety_lease_.tripped();
}

bool FailOffSsr::safety_cutoff_tripped() const {
  return safety_lease_.tripped();
}

bool FailOffSsr::write_enabled_level(bool enabled) {
  const bool output_high = enabled ? active_high_ : !active_high_;
  return output_.set_level(output_high);
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

bool Ssd1306Display::render(const DisplaySnapshot& snapshot) {
  if (!initialized_) {
    return false;
  }

  Framebuffer buffer{};
  std::array<char, 24> line{};
  format_temperature_line(line.data(), line.size(), "TEMP", snapshot.boiler,
                          snapshot.mode == DisplayMode::kSteam
                              ? snapshot.targets.steam_c
                              : snapshot.targets.brew_c);
  draw_text(buffer, 0, line.data());
  std::snprintf(line.data(), line.size(), "B %" PRId32 " S %" PRId32,
                snapshot.targets.brew_c, snapshot.targets.steam_c);
  draw_text(buffer, 1, line.data());
  std::snprintf(line.data(), line.size(), "MODE %s %s", mode_name(snapshot.mode),
                status_name(snapshot.status));
  draw_text(buffer, 2, line.data());
  std::snprintf(line.data(), line.size(), "HEATER %s WIFI %s",
                snapshot.heater_enabled ? "ON" : "OFF",
                wifi_status_name(snapshot.wifi_status));
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
