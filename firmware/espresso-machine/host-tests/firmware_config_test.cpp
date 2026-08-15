#include <array>
#include <cassert>
#include <cstdint>
#include <string>

#include "philcoino/config.hpp"

namespace {

template <std::size_t Size>
constexpr bool all_unique(const std::array<std::int32_t, Size>& values) {
  for (std::size_t left = 0; left < Size; ++left) {
    for (std::size_t right = left + 1; right < Size; ++right) {
      if (values[left] == values[right]) return false;
    }
  }
  return true;
}

constexpr bool reserved_s3_gpio(std::int32_t gpio) {
  return gpio == 0 || gpio == 3 || gpio == 19 || gpio == 20 ||
         (gpio >= 26 && gpio <= 48);
}

}  // namespace

int main() {
  using namespace philcoino::config;

  assert(std::string(kFirmwareVersion) == "0.5.0");
  assert(std::string(kDeviceModel) == "ESP32-S3-WROOM-1 N16R8");
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
  static_assert(kRawTemperatureOverTemperatureC == 135);
  static_assert(kSteamReadyTimeoutMinimumMs == 60000U);
  static_assert(kSteamReadyTimeoutMaximumMs == 900000U);
  static_assert(kSteamSettingTimeStepMs == 60000U);
  static_assert(kHeatingTimeoutMs == 600000U);
  static_assert(kSteamReadyTimeoutMs == 300000U);
  static_assert(kTemperatureControllerIntervalMs == 500U);
  static_assert(kMaximumAcceptedTemperatureDropC == 10.0F);
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
  static_assert(kSteamThermocoupleChipSelectGpio == 9);
  static_assert(kSteamThermocoupleDataGpio == 8);
  static_assert(kSteamThermocoupleClockGpio == 4);
  static_assert(kSsrGpio == 21);
  static_assert(kSsrActiveHigh);
  static_assert(kPumpDimmerGpio == 10);
  static_assert(kPumpZeroCrossGpio == 6);
  static_assert(kPumpDimmerPhase == 0U);
  static_assert(kPumpMainsFrequencyHz == 60U);
  static_assert(kPumpMaximumPowerPercent == 90U);
  static_assert(kPumpMaximumPowerPercent < 100U);
  static_assert(kScaleDataGpio == 11);
  static_assert(kScaleClockGpio == 12);
  static_assert(kNativeUsbDmGpio == 19);
  static_assert(kNativeUsbDpGpio == 20);
  constexpr std::array<std::int32_t, 10> assigned_gpios{
      kBoilerThermocoupleClockGpio,
      kBoilerThermocoupleDataGpio,
      kBoilerThermocoupleChipSelectGpio,
      kSteamThermocoupleDataGpio,
      kSteamThermocoupleChipSelectGpio,
      kPumpZeroCrossGpio,
      kPumpDimmerGpio,
      kScaleDataGpio,
      kScaleClockGpio,
      kSsrGpio,
  };
  static_assert(all_unique(assigned_gpios));
  for (const auto gpio : assigned_gpios) {
    assert(!reserved_s3_gpio(gpio));
  }
  static_assert(kScaleTaskMinimumLoopDelayMs == 10U);
  static_assert(kScaleTaskMinimumLoopDelayMs < kScaleUnavailableTimeoutMs);

  return 0;
}
