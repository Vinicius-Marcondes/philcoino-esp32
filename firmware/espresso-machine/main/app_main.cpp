#include <array>

#include "esp_log.h"
#include "esp_mac.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "philcoino/config.hpp"
#include "philcoino/esp_peripherals.hpp"
#include "sdkconfig.h"

namespace {

constexpr char kLogTag[] = "philcoino";

bool secrets_are_configured() {
  return CONFIG_PHILCOINO_WIFI_SSID[0] != '\0' &&
         CONFIG_PHILCOINO_WIFI_PASSWORD[0] != '\0' &&
         CONFIG_PHILCOINO_BEARER_TOKEN[0] != '\0';
}

std::uint32_t uptime_ms() {
  return static_cast<std::uint32_t>(esp_timer_get_time() / 1000);
}

}  // namespace

extern "C" void app_main() {
  using namespace philcoino::peripherals;

  static EspGpioOutput ssr_gpio(philcoino::config::kSsrGpio);
  static FailOffSsr ssr(ssr_gpio);
  if (!ssr.initialize()) {
    ESP_LOGE(kLogTag, "SSR fail-off initialization failed");
    return;
  }

  std::array<std::uint8_t, 6> station_mac{};
  if (esp_read_mac(station_mac.data(), ESP_MAC_WIFI_STA) != ESP_OK) {
    ESP_LOGE(kLogTag, "Failed to read station MAC");
    ssr.force_off();
    return;
  }

  const auto device_id = philcoino::config::stable_device_id(station_mac);

  ESP_LOGI(kLogTag, "%s firmware %s booted as %s",
           philcoino::config::kFriendlyName,
           philcoino::config::kFirmwareVersion, device_id.c_str());

  if (!secrets_are_configured()) {
    ESP_LOGW(kLogTag,
             "Wi-Fi and bearer-token secrets are not configured; values are never logged");
  }

  static EspNvsTargetBackend nvs_backend;
  if (!nvs_backend.initialize()) {
    ESP_LOGE(kLogTag, "NVS target storage initialization failed");
    ssr.force_off();
    return;
  }
  static TargetStorage target_storage(nvs_backend);
  TemperatureTargets targets{};
  const auto target_result = target_storage.load(targets);
  if (target_result == TargetLoadResult::kCorrupt ||
      target_result == TargetLoadResult::kError) {
    ESP_LOGE(kLogTag, "Persisted temperature targets are unavailable or invalid");
    ssr.force_off();
    return;
  }

  static EspMax6675Transport max6675_transport;
  if (!max6675_transport.initialize()) {
    ESP_LOGE(kLogTag, "MAX6675 bus initialization failed");
    ssr.force_off();
    return;
  }
  static DualMax6675 thermocouples(max6675_transport, uptime_ms());

  static EspOledTransport oled_transport;
  static Ssd1306Display display(oled_transport);
  if (!oled_transport.initialize() || !display.initialize()) {
    ESP_LOGE(kLogTag, "SSD1306 initialization failed");
    ssr.force_off();
    return;
  }

  DisplaySnapshot snapshot{};
  snapshot.targets = targets;
  if (!display.render(snapshot)) {
    ESP_LOGE(kLogTag, "SSD1306 boot-state render failed");
    ssr.force_off();
    return;
  }

  vTaskDelay(pdMS_TO_TICKS(kMax6675ConversionMs + 10U));
  const auto readings = thermocouples.read(uptime_ms());
  snapshot.brew = {readings.brew.status == ThermocoupleStatus::kOk,
                   readings.brew.temperature_c};
  snapshot.steam = {readings.steam.status == ThermocoupleStatus::kOk,
                    readings.steam.temperature_c};
  if (!snapshot.brew.valid || !snapshot.steam.valid) {
    ESP_LOGE(kLogTag,
             "Thermocouple startup reading is open, invalid, or unavailable");
    snapshot.status = DisplayStatus::kFault;
    ssr.force_off();
  }
  if (!display.render(snapshot)) {
    ESP_LOGE(kLogTag, "SSD1306 sensor-state render failed");
    ssr.force_off();
  }
}
