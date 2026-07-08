#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

namespace philcoino::peripherals {

inline constexpr std::uint32_t kMax6675ConversionMs = 220;
inline constexpr std::uint32_t kMax6675SampleIntervalMs = 500;
inline constexpr std::int32_t kDefaultBrewTargetC = 93;
inline constexpr std::int32_t kDefaultSteamTargetC = 115;

enum class ThermocoupleChannel { kBrew, kSteam };

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

struct ThermocoupleReadings {
  ThermocoupleReading brew{};
  ThermocoupleReading steam{};
};

class Max6675Transport {
 public:
  virtual ~Max6675Transport() = default;
  virtual bool read_frame(ThermocoupleChannel channel,
                          std::uint16_t& frame) = 0;
};

class DualMax6675 {
 public:
  explicit DualMax6675(Max6675Transport& transport,
                       std::uint32_t started_at_ms = 0,
                       bool dual_thermocouples_enabled = true);

  ThermocoupleReadings read(std::uint32_t now_ms);

 private:
  static ThermocoupleReading decode(std::uint16_t frame);

  Max6675Transport& transport_;
  std::uint32_t ready_at_ms_;
  bool dual_thermocouples_enabled_;
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

class DigitalOutput {
 public:
  virtual ~DigitalOutput() = default;
  virtual bool set_level(bool high) = 0;
  virtual bool configure_output() = 0;
};

class FailOffSsr {
 public:
  explicit FailOffSsr(DigitalOutput& output, bool active_high = true);

  bool initialize();
  bool set_enabled(bool enabled);
  bool force_off();
  bool is_enabled() const;

 private:
  bool write_enabled_level(bool enabled);

  DigitalOutput& output_;
  bool active_high_{true};
  bool initialized_{false};
  bool enabled_{false};
};

enum class DisplayMode { kUnknown, kBrew, kSteam };
enum class DisplayStatus { kBoot, kHeating, kCooling, kReady, kFault };
enum class DisplayWifiStatus { kOff, kConnecting, kConnected, kRetrying, kFailed };

struct DisplayTemperature {
  bool valid{false};
  float value_c{0.0F};
};

struct DisplaySnapshot {
  DisplayTemperature brew{};
  DisplayTemperature steam{};
  TemperatureTargets targets{};
  DisplayMode mode{DisplayMode::kUnknown};
  DisplayStatus status{DisplayStatus::kBoot};
  bool heater_enabled{false};
  DisplayWifiStatus wifi_status{DisplayWifiStatus::kOff};
};

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
