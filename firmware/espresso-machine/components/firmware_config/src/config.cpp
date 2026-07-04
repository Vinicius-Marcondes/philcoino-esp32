#include "philcoino/config.hpp"

#include <cstdio>

namespace philcoino::config {

std::string stable_device_id(const std::array<std::uint8_t, 6>& station_mac) {
  std::array<char, 17> value{};
  std::snprintf(value.data(), value.size(), "%s%02X%02X%02X", kDeviceIdPrefix,
                station_mac[3], station_mac[4], station_mac[5]);
  return value.data();
}

}  // namespace philcoino::config
