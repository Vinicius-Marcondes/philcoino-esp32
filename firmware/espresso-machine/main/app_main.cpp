#include <array>
#include <atomic>
#include <cmath>
#include <cstdio>

#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "philcoino/api.hpp"
#include "philcoino/config.hpp"
#include "philcoino/control.hpp"
#include "philcoino/esp_networking.hpp"
#include "philcoino/esp_peripherals.hpp"
#include "philcoino/history.hpp"
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
    const philcoino::control::CooldownSnapshot& cooldown = {},
    bool compensation_active = false,
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
  display.compensation_active = compensation_active;
  display.pump_command = cooldown.status ==
                                 philcoino::control::CooldownStatus::kIdle
                             ? extraction.pump_command
                             : cooldown.pump_command;
  switch (cooldown.status) {
    case philcoino::control::CooldownStatus::kIdle:
      display.cooldown_status =
          philcoino::peripherals::DisplayCooldownStatus::kIdle;
      break;
    case philcoino::control::CooldownStatus::kPumping:
      display.cooldown_status =
          philcoino::peripherals::DisplayCooldownStatus::kPumping;
      break;
    case philcoino::control::CooldownStatus::kStabilizing:
      display.cooldown_status =
          philcoino::peripherals::DisplayCooldownStatus::kStabilizing;
      break;
  }
  switch (extraction.phase) {
    case philcoino::control::ExtractionPhase::kManual:
      display.extraction_phase = "MAN";
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
  // Both API domains intentionally alias this one bounded mutex. Holders may
  // only copy snapshots or execute controller transitions; NVS, HTTP response
  // transmission, sensor I/O, and display rendering stay outside the lock.
  FreeRtosApiSynchronization(
      SemaphoreHandle_t workflow_mutex,
      philcoino::peripherals::FailOffPump& pump,
      philcoino::peripherals::FailOffSsr& heater,
      std::atomic<bool>& fail_safe_requested)
      : workflow_mutex_(workflow_mutex),
        pump_(pump),
        heater_(heater),
        fail_safe_requested_(fail_safe_requested) {}

  bool lock(philcoino::networking::ApiDomain) override {
    if (workflow_mutex_ != nullptr &&
        xSemaphoreTake(workflow_mutex_, pdMS_TO_TICKS(50)) == pdTRUE) {
      return true;
    }
    pump_.emergency_off();
    heater_.emergency_off();
    fail_safe_requested_.store(true, std::memory_order_release);
    return false;
  }

  void unlock(philcoino::networking::ApiDomain) override {
    if (workflow_mutex_ != nullptr) {
      xSemaphoreGive(workflow_mutex_);
    }
  }

 private:
  SemaphoreHandle_t workflow_mutex_;
  philcoino::peripherals::FailOffPump& pump_;
  philcoino::peripherals::FailOffSsr& heater_;
  std::atomic<bool>& fail_safe_requested_;
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

struct WorkflowTaskContext {
  philcoino::control::TemperatureController* temperature;
  philcoino::control::ExtractionController* extraction;
  philcoino::control::CooldownController* cooldown;
  philcoino::peripherals::FailOffPump* pump;
  philcoino::peripherals::FailOffSsr* heater;
  std::atomic<bool>* fail_safe_requested;
  FreeRtosApiSynchronization* synchronization;
};

philcoino::control::CooldownInput cooldown_input(
    const philcoino::control::ControlSnapshot& temperature,
    bool extraction_active) {
  return {
      temperature.boiler_temperature.status ==
              philcoino::peripherals::ThermocoupleStatus::kOk &&
          std::isfinite(temperature.boiler_temperature.temperature_c),
      temperature.fault_active,
      extraction_active,
      temperature.boiler_temperature.temperature_c,
  };
}

void workflow_control_task(void* argument) {
  auto* context = static_cast<WorkflowTaskContext*>(argument);
  TickType_t last_wake = xTaskGetTickCount();
  while (true) {
    if (!context->synchronization->lock(
            philcoino::networking::ApiDomain::kExtraction)) {
      context->pump->force_off();
      context->heater->force_off();
      ESP_LOGE(kLogTag,
               "Workflow synchronization deadline missed; output-off commands issued");
      vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(10));
      continue;
    }
    const auto now_ms = uptime_ms();
    auto extraction_result =
        philcoino::control::ExtractionUpdateResult::kOk;
    auto cooldown_result = philcoino::control::CooldownUpdateResult::kOk;
    if (context->fail_safe_requested->exchange(
            false, std::memory_order_acq_rel)) {
      context->temperature->latch_fault(
          philcoino::control::FaultCode::kInternalError);
      extraction_result = context->extraction->stop(now_ms)
                              ? philcoino::control::ExtractionUpdateResult::kCompleted
                              : philcoino::control::ExtractionUpdateResult::kOutputFailure;
      if (context->cooldown->active()) {
        const auto temperature = context->temperature->snapshot(now_ms);
        cooldown_result = context->cooldown->update(
            cooldown_input(temperature, context->extraction->active()),
            now_ms);
      }
    } else if (context->cooldown->active()) {
      const auto temperature = context->temperature->snapshot(now_ms);
      cooldown_result = context->cooldown->update(
          cooldown_input(temperature, context->extraction->active()), now_ms);
    } else {
      extraction_result = context->extraction->update(now_ms);
      context->temperature->set_extraction_phase(
          context->extraction->snapshot(now_ms).phase, now_ms);
    }
    if (extraction_result ==
        philcoino::control::ExtractionUpdateResult::kOutputFailure) {
      context->temperature->latch_fault(
          philcoino::control::FaultCode::kInternalError);
    }
    context->synchronization->unlock(
        philcoino::networking::ApiDomain::kExtraction);
    if (extraction_result ==
        philcoino::control::ExtractionUpdateResult::kOutputFailure) {
      ESP_LOGE(kLogTag,
               "Pump off command is unconfirmed; fault is latched and low is retried");
    }
    if (cooldown_result == philcoino::control::CooldownUpdateResult::kFailed) {
      ESP_LOGE(kLogTag,
               "Cooldown output or input failed; output-off commands issued and fault latched");
    }
    vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(10));
  }
}

}  // namespace

