#include <array>
#include <atomic>
#include <cinttypes>
#include <cmath>
#include <cstdio>
#include <limits>

#include "esp_log.h"
#include "esp_heap_caps.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "sdkconfig.h"
#include "philcoino/api.hpp"
#include "philcoino/config.hpp"
#include "philcoino/control.hpp"
#include "philcoino/esp_networking.hpp"
#include "philcoino/esp_peripherals.hpp"
#include "philcoino/history.hpp"
#include "philcoino/performance_diagnostics.hpp"

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

std::uint64_t monotonic_us() {
  return static_cast<std::uint64_t>(esp_timer_get_time());
}

std::uint32_t bounded_u32(std::uint64_t value) {
  return value > std::numeric_limits<std::uint32_t>::max()
             ? std::numeric_limits<std::uint32_t>::max()
             : static_cast<std::uint32_t>(value);
}

std::uint32_t period_deviation_us(std::uint64_t current,
                                  std::uint64_t previous,
                                  std::uint64_t expected) {
  const auto actual = current - previous;
  return bounded_u32(actual > expected ? actual - expected : expected - actual);
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
      std::atomic<bool>& fail_safe_requested,
      philcoino::diagnostics::PerformanceDiagnostics* performance_diagnostics)
      : workflow_mutex_(workflow_mutex),
        pump_(pump),
        heater_(heater),
        fail_safe_requested_(fail_safe_requested),
        performance_diagnostics_(performance_diagnostics) {}

  bool lock(philcoino::networking::ApiDomain) override {
    std::uint64_t started_us = 0;
    if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
      started_us = monotonic_us();
    }
    if (workflow_mutex_ != nullptr &&
        xSemaphoreTake(workflow_mutex_, pdMS_TO_TICKS(50)) == pdTRUE) {
      if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
        performance_diagnostics_->record(
            philcoino::diagnostics::DurationMetric::kWorkflowMutexWaitUs,
            bounded_u32(monotonic_us() - started_us));
        performance_diagnostics_->increment(
            philcoino::diagnostics::EventCounter::kWorkflowMutexAcquired);
        lock_acquired_us_ = monotonic_us();
      }
      return true;
    }
    if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
      performance_diagnostics_->record(
          philcoino::diagnostics::DurationMetric::kWorkflowMutexWaitUs,
          bounded_u32(monotonic_us() - started_us));
      performance_diagnostics_->increment(
          philcoino::diagnostics::EventCounter::kWorkflowMutexTimeout);
    }
    pump_.emergency_off();
    heater_.emergency_off();
    fail_safe_requested_.store(true, std::memory_order_release);
    return false;
  }

  void unlock(philcoino::networking::ApiDomain) override {
    if (workflow_mutex_ != nullptr) {
      if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
        performance_diagnostics_->record(
            philcoino::diagnostics::DurationMetric::kWorkflowMutexHoldUs,
            bounded_u32(monotonic_us() - lock_acquired_us_));
      }
      xSemaphoreGive(workflow_mutex_);
    }
  }

 private:
  SemaphoreHandle_t workflow_mutex_;
  philcoino::peripherals::FailOffPump& pump_;
  philcoino::peripherals::FailOffSsr& heater_;
  std::atomic<bool>& fail_safe_requested_;
  philcoino::diagnostics::PerformanceDiagnostics* performance_diagnostics_;
  std::uint64_t lock_acquired_us_{0};
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
  philcoino::control::ScaleController* scale;
  philcoino::diagnostics::PerformanceDiagnostics* performance_diagnostics;
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
  std::uint64_t previous_started_us = 0;
  while (true) {
    std::uint64_t started_us = 0;
    if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
      started_us = monotonic_us();
      if (previous_started_us != 0U) {
        context->performance_diagnostics->record(
            philcoino::diagnostics::DurationMetric::kWorkflowPeriodDeviationUs,
            period_deviation_us(started_us, previous_started_us, 10'000U));
      }
      previous_started_us = started_us;
    }
    if (!context->synchronization->lock(
            philcoino::networking::ApiDomain::kExtraction)) {
      context->pump->force_off();
      context->heater->force_off();
      ESP_LOGE(kLogTag,
               "Workflow synchronization deadline missed; output-off commands issued");
      if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
        context->performance_diagnostics->increment(
            philcoino::diagnostics::EventCounter::kWorkflowDeadlineMiss);
        context->performance_diagnostics->record(
            philcoino::diagnostics::DurationMetric::kWorkflowWorkUs,
            bounded_u32(monotonic_us() - started_us));
      }
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
      const auto scale = context->scale->snapshot(now_ms);
      extraction_result = context->extraction->update(now_ms, &scale);
    }
    context->temperature->set_extraction_phase(
        context->cooldown->active()
            ? philcoino::control::ExtractionPhase::kIdle
            : context->extraction->snapshot(now_ms).phase,
        now_ms);
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
    if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
      context->performance_diagnostics->record(
          philcoino::diagnostics::DurationMetric::kWorkflowWorkUs,
          bounded_u32(monotonic_us() - started_us));
    }
    vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(10));
  }
}

