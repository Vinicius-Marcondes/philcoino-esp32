#pragma once

#include <array>
#include <cstdint>
#include <string>

namespace philcoino::config {

inline constexpr char kFirmwareVersion[] = "0.2.0";
inline constexpr char kFriendlyName[] = "PhilcoINO";
inline constexpr char kDeviceModel[] = "ESP32-C3 Super Mini";
inline constexpr char kDeviceIdPrefix[] = "philcoino-";
inline constexpr bool kWifiEnabled = true;
// ESP-IDF uses quarter-dBm units; 44 limits station TX power to 11 dBm.
inline constexpr std::int8_t kWifiMaximumTxPowerQuarterDbm = 44;
inline constexpr bool kOledEnabled = false;

inline constexpr std::int32_t kBrewTargetMinimumC = 85;
inline constexpr std::int32_t kBrewTargetMaximumC = 95;
inline constexpr std::int32_t kSteamTargetMinimumC = 110;
inline constexpr std::int32_t kSteamTargetMaximumC = 120;
inline constexpr std::int32_t kSteamTemperatureOffsetC = 5;
inline constexpr std::int32_t kPreInfusionHeaterDutyOffsetC = 0;
inline constexpr std::int32_t kExtractionHeaterDutyOffsetC = 2;
inline constexpr std::int32_t kBrewOverTemperatureC = 98;
inline constexpr std::int32_t kSteamOverTemperatureC = 130;

inline constexpr std::uint32_t kHeatingTimeoutMs = 10U * 60U * 1000U;
inline constexpr std::uint32_t kSteamReadyTimeoutMs = 5U * 60U * 1000U;
inline constexpr std::uint32_t kReadyStabilityMs = 3U * 1000U;
inline constexpr std::int32_t kReadyBandC = 1;
inline constexpr std::uint32_t kHeaterControlWindowMs = 10U * 1000U;
inline constexpr std::uint32_t kMinimumHeaterPulseMs = 500U;
inline constexpr std::uint32_t kHeaterSafetyLeaseMs = 1500U;
inline constexpr std::uint32_t kCooldownPumpLimitMs = 45U * 1000U;
inline constexpr std::uint32_t kCooldownStabilizationMs = 5U * 1000U;
inline constexpr float kBrewHeatRampMinimumTargetBandC = 4.0F;
inline constexpr float kBrewHeatRampBandC = 8.0F;
inline constexpr float kSteamHeatRampBandC = 12.0F;
inline constexpr float kBrewRecoveryTriggerDropC = 1.0F;
inline constexpr float kSteamRecoveryTriggerDropC = 3.0F;
inline constexpr float kBrewRecoveryHeatRampBandC = 4.0F;
inline constexpr float kSteamRecoveryHeatRampBandC = 6.0F;

inline constexpr std::uint8_t kOledI2cAddress = 0x3C;
inline constexpr std::int32_t kOledSdaGpio = 8;
inline constexpr std::int32_t kOledSclGpio = 9;
inline constexpr std::int32_t kOledWidth = 128;
inline constexpr std::int32_t kOledHeight = 32;

inline constexpr std::int32_t kBoilerThermocoupleClockGpio = 4;
inline constexpr std::int32_t kBoilerThermocoupleDataGpio = 5;
inline constexpr std::int32_t kBoilerThermocoupleChipSelectGpio = 7;

inline constexpr std::int32_t kSsrGpio = 20;
inline constexpr bool kSsrActiveHigh = true;
inline constexpr std::int32_t kPumpGpio = 10;
inline constexpr bool kPumpActiveHigh = true;
inline constexpr std::int32_t kScaleDataGpio = 0;
inline constexpr std::int32_t kScaleClockGpio = 1;
inline constexpr std::uint32_t kScaleUnavailableTimeoutMs = 750U;
inline constexpr std::uint32_t kScaleAutomaticTareTimeoutMs = 3U * 1000U;
inline constexpr std::uint32_t kScaleSettlingTimeoutMs = 10U * 1000U;
inline constexpr std::int32_t kScaleStableSpreadDecigrams = 5;
inline constexpr std::int32_t kScaleTargetMinimumDecigrams = 50;
inline constexpr std::int32_t kScaleTargetMaximumDecigrams = 1000;
inline constexpr std::int32_t kScaleCompensationMaximumDecigrams = 100;
inline constexpr std::int32_t kScaleCalibrationReferenceMinimumDecigrams = 500;
inline constexpr std::int32_t kScaleCalibrationReferenceMaximumDecigrams = 5000;

std::string stable_device_id(const std::array<std::uint8_t, 6>& station_mac);

}  // namespace philcoino::config
