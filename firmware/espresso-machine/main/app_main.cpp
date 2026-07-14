#include <array>

#include "esp_log.h"
#include "esp_mac.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "philcoino/api.hpp"
#include "philcoino/config.hpp"
#include "philcoino/control.hpp"
#include "philcoino/esp_networking.hpp"
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

philcoino::peripherals::DisplayWifiStatus display_wifi_status(
    philcoino::networking::WifiStatus status) {
  using philcoino::networking::WifiStatus;
  using philcoino::peripherals::DisplayWifiStatus;

  switch (status) {
    case WifiStatus::kOff: return DisplayWifiStatus::kOff;
    case WifiStatus::kConnecting: return DisplayWifiStatus::kConnecting;
    case WifiStatus::kConnected: return DisplayWifiStatus::kConnected;
    case WifiStatus::kRetrying: return DisplayWifiStatus::kRetrying;
    case WifiStatus::kFailed: return DisplayWifiStatus::kFailed;
  }
  return DisplayWifiStatus::kFailed;
}

bool active_temperature_above_target(
    const philcoino::control::ControlSnapshot& control) {
  using philcoino::control::ControlMode;

  const auto target = control.mode == ControlMode::kBrew
                          ? control.targets.brew_c
                          : control.targets.steam_c;
  return control.boiler_temperature.temperature_c >
         static_cast<float>(target + philcoino::config::kReadyBandC);
}

philcoino::peripherals::DisplaySnapshot display_snapshot(
    const philcoino::control::ControlSnapshot& control,
    const philcoino::control::ExtractionSnapshot& extraction = {},
    philcoino::peripherals::DisplayWifiStatus wifi_status =
        philcoino::peripherals::DisplayWifiStatus::kOff) {
  using philcoino::control::ControlMode;
  using philcoino::control::ControlStatus;
  using philcoino::peripherals::DisplayMode;
  using philcoino::peripherals::DisplayStatus;

  philcoino::peripherals::DisplaySnapshot display{};
  display.boiler = philcoino::control::display_temperature(control);
  display.targets = control.targets;
  display.mode = control.mode == ControlMode::kBrew ? DisplayMode::kBrew
                                                     : DisplayMode::kSteam;
  switch (control.status) {
    case ControlStatus::kHeating:
      display.status = !control.heater_enabled &&
                               active_temperature_above_target(control)
                           ? DisplayStatus::kCooling
                           : DisplayStatus::kHeating;
      break;
    case ControlStatus::kReady: display.status = DisplayStatus::kReady; break;
    case ControlStatus::kFault: display.status = DisplayStatus::kFault; break;
  }
  display.heater_enabled = control.heater_enabled;
  display.wifi_status = wifi_status;
  display.extraction_active =
      extraction.status == philcoino::control::ExtractionStatus::kRunning;
  display.pump_command = extraction.pump_command;
  switch (extraction.phase) {
    case philcoino::control::ExtractionPhase::kManual:
      display.extraction_phase = "MANUAL";
      break;
    case philcoino::control::ExtractionPhase::kPreInfusion:
      display.extraction_phase = "PRE";
      break;
    case philcoino::control::ExtractionPhase::kSoak:
      display.extraction_phase = "SOAK";
      break;
    case philcoino::control::ExtractionPhase::kMainExtraction:
      display.extraction_phase = "MAIN";
      break;
    case philcoino::control::ExtractionPhase::kIdle:
      display.extraction_phase = "IDLE";
      break;
  }
  return display;
}

class FreeRtosApiSynchronization final
    : public philcoino::networking::ApiSynchronization {
 public:
  FreeRtosApiSynchronization(SemaphoreHandle_t temperature_mutex,
                             SemaphoreHandle_t extraction_mutex)
      : temperature_mutex_(temperature_mutex),
        extraction_mutex_(extraction_mutex) {}

  bool lock(philcoino::networking::ApiDomain domain) override {
    const auto mutex = domain == philcoino::networking::ApiDomain::kTemperature
                           ? temperature_mutex_
                           : extraction_mutex_;
    return mutex != nullptr &&
           xSemaphoreTake(mutex, pdMS_TO_TICKS(50)) == pdTRUE;
  }

  void unlock(philcoino::networking::ApiDomain domain) override {
    const auto mutex = domain == philcoino::networking::ApiDomain::kTemperature
                           ? temperature_mutex_
                           : extraction_mutex_;
    if (mutex != nullptr) {
      xSemaphoreGive(mutex);
    }
  }

 private:
  SemaphoreHandle_t temperature_mutex_;
  SemaphoreHandle_t extraction_mutex_;
};