struct ScaleTaskContext {
  philcoino::peripherals::Hx711EventDrivenAcquisition* acquisition;
  philcoino::peripherals::EspHx711ReadyWaiter* ready_waiter;
  philcoino::control::ScaleController* scale;
  FreeRtosApiSynchronization* synchronization;
  philcoino::diagnostics::PerformanceDiagnostics* performance_diagnostics;
};

void scale_sample_task(void* argument) {
  auto* context = static_cast<ScaleTaskContext*>(argument);
  if (!context->ready_waiter->initialize_for_current_task()) {
    ESP_LOGW(
        kLogTag,
        "HX711 data-ready interrupt initialization failed; weighted extraction remains blocked");
    if (context->synchronization->lock(
            philcoino::networking::ApiDomain::kExtraction)) {
      context->scale->update(
          {philcoino::peripherals::Hx711Status::kTransportError, 0},
          uptime_ms());
      context->synchronization->unlock(
          philcoino::networking::ApiDomain::kExtraction);
    }
    while (true) {
      vTaskDelay(pdMS_TO_TICKS(
          philcoino::config::kScaleUnavailableTimeoutMs));
    }
  }
  auto last_usable_sample_ms = uptime_ms();
  std::uint64_t previous_started_us = 0;
  bool usable_sample_received = false;
  bool unavailable_reported = false;
  while (true) {
    std::uint64_t started_us = 0;
    if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
      started_us = monotonic_us();
      if (previous_started_us != 0U) {
        context->performance_diagnostics->record(
            philcoino::diagnostics::DurationMetric::kScalePeriodDeviationUs,
            period_deviation_us(started_us, previous_started_us, 10'000U));
      }
      previous_started_us = started_us;
    }
    const auto reading = context->acquisition->acquire(
        philcoino::config::kScaleUnavailableTimeoutMs);
    const auto now_ms = uptime_ms();
    if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
      if (reading.status == philcoino::peripherals::Hx711Status::kNotReady) {
        context->performance_diagnostics->increment(
            philcoino::diagnostics::EventCounter::kScaleNotReady);
      }
    }
    if (reading.status == philcoino::peripherals::Hx711Status::kOk) {
      if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
        context->performance_diagnostics->increment(
            philcoino::diagnostics::EventCounter::kScaleAcceptedSample);
      }
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
    }
    if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
      context->performance_diagnostics->record(
          philcoino::diagnostics::DurationMetric::kScaleWorkUs,
          bounded_u32(monotonic_us() - started_us));
    }
  }
}

