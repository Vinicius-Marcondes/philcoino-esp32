#include <array>

#include "esp_log.h"
#include "esp_mac.h"
#include "philcoino/config.hpp"
#include "sdkconfig.h"

namespace {

constexpr char kLogTag[] = "philcoino";

bool secrets_are_configured() {
  return CONFIG_PHILCOINO_WIFI_SSID[0] != '\0' &&
         CONFIG_PHILCOINO_WIFI_PASSWORD[0] != '\0' &&
         CONFIG_PHILCOINO_BEARER_TOKEN[0] != '\0';
}

}  // namespace

extern "C" void app_main() {
  std::array<std::uint8_t, 6> station_mac{};
  ESP_ERROR_CHECK(esp_read_mac(station_mac.data(), ESP_MAC_WIFI_STA));

  const auto device_id = philcoino::config::stable_device_id(station_mac);

  ESP_LOGI(kLogTag, "%s firmware %s booted as %s",
           philcoino::config::kFriendlyName,
           philcoino::config::kFirmwareVersion, device_id.c_str());

  if (!secrets_are_configured()) {
    ESP_LOGW(kLogTag,
             "Wi-Fi and bearer-token secrets are not configured; values are never logged");
  }
}