struct NetworkStartContext {
  philcoino::networking::EspNetworkServer* server;
  const char* ssid;
  const char* password;
};

void network_start_task(void* argument) {
  const auto* context = static_cast<const NetworkStartContext*>(argument);
  if (!context->server->start(context->ssid, context->password)) {
    ESP_LOGE(kLogTag,
             "Network API startup failed; temperature control remains active");
  }
  vTaskDelete(nullptr);
}

struct ExtractionTaskContext {
  philcoino::control::ExtractionController* controller;
  philcoino::peripherals::FailOffPump* pump;
  FreeRtosApiSynchronization* synchronization;
};

void extraction_control_task(void* argument) {
  auto* context = static_cast<ExtractionTaskContext*>(argument);
  TickType_t last_wake = xTaskGetTickCount();
  bool synchronization_failed = false;
  while (true) {
    if (!context->synchronization->lock(
            philcoino::networking::ApiDomain::kExtraction)) {
      context->pump->force_off();
      synchronization_failed = true;
      ESP_LOGE(kLogTag,
               "Extraction synchronization deadline missed; pump commanded off");
      vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(10));
      continue;
    }
    const auto result = synchronization_failed
                            ? (context->controller->stop()
                                   ? philcoino::control::ExtractionUpdateResult::kCompleted
                                   : philcoino::control::ExtractionUpdateResult::kOutputFailure)
                            : context->controller->update(uptime_ms());
    synchronization_failed = false;
    context->synchronization->unlock(
        philcoino::networking::ApiDomain::kExtraction);
    if (result == philcoino::control::ExtractionUpdateResult::kOutputFailure) {
      ESP_LOGE(kLogTag,
               "Pump command failed; extraction ended with an off command");
    }
    vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(10));
  }
}

}  // namespace

