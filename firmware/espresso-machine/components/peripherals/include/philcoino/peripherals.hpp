#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace philcoino::peripherals {

inline constexpr std::uint32_t kMax6675ConversionMs = 220;
inline constexpr std::uint32_t kMax6675SampleIntervalMs = 500;
inline constexpr std::int32_t kDefaultBrewTargetC = 93;
inline constexpr std::int32_t kDefaultSteamTargetC = 115;
inline constexpr std::size_t kProfileSlotCount = 4;
inline constexpr std::size_t kProfileNameCapacity = 13;
inline constexpr std::uint8_t kMaximumExtractionDurationSeconds = 60;

enum class ThermocoupleStatus {
  kOk,
  kNotReady,
  kOpenCircuit,
  kInvalidFrame,
  kTransportError,
};

struct ThermocoupleReading {
  ThermocoupleStatus status{ThermocoupleStatus::kNotReady};
  float temperature_c{0.0F};
  std::uint16_t raw_frame{0};
};

class Max6675Transport {
 public:
  virtual ~Max6675Transport() = default;
  virtual bool read_frame(std::uint16_t& frame) = 0;
};

class Max6675 {
 public:
  explicit Max6675(Max6675Transport& transport,
                   std::uint32_t started_at_ms = 0);

  ThermocoupleReading read(std::uint32_t now_ms);

 private:
  static ThermocoupleReading decode(std::uint16_t frame);

  Max6675Transport& transport_;
  std::uint32_t ready_at_ms_;
};

struct TemperatureTargets {
  std::int32_t brew_c{kDefaultBrewTargetC};
  std::int32_t steam_c{kDefaultSteamTargetC};
};

bool targets_are_valid(const TemperatureTargets& targets);

enum class BackendLoadResult { kOk, kNotFound, kError };

class TargetBackend {
 public:
  virtual ~TargetBackend() = default;
  virtual BackendLoadResult load(TemperatureTargets& targets) = 0;
  virtual bool save(const TemperatureTargets& targets) = 0;
};

enum class TargetLoadResult { kOk, kInitializedDefaults, kCorrupt, kError };

class TargetStorage {
 public:
  explicit TargetStorage(TargetBackend& backend);

  TargetLoadResult load(TemperatureTargets& targets);
  bool save(const TemperatureTargets& targets);

 private:
  TargetBackend& backend_;
};

struct ExtractionProfile {
  bool configured{false};
  std::array<char, kProfileNameCapacity> name{};
  std::uint8_t pre_infusion_seconds{0};
  std::uint8_t soak_seconds{0};
  std::uint8_t main_extraction_seconds{0};
};

using ExtractionProfiles = std::array<ExtractionProfile, kProfileSlotCount>;

ExtractionProfiles default_extraction_profiles();
bool extraction_profile_is_valid(const ExtractionProfile& profile);
bool extraction_profiles_are_valid(const ExtractionProfiles& profiles);

class ProfileBackend {
 public:
  virtual ~ProfileBackend() = default;
  virtual BackendLoadResult load(ExtractionProfiles& profiles) = 0;
  virtual bool save(const ExtractionProfiles& profiles) = 0;
};

enum class ProfileLoadResult { kOk, kInitializedDefaults, kCorrupt, kError };

class ProfileStorage {
 public:
  explicit ProfileStorage(ProfileBackend& backend);

  ProfileLoadResult load(ExtractionProfiles& profiles);
  bool save(const ExtractionProfiles& profiles);

 private:
  ProfileBackend& backend_;
};

class DigitalOutput {
 public:
  virtual ~DigitalOutput() = default;
  virtual bool set_level(bool high) = 0;
  virtual bool configure_output() = 0;
};

class SsrSafetyLease {
 public:
  virtual ~SsrSafetyLease() = default;
  virtual bool initialize() = 0;
  virtual bool arm(std::uint32_t duration_ms) = 0;
  virtual bool disarm() = 0;
  virtual bool tripped() const = 0;
};

class FailOffSsr {
 public:
  FailOffSsr(DigitalOutput& output, SsrSafetyLease& safety_lease,
             bool active_high = true);

  bool initialize();
  bool set_enabled(bool enabled);
  bool force_off();
  bool is_enabled() const;
  bool safety_cutoff_tripped() const;

 private:
  bool write_enabled_level(bool enabled);

  DigitalOutput& output_;
  SsrSafetyLease& safety_lease_;
  bool active_high_{true};
  bool initialized_{false};
  bool enabled_{false};
};

enum class PumpCommand { kOff, kRunning };

class FailOffPump {
 public:
  explicit FailOffPump(DigitalOutput& output, bool active_high = true);

  bool initialize();
  bool set_running(bool running);
  bool force_off();
  PumpCommand command() const;

 private:
  bool write_command(PumpCommand command);

  DigitalOutput& output_;
  bool active_high_{true};
  bool initialized_{false};
  PumpCommand command_{PumpCommand::kOff};
};

enum class DisplayMode { kUnknown, kBrew, kSteam };
enum class DisplayStatus { kBoot, kHeating, kCooling, kReady, kFault };
enum class DisplayWifiStatus { kOff, kConnecting, kConnected, kRetrying, kFailed };

struct DisplayTemperature {
  bool valid{false};
  float value_c{0.0F};
};

struct DisplaySnapshot {
  DisplayTemperature boiler{};
  TemperatureTargets targets{};
  DisplayMode mode{DisplayMode::kUnknown};
  DisplayStatus status{DisplayStatus::kBoot};
  bool heater_enabled{false};
  DisplayWifiStatus wifi_status{DisplayWifiStatus::kOff};
  bool extraction_active{false};
  PumpCommand pump_command{PumpCommand::kOff};
  const char* extraction_phase{"IDLE"};
};

void format_display_temperature_line(char* output, std::size_t length,
                                     const DisplayTemperature& temperature,
                                     std::int32_t target);

class OledTransport {
 public:
  virtual ~OledTransport() = default;
  virtual bool write_command(const std::uint8_t* bytes,
                             std::size_t length) = 0;
  virtual bool write_data(const std::uint8_t* bytes,
                          std::size_t length) = 0;
};

class Ssd1306Display {
 public:
  static constexpr std::size_t kWidth = 128;
  static constexpr std::size_t kHeight = 32;
  static constexpr std::size_t kBufferSize = kWidth * kHeight / 8;

  explicit Ssd1306Display(OledTransport& transport);

  bool initialize();
  bool render(const DisplaySnapshot& snapshot);

 private:
  using Framebuffer = std::array<std::uint8_t, kBufferSize>;

  static void draw_text(Framebuffer& buffer, std::size_t page,
                        const char* text);

  OledTransport& transport_;
  bool initialized_{false};
};

}  // namespace philcoino::peripherals
