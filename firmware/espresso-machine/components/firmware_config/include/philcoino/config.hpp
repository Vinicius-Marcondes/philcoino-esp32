#pragma once

#include <array>
#include <cstdint>
#include <string>

namespace philcoino::config {

inline constexpr char kFirmwareVersion[] = "0.1.0";
inline constexpr char kFriendlyName[] = "PhilcoINO";
inline constexpr char kDeviceModel[] = "ESP32-C3 Super Mini";
inline constexpr char kDeviceIdPrefix[] = "philcoino-";

inline constexpr std::int32_t kBrewTargetMinimumC = 85;
inline constexpr std::int32_t kBrewTargetMaximumC = 95;
inline constexpr std::int32_t kSteamTargetMinimumC = 110;
inline constexpr std::int32_t kSteamTargetMaximumC = 120;
inline constexpr std::int32_t kBrewOverTemperatureC = 98;
inline constexpr std::int32_t kSteamOverTemperatureC = 130;
inline constexpr std::int32_t kSensorDisagreementC = 10;

inline constexpr std::uint32_t kHeatingTimeoutMs = 10U * 60U * 1000U;
inline constexpr std::uint32_t kSensorDisagreementDurationMs =
    5U * 60U * 1000U;
inline constexpr std::uint32_t kSteamReadyTimeoutMs = 5U * 60U * 1000U;
inline constexpr std::uint32_t kReadyStabilityMs = 3U * 1000U;
inline constexpr std::int32_t kReadyBandC = 1;

inline constexpr std::uint8_t kOledI2cAddress = 0x3C;
inline constexpr std::int32_t kOledSdaGpio = 8;
inline constexpr std::int32_t kOledSclGpio = 9;
inline constexpr std::int32_t kOledWidth = 128;
inline constexpr std::int32_t kOledHeight = 32;

inline constexpr std::int32_t kThermocoupleClockGpio = 4;
inline constexpr std::int32_t kThermocoupleDataGpio = 6;
inline constexpr std::int32_t kBrewThermocoupleChipSelectGpio = 5;
inline constexpr std::int32_t kSteamThermocoupleChipSelectGpio = 10;

inline constexpr std::int32_t kSsrGpio = 20;
inline constexpr bool kSsrActiveHigh = true;

std::string stable_device_id(const std::array<std::uint8_t, 6>& station_mac);

}  // namespace philcoino::config