extern "C" void app_main() {
  using namespace philcoino::peripherals;

  static EspGpioOutput pump_gpio(philcoino::config::kPumpGpio);
  static FailOffPump pump(pump_gpio, philcoino::config::kPumpActiveHigh);
  if (!pump.initialize()) {
    ESP_LOGE(kLogTag, "Pump fail-off initialization failed");
    return;
  }

  static EspGpioOutput ssr_gpio(philcoino::config::kSsrGpio);
  static EspGptimerSafetyLease ssr_safety_lease(
      philcoino::config::kSsrGpio, philcoino::config::kSsrActiveHigh);
  static FailOffSsr ssr(ssr_gpio, ssr_safety_lease,
                        philcoino::config::kSsrActiveHigh);
  if (!ssr.initialize()) {
    ESP_LOGE(kLogTag, "SSR fail-off initialization failed");
    pump.force_off();
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

  if (!philcoino::config::kWifiEnabled) {
    ESP_LOGW(kLogTag, "Wi-Fi disabled for low-voltage sensor diagnosis");
  } else if (!secrets_are_configured()) {
    ESP_LOGW(kLogTag,
             "Wi-Fi and bearer-token secrets are not configured; values are never logged");
  }
  if (!philcoino::config::kOledEnabled) {
    ESP_LOGW(kLogTag, "OLED display disabled; boot continues without SSD1306");
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

  static EspNvsProfileBackend profile_backend;
  if (!profile_backend.initialize()) {
    ESP_LOGE(kLogTag, "NVS profile storage initialization failed");
    pump.force_off();
    ssr.force_off();
    return;
  }
  static ProfileStorage profile_storage(profile_backend);
  ExtractionProfiles profiles{};
  const auto profile_result = profile_storage.load(profiles);
  if (profile_result == ProfileLoadResult::kCorrupt ||
      profile_result == ProfileLoadResult::kError) {
    ESP_LOGE(kLogTag, "Persisted extraction profiles are unavailable or invalid");
    pump.force_off();
    ssr.force_off();
    return;
  }
  static philcoino::control::ExtractionController extraction_controller(
      profiles, pump);
  const auto temperature_mutex = xSemaphoreCreateMutex();
  const auto extraction_mutex = xSemaphoreCreateMutex();
  if (temperature_mutex == nullptr || extraction_mutex == nullptr) {
    ESP_LOGE(kLogTag, "Controller synchronization initialization failed");
    pump.force_off();
    ssr.force_off();
    return;
  }
  static FreeRtosApiSynchronization synchronization(temperature_mutex,
                                                    extraction_mutex);
  static ExtractionTaskContext extraction_context{
      &extraction_controller, &pump, &synchronization};
  TaskHandle_t extraction_task = nullptr;
  if (xTaskCreate(extraction_control_task, "philcoino-extraction", 3072,
                  &extraction_context, configMAX_PRIORITIES - 2,
                  &extraction_task) != pdPASS) {
    ESP_LOGE(kLogTag, "Extraction controller task creation failed");
    pump.force_off();
    ssr.force_off();
    return;
  }

  static EspMax6675Transport max6675_transport;
  if (!max6675_transport.initialize()) {
    ESP_LOGE(kLogTag, "MAX6675 bus initialization failed");
    ssr.force_off();
    return;
  }
  static Max6675 thermocouple(max6675_transport, uptime_ms());

  static EspOledTransport oled_transport;
  static Ssd1306Display display(oled_transport);
  if (philcoino::config::kOledEnabled) {
    if (!oled_transport.initialize() || !display.initialize()) {
      ESP_LOGE(kLogTag, "SSD1306 initialization failed");
      ssr.force_off();
      return;
    }

    DisplaySnapshot boot_display{};
    boot_display.targets = targets;
    if (!display.render(boot_display)) {
      ESP_LOGE(kLogTag, "SSD1306 boot-state render failed");
      ssr.force_off();
      return;
    }
  }

  static philcoino::control::TemperatureController controller(targets, ssr);
  vTaskDelay(pdMS_TO_TICKS(kMax6675SampleIntervalMs));
  auto snapshot = controller.update(thermocouple.read(uptime_ms()), uptime_ms());
  if (philcoino::config::kOledEnabled) {
    if (!display.render(display_snapshot(snapshot))) {
      ESP_LOGE(kLogTag, "SSD1306 sensor-state render failed");
      ssr.force_off();
      return;
    }
  }

  const philcoino::networking::DeviceIdentity identity{
      device_id,
      philcoino::config::kFriendlyName,
      philcoino::config::kDeviceModel,
      philcoino::config::kFirmwareVersion,
  };
  static philcoino::networking::FirmwareApi api(
      identity, CONFIG_PHILCOINO_BEARER_TOKEN, controller, target_storage,
      extraction_controller, profile_storage, synchronization);
  static philcoino::networking::EspNetworkServer network(api, identity);
  static const NetworkStartContext network_context{
      &network,
      CONFIG_PHILCOINO_WIFI_SSID,
      CONFIG_PHILCOINO_WIFI_PASSWORD,
  };
  if (philcoino::config::kWifiEnabled && secrets_are_configured() &&
      xTaskCreate(network_start_task, "philcoino-network", 6144,
                  const_cast<NetworkStartContext*>(&network_context), 5,
                  nullptr) != pdPASS) {
    ESP_LOGE(kLogTag,
             "Network startup task creation failed; temperature control remains active");
  }

  while (true) {
    vTaskDelay(pdMS_TO_TICKS(kMax6675SampleIntervalMs));
    const auto reading = thermocouple.read(uptime_ms());
    if (!synchronization.lock(
            philcoino::networking::ApiDomain::kTemperature)) {
      ssr.force_off();
      ESP_LOGE(kLogTag, "Temperature controller synchronization failed");
      return;
    }
    snapshot = controller.update(reading, uptime_ms());
    synchronization.unlock(philcoino::networking::ApiDomain::kTemperature);
    if (philcoino::config::kOledEnabled) {
      philcoino::control::ExtractionSnapshot extraction_snapshot{};
      if (synchronization.lock(
              philcoino::networking::ApiDomain::kExtraction)) {
        extraction_snapshot = extraction_controller.snapshot(uptime_ms());
        synchronization.unlock(
            philcoino::networking::ApiDomain::kExtraction);
      }
      if (!display.render(display_snapshot(
              snapshot, extraction_snapshot,
              display_wifi_status(network.wifi_status())))) {
        ESP_LOGE(kLogTag, "SSD1306 state render failed");
        if (synchronization.lock(
                philcoino::networking::ApiDomain::kTemperature)) {
          controller.latch_fault(
              philcoino::control::FaultCode::kInternalError);
          synchronization.unlock(
              philcoino::networking::ApiDomain::kTemperature);
        } else {
          ssr.force_off();
        }
        return;
      }
    }
  }
}
