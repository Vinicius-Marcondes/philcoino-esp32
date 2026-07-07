#include <array>
#include <cassert>
#include <cstdint>
#include <string>

#include "philcoino/config.hpp"

int main() {
  using namespace philcoino::config;

  const std::array<std::uint8_t, 6> mac{0xAA, 0xBB, 0xCC, 0x01, 0x02, 0xAF};
  assert(stable_device_id(mac) == std::string("philcoino-0102AF"));

  static_assert(kBrewTargetMinimumC <= kBrewTargetMaximumC);
  static_assert(kSteamTargetMinimumC <= kSteamTargetMaximumC);
  static_assert(kBrewOverTemperatureC > kBrewTargetMaximumC);
  static_assert(kSteamOverTemperatureC > kSteamTargetMaximumC);
  static_assert(kHeatingTimeoutMs == 600000U);
  static_assert(kSensorDisagreementDurationMs == 300000U);
  static_assert(kSteamReadyTimeoutMs == 300000U);
  static_assert(kHeaterControlWindowMs == 10000U);
  static_assert(kMinimumHeaterPulseMs == 500U);
  static_assert(kMinimumHeaterPulseMs < kHeaterControlWindowMs);
  static_assert(kBrewHeatRampBandC > static_cast<float>(kReadyBandC));
  static_assert(kSteamHeatRampBandC > kBrewHeatRampBandC);
  static_assert(kBrewRecoveryTriggerDropC > static_cast<float>(kReadyBandC));
  static_assert(kSteamRecoveryTriggerDropC > kBrewRecoveryTriggerDropC);
  static_assert(kBrewRecoveryHeatRampBandC < kBrewHeatRampBandC);
  static_assert(kSteamRecoveryHeatRampBandC < kSteamHeatRampBandC);
  static_assert(kOledI2cAddress == 0x3C);
  static_assert(kBrewThermocoupleChipSelectGpio !=
                kSteamThermocoupleChipSelectGpio);
  static_assert(kBrewThermocoupleDataGpio == 6);
  static_assert(kSteamThermocoupleDataGpio == 1);
  static_assert(kBrewThermocoupleDataGpio != kSteamThermocoupleDataGpio);
  static_assert(kBrewThermocoupleClockGpio == 4);
  static_assert(kSteamThermocoupleClockGpio == 0);
  static_assert(kBrewThermocoupleClockGpio != kSteamThermocoupleClockGpio);
  static_assert(kSsrActiveHigh);

  return 0;
}
