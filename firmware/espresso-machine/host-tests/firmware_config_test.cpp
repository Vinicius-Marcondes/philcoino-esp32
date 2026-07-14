#include <array>
#include <cassert>
#include <cstdint>
#include <string>
#include <type_traits>

#include "philcoino/config.hpp"

int main() {
  using namespace philcoino::config;

  const std::array<std::uint8_t, 6> mac{0xAA, 0xBB, 0xCC, 0x01, 0x02, 0xAF};
  assert(stable_device_id(mac) == std::string("philcoino-0102AF"));

  static_assert(kBrewTargetMinimumC < kBrewTargetMaximumC);
  static_assert(kSteamTargetMinimumC <= kSteamTargetMaximumC);
  static_assert(kSteamTemperatureOffsetC == 5);
  static_assert(kPreInfusionHeaterDutyOffsetC == 0);
  static_assert(kExtractionHeaterDutyOffsetC == 2);
  static_assert(kBrewOverTemperatureC > kBrewTargetMaximumC);
  static_assert(kSteamOverTemperatureC > kSteamTargetMaximumC);
  static_assert(kHeatingTimeoutMs == 600000U);
  static_assert(kSteamReadyTimeoutMs == 300000U);
  static_assert(kHeaterControlWindowMs == 10000U);
  static_assert(kMinimumHeaterPulseMs == 500U);
  static_assert(kMinimumHeaterPulseMs < kHeaterControlWindowMs);
  static_assert(kHeaterSafetyLeaseMs == 1500U);
  static_assert(kHeaterSafetyLeaseMs < kHeaterControlWindowMs);
  static_assert(kWifiMaximumTxPowerQuarterDbm == 44);
  static_assert(kWifiMaximumTxPowerQuarterDbm >= 8);
  static_assert(kWifiMaximumTxPowerQuarterDbm <= 84);
  static_assert(kBrewHeatRampMinimumTargetBandC >
                static_cast<float>(kReadyBandC));
  static_assert(kBrewHeatRampMinimumTargetBandC < kBrewHeatRampBandC);
  static_assert(kBrewHeatRampBandC > static_cast<float>(kReadyBandC));
  static_assert(kSteamHeatRampBandC > kBrewHeatRampBandC);
  static_assert(kBrewRecoveryTriggerDropC >= static_cast<float>(kReadyBandC));
  static_assert(kSteamRecoveryTriggerDropC > kBrewRecoveryTriggerDropC);
  static_assert(kBrewRecoveryHeatRampBandC < kBrewHeatRampBandC);
  static_assert(kSteamRecoveryHeatRampBandC < kSteamHeatRampBandC);
  static_assert(std::is_same_v<decltype(kOledEnabled), const bool>);
  static_assert(kOledI2cAddress == 0x3C);
  static_assert(kBoilerThermocoupleChipSelectGpio == 7);
  static_assert(kBoilerThermocoupleDataGpio == 6);
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
