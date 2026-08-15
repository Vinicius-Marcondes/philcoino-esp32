#include <algorithm>
#include <array>
#include <atomic>
#include <cinttypes>
#include <cmath>
#include <cstdio>

#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "sdkconfig.h"
#include "philcoino/api.hpp"
#include "philcoino/config.hpp"
#include "philcoino/control.hpp"
#include "philcoino/esp_networking.hpp"
#include "philcoino/esp_ota_update.hpp"
#include "philcoino/esp_security.hpp"
#include "philcoino/esp_peripherals.hpp"
#include "philcoino/extraction_telemetry.hpp"

namespace {

constexpr char kLogTag[] = "philcoino";

constexpr bool configured_pairing_code_is_valid() {
  constexpr char kPairingCode[] = CONFIG_PHILCOINO_PAIRING_CODE;
  if (sizeof(kPairingCode) != 9U) return false;
  for (std::size_t index = 0; index < 8U; ++index) {
    if (kPairingCode[index] < '0' || kPairingCode[index] > '9') return false;
  }
  return kPairingCode[8] == '\0';
}

static_assert(configured_pairing_code_is_valid(),
              "CONFIG_PHILCOINO_PAIRING_CODE must contain exactly eight digits");

bool secrets_are_configured() {
  return CONFIG_PHILCOINO_WIFI_SSID[0] != '\0' &&
         CONFIG_PHILCOINO_WIFI_PASSWORD[0] != '\0';
}

std::uint32_t uptime_ms() {
  return static_cast<std::uint32_t>(esp_timer_get_time() / 1000);
}

const char* thermocouple_status_name(
    philcoino::peripherals::ThermocoupleStatus status) {
  using philcoino::peripherals::ThermocoupleStatus;
  switch (status) {
    case ThermocoupleStatus::kOk: return "ok";
    case ThermocoupleStatus::kNotReady: return "not_ready";
    case ThermocoupleStatus::kOpenCircuit: return "open_circuit";
    case ThermocoupleStatus::kInvalidFrame: return "invalid_frame";
    case ThermocoupleStatus::kImplausibleDrop: return "implausible_drop";
    case ThermocoupleStatus::kTransportError: return "transport_error";
  }
  return "unknown";
}

void log_thermocouple_failure(
    const char* sensor_name, const char* phase,
    const philcoino::peripherals::ThermocoupleReading& reading,
    std::int32_t chip_select_gpio, std::int32_t data_gpio,
    unsigned attempt = 0U) {
  ESP_LOGE(kLogTag,
           "MAX6675 %s %s failure status=%s raw=0x%04X attempt=%u "
           "CS=GPIO%" PRId32 " SCK=GPIO%" PRId32 " SO=GPIO%" PRId32,
           sensor_name, phase, thermocouple_status_name(reading.status),
           static_cast<unsigned>(reading.raw_frame), attempt,
           chip_select_gpio,
           philcoino::config::kBoilerThermocoupleClockGpio,
           data_gpio);
}

philcoino::peripherals::ThermocoupleReading read_startup_temperature(
    const char* sensor_name, philcoino::peripherals::Max6675& thermocouple,
    std::int32_t chip_select_gpio, std::int32_t data_gpio) {
  constexpr unsigned kMaximumStartupAttempts = 3U;
  philcoino::peripherals::ThermocoupleReading reading{};
  for (unsigned attempt = 1U; attempt <= kMaximumStartupAttempts; ++attempt) {
    vTaskDelay(pdMS_TO_TICKS(
        philcoino::peripherals::kMax6675SampleIntervalMs));
    reading = thermocouple.read(uptime_ms());
    if (reading.status ==
        philcoino::peripherals::ThermocoupleStatus::kOk) {
      ESP_LOGI(kLogTag,
               "MAX6675 %s startup sample ready temperature=%.2fC raw=0x%04X "
               "attempt=%u",
               sensor_name, static_cast<double>(reading.temperature_c),
               static_cast<unsigned>(reading.raw_frame), attempt);
      return reading;
    }
    log_thermocouple_failure(sensor_name, "startup", reading,
                             chip_select_gpio, data_gpio, attempt);
  }
  return reading;
}

class FreeRtosApiSynchronization final
    : public philcoino::networking::ApiSynchronization {
 public:
  // Both API domains intentionally alias this one bounded mutex. Holders may
  // only copy snapshots or execute controller transitions; NVS, HTTP response
  // transmission and sensor I/O stay outside the lock.
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

class FailOffFirmwareUpdateSafety final
    : public philcoino::networking::FirmwareUpdateSafety {
 public:
  FailOffFirmwareUpdateSafety(
      philcoino::control::TemperatureController& temperature,
      philcoino::control::ExtractionController& extraction,
      philcoino::control::CooldownController& cooldown,
      philcoino::control::ScaleController& scale,
      philcoino::peripherals::FailOffPump& pump,
      philcoino::peripherals::FailOffSsr& heater,
      FreeRtosApiSynchronization& synchronization)
      : temperature_(temperature),
        extraction_(extraction),
        cooldown_(cooldown),
        scale_(scale),
        pump_(pump),
        heater_(heater),
        synchronization_(synchronization) {}

  philcoino::networking::FirmwareUpdateSafetyResult prepare(
      std::uint32_t now_ms) override {
    if (!synchronization_.lock(
            philcoino::networking::ApiDomain::kExtraction)) {
      return philcoino::networking::FirmwareUpdateSafetyResult::kOutputFailure;
    }
    const auto scale = scale_.snapshot(now_ms);
    if (extraction_.active() || cooldown_.active() ||
        temperature_.temperature_calibration_active() ||
        scale.calibration_status ==
            philcoino::control::ScaleCalibrationStatus::kCalibrating) {
      synchronization_.unlock(
          philcoino::networking::ApiDomain::kExtraction);
      return philcoino::networking::FirmwareUpdateSafetyResult::kBusy;
    }
    const bool permission_disabled =
        temperature_.set_heater_enabled(false, now_ms);
    const bool heater_off = heater_.force_off();
    const bool pump_off = pump_.force_off();
    synchronization_.unlock(
        philcoino::networking::ApiDomain::kExtraction);
    return permission_disabled && heater_off && pump_off
               ? philcoino::networking::FirmwareUpdateSafetyResult::kReady
               : philcoino::networking::FirmwareUpdateSafetyResult::kOutputFailure;
  }

 private:
  philcoino::control::TemperatureController& temperature_;
  philcoino::control::ExtractionController& extraction_;
  philcoino::control::CooldownController& cooldown_;
  philcoino::control::ScaleController& scale_;
  philcoino::peripherals::FailOffPump& pump_;
  philcoino::peripherals::FailOffSsr& heater_;
  FreeRtosApiSynchronization& synchronization_;
};

struct NetworkStartContext {
  philcoino::networking::EspNetworkServer* server;
  const char* ssid;
  const char* password;
};

void network_start_task(void* argument) {
  const auto* context = static_cast<const NetworkStartContext*>(argument);
  std::uint32_t retry_delay_ms = 1000U;
  while (!context->server->start(context->ssid, context->password)) {
    ESP_LOGE(kLogTag,
             "Secure network API startup failed; retrying while temperature control remains active");
    vTaskDelay(pdMS_TO_TICKS(retry_delay_ms));
    retry_delay_ms = std::min<std::uint32_t>(retry_delay_ms * 2U, 30'000U);
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
  philcoino::control::ScaleController* scale;
  philcoino::networking::ExtractionTelemetryBuffer* extraction_telemetry;
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
      xTaskDelayUntil(&last_wake, pdMS_TO_TICKS(10));
      continue;
    }
    const auto now_ms = uptime_ms();
    philcoino::control::ControlSnapshot trace_machine{};
    philcoino::control::ExtractionSnapshot trace_extraction{};
    philcoino::control::ScaleSnapshot trace_scale{};
    philcoino::control::WeightExtractionSnapshot trace_weight{};
    bool capture_telemetry = false;
    bool trace_scale_copied = false;
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
      trace_scale = context->scale->snapshot(now_ms);
      trace_scale_copied = true;
      extraction_result =
          context->extraction->update(now_ms, &trace_scale);
    }
    trace_extraction = context->extraction->snapshot(now_ms);
    context->temperature->set_extraction_phase(
        context->cooldown->active()
            ? philcoino::control::ExtractionPhase::kIdle
            : trace_extraction.phase,
        now_ms);
    if (extraction_result ==
        philcoino::control::ExtractionUpdateResult::kOutputFailure) {
      context->temperature->latch_fault(
          philcoino::control::FaultCode::kInternalError);
    }
    if (!trace_scale_copied) {
      trace_scale = context->scale->snapshot(now_ms);
    }
    trace_weight = context->extraction->weight_snapshot(trace_scale, now_ms);
    capture_telemetry =
        (!trace_extraction.extraction_id.empty() &&
         (trace_extraction.status ==
              philcoino::control::ExtractionStatus::kRunning ||
          trace_extraction.outcome !=
              philcoino::control::ExtractionOutcome::kNone)) &&
        context->extraction_telemetry->capture_due(
            now_ms, trace_extraction.extraction_id);
    if (capture_telemetry) {
      trace_machine = context->temperature->snapshot(now_ms);
    }
    context->synchronization->unlock(
        philcoino::networking::ApiDomain::kExtraction);
    if (capture_telemetry) {
      context->extraction_telemetry->record(
          now_ms, trace_machine, trace_extraction, trace_scale, trace_weight);
    }
    if (extraction_result ==
        philcoino::control::ExtractionUpdateResult::kOutputFailure) {
      ESP_LOGE(kLogTag,
               "Pump off command is unconfirmed; fault is latched and low is retried");
    }
    if (cooldown_result == philcoino::control::CooldownUpdateResult::kFailed) {
      ESP_LOGE(kLogTag,
               "Cooldown output or input failed; output-off commands issued and fault latched");
    }
    xTaskDelayUntil(&last_wake, pdMS_TO_TICKS(10));
  }
}

struct ScaleTaskContext {
  philcoino::peripherals::Hx711EventDrivenAcquisition* acquisition;
  philcoino::peripherals::EspHx711ReadyWaiter* ready_waiter;
  philcoino::control::ScaleController* scale;
  FreeRtosApiSynchronization* synchronization;
};

void scale_sample_task(void* argument) {
  auto* context = static_cast<ScaleTaskContext*>(argument);
  if (!context->ready_waiter->initialize_for_current_task()) {
    ESP_LOGW(
        kLogTag,
        "HX711 data-ready interrupt unavailable; using 10 ms polling fallback");
  }
  auto last_usable_sample_ms = uptime_ms();
  bool usable_sample_received = false;
  bool unavailable_reported = false;
  while (true) {
    const auto reading = context->acquisition->acquire(
        philcoino::config::kScaleUnavailableTimeoutMs);
    const auto now_ms = uptime_ms();
    if (reading.status == philcoino::peripherals::Hx711Status::kOk) {
      last_usable_sample_ms = now_ms;
      if (!usable_sample_received) {
        ESP_LOGI(kLogTag, "HX711 samples ready: DT=GPIO%" PRId32
                             " SCK=GPIO%" PRId32 " raw=%" PRId32,
                 philcoino::config::kScaleDataGpio,
                 philcoino::config::kScaleClockGpio, reading.raw);
      } else if (unavailable_reported) {
        ESP_LOGI(kLogTag, "HX711 recovered: raw=%" PRId32, reading.raw);
      }
      usable_sample_received = true;
      unavailable_reported = false;
    } else if (!unavailable_reported) {
      if (reading.status ==
          philcoino::peripherals::Hx711Status::kTransportError) {
        ESP_LOGW(kLogTag,
                 "HX711 GPIO transport failure: DT=GPIO%" PRId32
                 " SCK=GPIO%" PRId32,
                 philcoino::config::kScaleDataGpio,
                 philcoino::config::kScaleClockGpio);
        unavailable_reported = true;
      } else if (reading.status ==
                 philcoino::peripherals::Hx711Status::kSaturated) {
        ESP_LOGW(kLogTag,
                 "HX711 ADC saturated; check load-cell A+/A-/E+/E- wiring and load");
        unavailable_reported = true;
      } else if (static_cast<std::uint32_t>(
                     now_ms - last_usable_sample_ms) >=
                 philcoino::config::kScaleUnavailableTimeoutMs) {
        ESP_LOGW(kLogTag,
                 "HX711 unavailable: no data-ready sample for %" PRIu32
                 " ms; DT GPIO%" PRId32 " remains high",
                 philcoino::config::kScaleUnavailableTimeoutMs,
                 philcoino::config::kScaleDataGpio);
        unavailable_reported = true;
      }
    }
    if (reading.status != philcoino::peripherals::Hx711Status::kNotReady) {
      if (context->synchronization->lock(
              philcoino::networking::ApiDomain::kExtraction)) {
        context->scale->update(reading, now_ms);
        context->synchronization->unlock(
            philcoino::networking::ApiDomain::kExtraction);
      }
      // A disconnected or miswired HX711 can hold DT low indefinitely. That
      // makes every acquisition complete immediately, so enforce a bounded
      // blocking point to keep the single-core idle task and watchdog healthy.
      vTaskDelay(pdMS_TO_TICKS(
          philcoino::config::kScaleTaskMinimumLoopDelayMs));
    }
  }
}

}  // namespace