void report_performance_diagnostics(
    philcoino::diagnostics::PerformanceDiagnostics& diagnostics,
    TaskHandle_t temperature_task, TaskHandle_t workflow_task,
    TaskHandle_t scale_task, philcoino::peripherals::FailOffSsr& heater) {
  using philcoino::diagnostics::DurationMetric;
  using philcoino::diagnostics::EventCounter;
  using philcoino::diagnostics::StackRole;

  diagnostics.observe_stack_free(
      StackRole::kTemperature,
      static_cast<std::uint32_t>(
          uxTaskGetStackHighWaterMark(temperature_task)));
  diagnostics.observe_stack_free(
      StackRole::kWorkflow,
      static_cast<std::uint32_t>(uxTaskGetStackHighWaterMark(workflow_task)));
  if (scale_task != nullptr) {
    diagnostics.observe_stack_free(
        StackRole::kScale,
        static_cast<std::uint32_t>(uxTaskGetStackHighWaterMark(scale_task)));
  }
  diagnostics.observe_stack_free(
      StackRole::kDiagnostics,
      static_cast<std::uint32_t>(uxTaskGetStackHighWaterMark(nullptr)));
  static bool lease_trip_recorded = false;
  if (!lease_trip_recorded && heater.safety_cutoff_tripped()) {
    diagnostics.increment(EventCounter::kHeaterLeaseTripObserved);
    lease_trip_recorded = true;
  }

  const auto snapshot = diagnostics.snapshot();
  const auto counter = [&snapshot](EventCounter value) {
    return snapshot.counters[static_cast<std::size_t>(value)];
  };
  const auto maximum = [&snapshot](DurationMetric value) {
    return snapshot.durations[static_cast<std::size_t>(value)].maximum;
  };
  const auto stack = [&snapshot](StackRole value) {
    return snapshot
        .minimum_stack_free_bytes[static_cast<std::size_t>(value)];
  };

  ESP_LOGI(
      kLogTag,
      "PERF bounded counters lock_ok=%" PRIu32 " lock_timeout=%" PRIu32
      " deadline_miss=%" PRIu32 " scale_ok=%" PRIu32
      " scale_not_ready=%" PRIu32 " api=%" PRIu32 " lease_trip=%" PRIu32,
      counter(EventCounter::kWorkflowMutexAcquired),
      counter(EventCounter::kWorkflowMutexTimeout),
      counter(EventCounter::kWorkflowDeadlineMiss),
      counter(EventCounter::kScaleAcceptedSample),
      counter(EventCounter::kScaleNotReady),
      counter(EventCounter::kApiRequest),
      counter(EventCounter::kHeaterLeaseTripObserved));
  ESP_LOGI(
      kLogTag,
      "PERF maxima_us workflow_jitter=%" PRIu32 " workflow_work=%" PRIu32
      " scale_jitter=%" PRIu32 " scale_work=%" PRIu32
      " temperature_jitter=%" PRIu32 " temperature_work=%" PRIu32
      " mutex_wait=%" PRIu32 " mutex_hold=%" PRIu32
      " api_latency=%" PRIu32 " api_heap_drop_bytes=%" PRIu32
      " api_new_min_heap_drop_bytes=%" PRIu32,
      maximum(DurationMetric::kWorkflowPeriodDeviationUs),
      maximum(DurationMetric::kWorkflowWorkUs),
      maximum(DurationMetric::kScalePeriodDeviationUs),
      maximum(DurationMetric::kScaleWorkUs),
      maximum(DurationMetric::kTemperaturePeriodDeviationUs),
      maximum(DurationMetric::kTemperatureWorkUs),
      maximum(DurationMetric::kWorkflowMutexWaitUs),
      maximum(DurationMetric::kWorkflowMutexHoldUs),
      maximum(DurationMetric::kApiLatencyUs),
      maximum(DurationMetric::kApiHeapDecreaseBytes),
      maximum(DurationMetric::kApiNewMinimumHeapDropBytes));
  ESP_LOGI(
      kLogTag,
      "PERF resources heap_free=%u heap_min=%u largest_block=%u"
      " stack_free_bytes temperature=%" PRIu32 " workflow=%" PRIu32
      " scale=%" PRIu32 " http=%" PRIu32 " diagnostics=%" PRIu32,
      static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL)),
      static_cast<unsigned>(
          heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL)),
      static_cast<unsigned>(
          heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL)),
      stack(StackRole::kTemperature), stack(StackRole::kWorkflow),
      stack(StackRole::kScale), stack(StackRole::kHttp),
      stack(StackRole::kDiagnostics));
}

