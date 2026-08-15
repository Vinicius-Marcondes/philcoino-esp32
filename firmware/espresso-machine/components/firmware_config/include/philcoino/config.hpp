#pragma once

#include <array>
#include <cstdint>
#include <string>

namespace philcoino::config {

inline constexpr char kFirmwareVersion[] = "0.5.0";
inline constexpr char kFriendlyName[] = "PhilcoINO";
inline constexpr char kDeviceModel[] = "ESP32-S3-WROOM-1 N16R8";
inline constexpr char kDeviceIdPrefix[] = "philcoino-";
inline constexpr bool kWifiEnabled = true;

inline constexpr std::int32_t kBrewTargetMinimumC = 85;
inline constexpr std::int32_t kBrewTargetMaximumC = 95;
inline constexpr std::int32_t kSteamTargetMinimumC = 110;
inline constexpr std::int32_t kSteamTargetMaximumC = 135;
inline constexpr std::int32_t kTemperatureCalibrationReferenceC = 100;
inline constexpr std::int32_t kTemperatureCalibrationCandidateMinimumC = 90;
inline constexpr std::int32_t kTemperatureCalibrationCandidateMaximumC = 120;
inline constexpr std::int32_t kTemperatureCalibrationOffsetMinimumC = -20;
inline constexpr std::int32_t kTemperatureCalibrationOffsetMaximumC = 10;
inline constexpr std::uint32_t kTemperatureCalibrationSessionLeaseMs = 15U * 1000U;
inline constexpr std::int32_t kPreInfusionHeaterDutyOffsetC = 0;
inline constexpr std::int32_t kExtractionHeaterDutyOffsetC = 2;
inline constexpr std::int32_t kBrewOverTemperatureC = 98;
inline constexpr std::int32_t kSteamOverTemperatureC = 135;
inline constexpr std::int32_t kRawTemperatureOverTemperatureC = 135;
inline constexpr std::uint32_t kSteamReadyTimeoutMinimumMs =
    1U * 60U * 1000U;
inline constexpr std::uint32_t kSteamReadyTimeoutMaximumMs =
    15U * 60U * 1000U;
inline constexpr std::uint32_t kSteamSettingTimeStepMs = 60U * 1000U;

inline constexpr std::uint32_t kHeatingTimeoutMs = 10U * 60U * 1000U;
inline constexpr std::uint32_t kSteamReadyTimeoutMs = 5U * 60U * 1000U;
inline constexpr std::uint32_t kReadyStabilityMs = 3U * 1000U;
inline constexpr std::int32_t kReadyBandC = 1;
inline constexpr std::uint32_t kTemperatureControllerIntervalMs = 500U;
inline constexpr std::uint32_t kSensorFailureConsecutiveSamples = 3U;
inline constexpr float kMaximumAcceptedTemperatureDropC = 10.0F;
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

inline constexpr std::int32_t kBoilerThermocoupleClockGpio = 4;
inline constexpr std::int32_t kBoilerThermocoupleDataGpio = 5;
inline constexpr std::int32_t kBoilerThermocoupleChipSelectGpio = 7;
inline constexpr std::int32_t kSteamThermocoupleClockGpio =
    kBoilerThermocoupleClockGpio;
inline constexpr std::int32_t kSteamThermocoupleDataGpio = 8;
inline constexpr std::int32_t kSteamThermocoupleChipSelectGpio = 9;

inline constexpr std::int32_t kSsrGpio = 21;
inline constexpr bool kSsrActiveHigh = true;
inline constexpr std::int32_t kPumpDimmerGpio = 10;
inline constexpr std::int32_t kPumpZeroCrossGpio = 6;
inline constexpr std::uint8_t kPumpDimmerPhase = 0;
inline constexpr std::uint16_t kPumpMainsFrequencyHz = 60;
// Temporary hard limit: the pending pressure sensor is rated to approximately
// 13 bar and closed-loop pressure regulation is not implemented yet.
inline constexpr std::uint8_t kPumpMaximumPowerPercent = 90;
inline constexpr std::int32_t kScaleDataGpio = 11;
inline constexpr std::int32_t kScaleClockGpio = 12;
inline constexpr std::int32_t kNativeUsbDmGpio = 19;
inline constexpr std::int32_t kNativeUsbDpGpio = 20;
inline constexpr std::uint32_t kScaleTaskMinimumLoopDelayMs = 10U;
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
