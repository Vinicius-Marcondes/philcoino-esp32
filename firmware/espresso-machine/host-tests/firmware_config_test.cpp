#include <array>
#include <cassert>
#include <cstdint>
#include <string>

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
  static_assert(kBoilerThermocoupleChipSelectGpio == 7);
  static_assert(kBoilerThermocoupleDataGpio == 5);
  static_assert(kBoilerThermocoupleClockGpio == 4);
  static_assert(kSsrActiveHigh);
  static_assert(kPumpDimmerGpio == 10);
  static_assert(kPumpZeroCrossGpio == 6);
  static_assert(kPumpDimmerPhase == 0U);
  static_assert(kPumpMainsFrequencyHz == 60U);
  static_assert(kPumpMaximumPowerPercent == 90U);
  static_assert(kPumpMaximumPowerPercent < 100U);
  static_assert(kPumpDimmerGpio != kPumpZeroCrossGpio);
  static_assert(kPumpDimmerGpio != kSsrGpio);
  static_assert(kPumpZeroCrossGpio != kSsrGpio);
  static_assert(kPumpDimmerGpio != kBoilerThermocoupleChipSelectGpio);
  static_assert(kPumpDimmerGpio != kBoilerThermocoupleClockGpio);
  static_assert(kPumpDimmerGpio != kBoilerThermocoupleDataGpio);
  static_assert(kPumpZeroCrossGpio != kBoilerThermocoupleChipSelectGpio);
  static_assert(kPumpZeroCrossGpio != kBoilerThermocoupleClockGpio);
  static_assert(kPumpZeroCrossGpio != kBoilerThermocoupleDataGpio);
  static_assert(kPumpDimmerGpio != kScaleDataGpio);
  static_assert(kPumpDimmerGpio != kScaleClockGpio);
  static_assert(kPumpZeroCrossGpio != kScaleDataGpio);
  static_assert(kPumpZeroCrossGpio != kScaleClockGpio);
  static_assert(kScaleTaskMinimumLoopDelayMs == 10U);
  static_assert(kScaleTaskMinimumLoopDelayMs < kScaleUnavailableTimeoutMs);

  return 0;
}
