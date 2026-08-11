#include <array>
#include <cassert>
#include <cstdint>
#include <string>
#include <type_traits>

#include "philcoino/config.hpp"

int main() {
  using namespace philcoino::config;

  assert(std::string(kFirmwareVersion) == "0.4.1");
  const std::array<std::uint8_t, 6> mac{0xAA, 0xBB, 0xCC, 0x01, 0x02, 0xAF};
  assert(stable_device_id(mac) == std::string("philcoino-0102AF"));

  static_assert(kBrewTargetMinimumC < kBrewTargetMaximumC);
  static_assert(kSteamTargetMinimumC <= kSteamTargetMaximumC);
  static_assert(kTemperatureCalibrationReferenceC == 100);
  static_assert(kTemperatureCalibrationCandidateMinimumC == 90);
  static_assert(kTemperatureCalibrationCandidateMaximumC == 120);
  static_assert(kTemperatureCalibrationOffsetMinimumC == -20);
  static_assert(kTemperatureCalibrationOffsetMaximumC == 10);
  static_assert(kTemperatureCalibrationSessionLeaseMs == 15000U);
  static_assert(kPreInfusionHeaterDutyOffsetC == 0);
  static_assert(kExtractionHeaterDutyOffsetC == 2);
  static_assert(kBrewOverTemperatureC > kBrewTargetMaximumC);
  static_assert(kSteamTargetMaximumC == 135);
  static_assert(kSteamOverTemperatureC >= kSteamTargetMaximumC);
  static_assert(kSteamOverTemperatureC == 135);
  static_assert(kRawBoilerOverTemperatureC == 135);
  static_assert(kSteamCompensationInitialMinimumC == 0);
  static_assert(kSteamCompensationInitialMaximumC == 20);
  static_assert(kSteamCompensationInitialDefaultC == 12);
  static_assert(kSteamCompensationDecayMinimumMs == 60000U);
  static_assert(kSteamCompensationDecayMaximumMs == 1800000U);
  static_assert(kSteamCompensationDecayDefaultMs == 720000U);
  static_assert(kSteamReadyTimeoutMinimumMs == 60000U);
  static_assert(kSteamReadyTimeoutMaximumMs == 900000U);
  static_assert(kSteamSettingTimeStepMs == 60000U);
  static_assert(kHeatingTimeoutMs == 600000U);
  static_assert(kSteamReadyTimeoutMs == 300000U);
  static_assert(kTemperatureControllerIntervalMs == 500U);
  static_assert(kHeaterControlWindowMs == 10000U);
  static_assert(kMinimumHeaterPulseMs == 500U);
  static_assert(kMinimumHeaterPulseMs < kHeaterControlWindowMs);
  static_assert(kHeaterSafetyLeaseMs == 1500U);
  static_assert(kHeaterSafetyLeaseMs < kHeaterControlWindowMs);
  static_assert(kCooldownPumpLimitMs == 45000U);
  static_assert(kCooldownStabilizationMs == 5000U);
  static_assert(kBrewHeatRampMinimumTargetBandC >
                static_cast<float>(kReadyBandC));
  static_assert(kBrewHeatRampMinimumTargetBandC < kBrewHeatRampBandC);
  static_assert(kBrewHeatRampBandC > static_cast<float>(kReadyBandC));
  static_assert(kSteamHeatRampBandC > kBrewHeatRampBandC);
  static_assert(kBrewRecoveryTriggerDropC >= static_cast<float>(kReadyBandC));
  static_assert(kSteamRecoveryTriggerDropC > kBrewRecoveryTriggerDropC);
  static_assert(kBrewRecoveryHeatRampBandC < kBrewHeatRampBandC);
  static_assert(kSteamRecoveryHeatRampBandC < kSteamHeatRampBandC);
  static_assert(
      std::is_same_v<decltype(kTemperatureReadingLoggingEnabled), const bool>);
  static_assert(!kTemperatureReadingLoggingEnabled);
  static_assert(kBoilerThermocoupleChipSelectGpio == 7);
  static_assert(kBoilerThermocoupleDataGpio == 5);
  static_assert(kBoilerThermocoupleClockGpio == 4);
  static_assert(kSsrActiveHigh);
  static_assert(kPumpGpio == 10);
  static_assert(kPumpActiveHigh);
  static_assert(kPumpGpio != kSsrGpio);
  static_assert(kPumpGpio != kBoilerThermocoupleChipSelectGpio);
  static_assert(kPumpGpio != kBoilerThermocoupleClockGpio);
  static_assert(kPumpGpio != kBoilerThermocoupleDataGpio);

  return 0;
}