extern "C" void app_main() {
  using namespace philcoino::peripherals;

  philcoino::networking::EspOtaBootValidationGuard ota_boot_validation;

  static EspRbdimmerPumpOutput pump_dimmer;
  static EspOutputCriticalSection pump_critical_section;
  static FailOffPump pump(pump_dimmer, pump_critical_section);
  if (!pump.initialize()) {
    ESP_LOGE(kLogTag,
             "Pump dimmer fail-off initialization failed; startup aborted after OFF retry");
    return;
  }
  ESP_LOGI(kLogTag,
           "Pump dimmer initialized: ZC=GPIO%" PRId32
           " DIM=GPIO%" PRId32 " mains=%uHz curve=LINEAR max=%u%% initial=0%%",
           philcoino::config::kPumpZeroCrossGpio,
           philcoino::config::kPumpDimmerGpio,
           static_cast<unsigned>(philcoino::config::kPumpMainsFrequencyHz),
           static_cast<unsigned>(
               philcoino::config::kPumpMaximumPowerPercent));

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
#ifdef CONFIG_PHILCOINO_RAW_TEMPERATURE_LOGGING
  ESP_LOGW(kLogTag,
           "Raw temperature serial logging enabled; diagnostic output can affect task timing");
#endif

  if (!philcoino::config::kWifiEnabled) {
    ESP_LOGW(kLogTag, "Wi-Fi disabled for low-voltage sensor diagnosis");
  } else if (!secrets_are_configured()) {
    ESP_LOGW(kLogTag,
             "Wi-Fi credentials or the eight-digit pairing code are not configured; values are never logged");
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

  static EspNvsTemperatureCalibrationBackend
      boiler_temperature_calibration_backend(TemperatureSensor::kBoiler);
  static EspNvsTemperatureCalibrationBackend
      steam_temperature_calibration_backend(TemperatureSensor::kSteam);
  if (!boiler_temperature_calibration_backend.initialize() ||
      !steam_temperature_calibration_backend.initialize()) {
    ESP_LOGE(kLogTag,
             "NVS temperature calibration storage initialization failed");
    ssr.force_off();
    return;
  }
  static TemperatureCalibrationStorage boiler_temperature_calibration_storage(
      boiler_temperature_calibration_backend);
  static TemperatureCalibrationStorage steam_temperature_calibration_storage(
      steam_temperature_calibration_backend);
  TemperatureCalibrations temperature_calibrations{};
  const auto boiler_temperature_calibration_result =
      boiler_temperature_calibration_storage.load(
          temperature_calibrations.boiler);
  const auto steam_temperature_calibration_result =
      steam_temperature_calibration_storage.load(
          temperature_calibrations.steam);
  if (boiler_temperature_calibration_result ==
          TemperatureCalibrationLoadResult::kCorrupt ||
      boiler_temperature_calibration_result ==
          TemperatureCalibrationLoadResult::kError ||
      steam_temperature_calibration_result ==
          TemperatureCalibrationLoadResult::kCorrupt ||
      steam_temperature_calibration_result ==
          TemperatureCalibrationLoadResult::kError) {
    ESP_LOGE(kLogTag,
             "Persisted temperature calibration is unavailable or invalid");
    ssr.force_off();
    return;
  }

  static EspNvsSteamControlSettingsBackend steam_control_settings_backend;
  if (!steam_control_settings_backend.initialize()) {
    ESP_LOGE(kLogTag,
             "NVS Steam control settings initialization failed");
    ssr.force_off();
    return;
  }
  static SteamControlSettingsStorage steam_control_settings_storage(
      steam_control_settings_backend);
  SteamControlSettings steam_control_settings{};
  const auto steam_control_settings_result =
      steam_control_settings_storage.load(steam_control_settings);
  if (steam_control_settings_result ==
          SteamControlSettingsLoadResult::kCorrupt ||
      steam_control_settings_result ==
          SteamControlSettingsLoadResult::kError) {
    ESP_LOGE(kLogTag,
             "Persisted Steam control settings are unavailable or invalid");
    ssr.force_off();
    return;
  }

  static EspNvsScaleCalibrationBackend scale_calibration_backend;
  const bool scale_storage_ready = scale_calibration_backend.initialize();
  static ScaleCalibrationStorage scale_calibration_storage(
      scale_calibration_backend);
  ScaleCalibration scale_calibration{};
  const auto scale_calibration_result =
      scale_storage_ready
          ? scale_calibration_storage.load(scale_calibration)
          : ScaleCalibrationLoadResult::kError;
  const bool scale_calibrated =
      scale_calibration_result == ScaleCalibrationLoadResult::kOk;
  if (scale_calibration_result == ScaleCalibrationLoadResult::kCorrupt ||
      scale_calibration_result == ScaleCalibrationLoadResult::kError) {
    ESP_LOGW(kLogTag,
             "Scale calibration storage unavailable; weighted extraction remains blocked");
  }
  static philcoino::control::ScaleController scale_controller(
      scale_calibration, scale_calibrated);
  static EspHx711Transport hx711_transport;
  const bool hx711_initialized = hx711_transport.initialize();
  if (!hx711_initialized) {
    ESP_LOGW(kLogTag,
             "HX711 GPIO initialization failed; weighted extraction remains blocked");
  }
  static Hx711 hx711(hx711_transport);
  static EspHx711ReadyWaiter hx711_ready_waiter;
  static Hx711EventDrivenAcquisition hx711_acquisition(
      hx711, hx711_ready_waiter);

  static EspMax6675Bus max6675_bus;
  if (!max6675_bus.initialize()) {
    ESP_LOGE(kLogTag, "MAX6675 bus initialization failed");
    pump.force_off();
    ssr.force_off();
    return;
  }
  ESP_LOGI(kLogTag,
           "MAX6675 shared bus initialized: SCK=GPIO%" PRId32
           " boiler(CS=GPIO%" PRId32 " SO=GPIO%" PRId32
           ") steam(CS=GPIO%" PRId32 " SO=GPIO%" PRId32 ")",
           philcoino::config::kBoilerThermocoupleClockGpio,
           philcoino::config::kBoilerThermocoupleChipSelectGpio,
           philcoino::config::kBoilerThermocoupleDataGpio,
           philcoino::config::kSteamThermocoupleChipSelectGpio,
           philcoino::config::kSteamThermocoupleDataGpio);
  static EspMax6675Transport boiler_max6675_transport(
      max6675_bus, "boiler",
      philcoino::config::kBoilerThermocoupleChipSelectGpio,
      philcoino::config::kBoilerThermocoupleDataGpio);
  static EspMax6675Transport steam_max6675_transport(
      max6675_bus, "steam",
      philcoino::config::kSteamThermocoupleChipSelectGpio,
      philcoino::config::kSteamThermocoupleDataGpio);
  static Max6675 boiler_thermocouple(boiler_max6675_transport, uptime_ms());
  static Max6675 steam_thermocouple(steam_max6675_transport, uptime_ms());

  const TemperatureReadings startup_temperatures{
      read_startup_temperature(
          "boiler", boiler_thermocouple,
          philcoino::config::kBoilerThermocoupleChipSelectGpio,
          philcoino::config::kBoilerThermocoupleDataGpio),
      read_startup_temperature(
          "steam", steam_thermocouple,
          philcoino::config::kSteamThermocoupleChipSelectGpio,
          philcoino::config::kSteamThermocoupleDataGpio),
  };

  static philcoino::control::TemperatureController controller(
      targets, temperature_calibrations, steam_control_settings, ssr,
      startup_temperatures);
  static philcoino::control::ExtractionController extraction_controller(pump);
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
  auto snapshot = controller.update(startup_temperatures, pump.command(),
                                    uptime_ms());

  std::array<char, 33> boot_id{};
  std::snprintf(boot_id.data(), boot_id.size(),
                "%08lx%08lx%08lx%08lx",
                static_cast<unsigned long>(esp_random()),
                static_cast<unsigned long>(esp_random()),
                static_cast<unsigned long>(esp_random()),
                static_cast<unsigned long>(esp_random()));
  static philcoino::networking::ExtractionTelemetryBuffer extraction_telemetry(
      boot_id.data());

  static WorkflowTaskContext workflow_context{
      &controller, &extraction_controller, &cooldown_controller,
      &pump, &ssr, &fail_safe_requested, &synchronization, &scale_controller,
      &extraction_telemetry};
  if (xTaskCreatePinnedToCore(workflow_control_task, "philcoino-workflow", 4096,
                              &workflow_context, configMAX_PRIORITIES - 2,
                              nullptr, 1) != pdPASS) {
    ESP_LOGE(kLogTag, "Workflow controller task creation failed");
    pump.force_off();
    ssr.force_off();
    return;
  }

  static ScaleTaskContext scale_context{
      &hx711_acquisition, &hx711_ready_waiter, &scale_controller,
      &synchronization};
  if (hx711_initialized &&
      xTaskCreatePinnedToCore(scale_sample_task, "philcoino-scale", 3072,
                              &scale_context, configMAX_PRIORITIES - 3,
                              nullptr, 1) != pdPASS) {
    ESP_LOGW(kLogTag,
             "Scale sampling task creation failed; weighted extraction remains blocked");
  }

  const philcoino::networking::DeviceIdentity identity{
      device_id,
      philcoino::config::kFriendlyName,
      philcoino::config::kDeviceModel,
      philcoino::config::kFirmwareVersion,
  };
  static philcoino::networking::EspTlsIdentity tls_identity;
  static philcoino::networking::EspPairingCrypto pairing_crypto;
  static philcoino::networking::NvsPairingStorage pairing_storage;
  static philcoino::networking::EspPairingSrpFactory pairing_srp_factory(
      CONFIG_PHILCOINO_PAIRING_CODE);
  const bool network_requested =
      philcoino::config::kWifiEnabled && secrets_are_configured();
  const bool identity_ready =
      network_requested && tls_identity.initialize(device_id.c_str());
  if (network_requested && !identity_ready) {
    ESP_LOGE(kLogTag,
             "Secure network identity initialization failed; API remains offline");
  }
  static philcoino::networking::PairingService pairing(
      identity, CONFIG_PHILCOINO_PAIRING_CODE, tls_identity.spki_sha256(),
      pairing_crypto, pairing_storage, pairing_srp_factory);
  const bool pairing_ready = identity_ready && pairing.initialize();
  if (identity_ready && !pairing_ready) {
    ESP_LOGE(kLogTag,
             "Pairing credential storage initialization failed; API remains offline");
  }
  const bool secure_network_ready = network_requested && pairing_ready;
  static philcoino::networking::FirmwareApi api(
      identity, pairing, controller, target_storage,
      boiler_temperature_calibration_storage,
      steam_temperature_calibration_storage, extraction_controller,
      cooldown_controller, scale_calibration_storage,
      synchronization, &scale_controller,
      &steam_control_settings_storage, boot_id.data());
  static FailOffFirmwareUpdateSafety firmware_update_safety(
      controller, extraction_controller, cooldown_controller,
      scale_controller, pump, ssr, synchronization);
  static philcoino::networking::EspOtaUpdateBackend firmware_update_backend;
  static philcoino::networking::FirmwareUpdateCoordinator firmware_update(
      firmware_update_safety, firmware_update_backend);
  static philcoino::networking::EspNetworkServer network(
      api, identity, tls_identity, &extraction_telemetry, &firmware_update);
  static const NetworkStartContext network_context{
      &network,
      CONFIG_PHILCOINO_WIFI_SSID,
      CONFIG_PHILCOINO_WIFI_PASSWORD,
  };
  bool network_task_started = false;
  if (secure_network_ready) {
    network_task_started =
        xTaskCreatePinnedToCore(
            network_start_task, "philcoino-network", 6144,
            const_cast<NetworkStartContext*>(&network_context), 5,
            nullptr, 0) == pdPASS;
    if (!network_task_started) {
      ESP_LOGE(kLogTag,
               "Network startup task creation failed; temperature control remains active");
    }
  }
  if (ota_boot_validation.pending() &&
      (!secure_network_ready || !network_task_started)) {
    ESP_LOGE(kLogTag,
             "OTA image cannot restore the secure update service; rollback requested");
    pump.force_off();
    ssr.force_off();
    return;
  }
  if (!ota_boot_validation.confirm()) {
    ESP_LOGE(kLogTag, "OTA image validation state could not be confirmed");
    pump.force_off();
    ssr.force_off();
    return;
  }

  // app_main otherwise keeps ESP-IDF's low main-task priority. Temperature
  // acquisition and heater-lease refresh must preempt TLS/Wi-Fi work when the
  // 500 ms control period becomes runnable.
  vTaskPrioritySet(nullptr, configMAX_PRIORITIES - 1);
  const TickType_t temperature_period_ticks =
      pdMS_TO_TICKS(kMax6675SampleIntervalMs);
  TickType_t temperature_last_wake = xTaskGetTickCount();
  while (true) {
    xTaskDelayUntil(&temperature_last_wake, temperature_period_ticks);
    const auto temperature_woke_at = xTaskGetTickCount();
    const auto lateness_ticks = static_cast<std::int32_t>(
        temperature_woke_at - temperature_last_wake);
    if (lateness_ticks > 0 && temperature_period_ticks > 0) {
      temperature_last_wake += static_cast<TickType_t>(
          lateness_ticks / temperature_period_ticks) * temperature_period_ticks;
    }
    const TemperatureReadings readings{
        boiler_thermocouple.read(uptime_ms()),
        steam_thermocouple.read(uptime_ms()),
    };
    if (readings.boiler.status != ThermocoupleStatus::kOk) {
      log_thermocouple_failure(
          "boiler", "runtime", readings.boiler,
          philcoino::config::kBoilerThermocoupleChipSelectGpio,
          philcoino::config::kBoilerThermocoupleDataGpio);
    }
    if (readings.steam.status != ThermocoupleStatus::kOk) {
      log_thermocouple_failure(
          "steam", "runtime", readings.steam,
          philcoino::config::kSteamThermocoupleChipSelectGpio,
          philcoino::config::kSteamThermocoupleDataGpio);
    }
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
    snapshot = controller.update(readings, pump.command(), uptime_ms());
    synchronization.unlock(philcoino::networking::ApiDomain::kTemperature);
#ifdef CONFIG_PHILCOINO_RAW_TEMPERATURE_LOGGING
    if (readings.boiler.status == ThermocoupleStatus::kOk &&
        std::isfinite(readings.boiler.temperature_c)) {
      ESP_LOGI(kLogTag,
               "MAX6675 boiler runtime sample raw_temperature_c=%.2f raw_frame=0x%04X",
               static_cast<double>(readings.boiler.temperature_c),
               static_cast<unsigned>(readings.boiler.raw_frame));
    }
    if (readings.steam.status == ThermocoupleStatus::kOk &&
        std::isfinite(readings.steam.temperature_c)) {
      ESP_LOGI(kLogTag,
               "MAX6675 steam runtime sample raw_temperature_c=%.2f raw_frame=0x%04X",
               static_cast<double>(readings.steam.temperature_c),
               static_cast<unsigned>(readings.steam.raw_frame));
    }
#endif
  }
}
