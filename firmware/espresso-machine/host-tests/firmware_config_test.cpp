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
  static_assert(kOledI2cAddress == 0x3C);
  static_assert(kBrewThermocoupleChipSelectGpio !=
                kSteamThermocoupleChipSelectGpio);
  static_assert(kSsrActiveHigh);

  return 0;
}