struct PerformanceTaskContext {
  philcoino::diagnostics::PerformanceDiagnostics* diagnostics;
  TaskHandle_t temperature_task;
  TaskHandle_t workflow_task;
  TaskHandle_t scale_task;
  philcoino::peripherals::FailOffSsr* heater;
};

void performance_diagnostics_task(void* argument) {
  const auto* context = static_cast<const PerformanceTaskContext*>(argument);
  while (true) {
    vTaskDelay(pdMS_TO_TICKS(60'000U));
    report_performance_diagnostics(
        *context->diagnostics, context->temperature_task,
        context->workflow_task, context->scale_task, *context->heater);
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

#ifdef CONFIG_PHILCOINO_PERFORMANCE_DIAGNOSTICS
  static philcoino::diagnostics::PerformanceDiagnostics
      performance_diagnostics_storage;
  auto* const performance_diagnostics = &performance_diagnostics_storage;
  ESP_LOGI(kLogTag, "Bounded performance diagnostics enabled reset_reason=%d",
           static_cast<int>(esp_reset_reason()));
#else
  philcoino::diagnostics::PerformanceDiagnostics* const
      performance_diagnostics = nullptr;
#endif

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
      workflow_mutex, pump, ssr, fail_safe_requested,
      performance_diagnostics);

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
      scale_calibration, scale_calibrated, scale_calibration_storage);
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
      &pump, &ssr, &fail_safe_requested, &synchronization, &scale_controller,
      performance_diagnostics};
  TaskHandle_t workflow_task = nullptr;
  if (xTaskCreate(workflow_control_task, "philcoino-workflow", 4096,
                  &workflow_context, configMAX_PRIORITIES - 2,
                  &workflow_task) != pdPASS) {
    ESP_LOGE(kLogTag, "Workflow controller task creation failed");
    pump.force_off();
    ssr.force_off();
    return;
  }

  static ScaleTaskContext scale_context{
      &hx711_acquisition, &hx711_ready_waiter, &scale_controller,
      &synchronization, performance_diagnostics};
  TaskHandle_t scale_task = nullptr;
  if (hx711_initialized &&
      xTaskCreate(scale_sample_task, "philcoino-scale", 3072,
                  &scale_context, configMAX_PRIORITIES - 3,
                  &scale_task) != pdPASS) {
    ESP_LOGW(kLogTag,
             "Scale sampling task creation failed; weighted extraction remains blocked");
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
      synchronization, &history, &scale_controller);
  static philcoino::networking::EspNetworkServer network(
      api, identity, performance_diagnostics);
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

  TaskHandle_t temperature_task = nullptr;
  std::uint64_t previous_temperature_started_us = 0;
  if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
    temperature_task = xTaskGetCurrentTaskHandle();
    previous_temperature_started_us = monotonic_us();
    static PerformanceTaskContext performance_context{
        performance_diagnostics, temperature_task, workflow_task, scale_task,
        &ssr};
    if (xTaskCreate(performance_diagnostics_task, "philcoino-perf", 3072,
                    &performance_context, 2, nullptr) != pdPASS) {
      ESP_LOGW(kLogTag,
               "Performance diagnostics reporter task could not be started");
    }
  }
  while (true) {
    vTaskDelay(pdMS_TO_TICKS(kMax6675SampleIntervalMs));
    std::uint64_t temperature_started_us = 0;
    if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
      temperature_started_us = monotonic_us();
      performance_diagnostics->record(
          philcoino::diagnostics::DurationMetric::
              kTemperaturePeriodDeviationUs,
          period_deviation_us(temperature_started_us,
                              previous_temperature_started_us,
                              static_cast<std::uint64_t>(
                                  kMax6675SampleIntervalMs) *
                                  1000U));
      previous_temperature_started_us = temperature_started_us;
    }
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
    if constexpr (philcoino::config::kPerformanceDiagnosticsEnabled) {
      performance_diagnostics->record(
          philcoino::diagnostics::DurationMetric::kTemperatureWorkUs,
          bounded_u32(monotonic_us() - temperature_started_us));
    }
  }
}