extern "C" void app_main() {
  using namespace philcoino::peripherals;

  static EspGpioOutput pump_gpio(philcoino::config::kPumpGpio);
  static EspOutputCriticalSection pump_critical_section;
  static FailOffPump pump(pump_gpio, pump_critical_section,
                          philcoino::config::kPumpActiveHigh);
  if (!pump.initialize()) {
    ESP_LOGE(kLogTag, "Pump fail-off initialization failed");
    return;
  }

  static EspGpioOutput ssr_gpio(philcoino::config::kSsrGpio);
  static EspGptimerSafetyLease ssr_safety_lease(
      philcoino::config::kSsrGpio, philcoino::config::kSsrActiveHigh);
  static EspOutputCriticalSection ssr_critical_section;
  static FailOffSsr ssr(ssr_gpio, ssr_safety_lease, ssr_critical_section,
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
  static philcoino::control::TemperatureController controller(targets, ssr);
  static philcoino::control::ExtractionController extraction_controller(
      profiles, pump);
  static philcoino::control::CooldownController cooldown_controller(controller,
                                                                    pump);
  if (!cooldown_controller.reset(uptime_ms())) {
    ESP_LOGE(kLogTag, "Cooldown reset fail-off initialization failed");
    pump.force_off();
    ssr.force_off();
    return;
  }
  const auto workflow_mutex = xSemaphoreCreateMutex();
  if (workflow_mutex == nullptr) {
    ESP_LOGE(kLogTag, "Controller synchronization initialization failed");
    pump.force_off();
    ssr.force_off();
    return;
  }
  static std::atomic<bool> fail_safe_requested{false};
  static FreeRtosApiSynchronization synchronization(
      workflow_mutex, pump, ssr, fail_safe_requested);

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

  vTaskDelay(pdMS_TO_TICKS(kMax6675SampleIntervalMs));
  auto snapshot = controller.update(thermocouple.read(uptime_ms()), uptime_ms());
  if (philcoino::config::kOledEnabled) {
    if (!display.render(display_snapshot(snapshot))) {
      ESP_LOGE(kLogTag, "SSD1306 sensor-state render failed");
      ssr.force_off();
      return;
    }
  }

  static WorkflowTaskContext workflow_context{
      &controller, &extraction_controller, &cooldown_controller,
      &pump, &ssr, &fail_safe_requested, &synchronization};
  TaskHandle_t workflow_task = nullptr;
  if (xTaskCreate(workflow_control_task, "philcoino-workflow", 4096,
                  &workflow_context, configMAX_PRIORITIES - 2,
                  &workflow_task) != pdPASS) {
    ESP_LOGE(kLogTag, "Workflow controller task creation failed");
    pump.force_off();
    ssr.force_off();
    return;
  }

  const philcoino::networking::DeviceIdentity identity{
      device_id,
      philcoino::config::kFriendlyName,
      philcoino::config::kDeviceModel,
      philcoino::config::kFirmwareVersion,
  };
  std::array<char, 33> history_boot_id{};
  std::snprintf(history_boot_id.data(), history_boot_id.size(),
                "%08lx%08lx%08lx%08lx",
                static_cast<unsigned long>(esp_random()),
                static_cast<unsigned long>(esp_random()),
                static_cast<unsigned long>(esp_random()),
                static_cast<unsigned long>(esp_random()));
  static philcoino::networking::HistoryBuffer history(history_boot_id.data());
  static philcoino::networking::FirmwareApi api(
      identity, CONFIG_PHILCOINO_BEARER_TOKEN, controller, target_storage,
      extraction_controller, cooldown_controller, profile_storage,
      synchronization, &history);
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
    if (!synchronization.lock(philcoino::networking::ApiDomain::kTemperature)) {
      pump.force_off();
      ssr.force_off();
      ESP_LOGE(kLogTag,
               "Temperature synchronization deadline missed; output-off commands issued");
      continue;
    }
    if (fail_safe_requested.exchange(false, std::memory_order_acq_rel)) {
      controller.latch_fault(
          philcoino::control::FaultCode::kInternalError);
      extraction_controller.stop(uptime_ms());
      if (cooldown_controller.active()) {
        const auto failed_snapshot = controller.snapshot(uptime_ms());
        cooldown_controller.update(
            cooldown_input(failed_snapshot,
                           extraction_controller.active()),
            uptime_ms());
      }
    }
    snapshot = controller.update(reading, pump.command(), uptime_ms());
    const auto extraction_snapshot = extraction_controller.snapshot(uptime_ms());
    const auto cooldown_snapshot = cooldown_controller.snapshot(uptime_ms());
    const bool compensation_active =
        controller.extraction_compensation_active();
    synchronization.unlock(philcoino::networking::ApiDomain::kTemperature);
    history.record(static_cast<std::uint64_t>(esp_timer_get_time() / 1000),
                   snapshot, pump.command());
    if (philcoino::config::kOledEnabled) {
      if (!display.render(display_snapshot(
              snapshot, extraction_snapshot, cooldown_snapshot,
              compensation_active,
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
