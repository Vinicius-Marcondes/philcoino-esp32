#include "philcoino/esp_peripherals.hpp"

#include "sdkconfig.h"

#if !CONFIG_GPTIMER_ISR_CACHE_SAFE
#error "PhilcoINO requires CONFIG_GPTIMER_ISR_CACHE_SAFE for the heater lease"
#endif

#if !CONFIG_GPIO_CTRL_FUNC_IN_IRAM
#error "PhilcoINO requires CONFIG_GPIO_CTRL_FUNC_IN_IRAM for the heater lease"
#endif

#if !CONFIG_FREERTOS_IN_IRAM
#error "PhilcoINO requires CONFIG_FREERTOS_IN_IRAM for cache-safe HX711 notification"
#endif

#include <algorithm>
#include <array>
#include <cinttypes>

#include "driver/gpio.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_rom_sys.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "philcoino/config.hpp"

namespace philcoino::peripherals {
namespace {

constexpr char kThermocoupleLogTag[] = "max6675";
constexpr char kNvsNamespace[] = "targets";
constexpr char kTargetsKey[] = "values";
constexpr char kTemperatureCalibrationNvsNamespace[] = "temp_cal";
constexpr char kTemperatureCalibrationKey[] = "offset";
constexpr std::int32_t kTemperatureCalibrationBlobMagic = 0x5443414C;
constexpr std::int32_t kTemperatureCalibrationBlobVersion = 1;
constexpr char kSteamControlNvsNamespace[] = "steam_ctl";
constexpr char kSteamControlKey[] = "settings";
constexpr std::int32_t kSteamControlBlobMagic = 0x5354434C;
constexpr std::int32_t kSteamControlBlobVersion = 1;
constexpr char kScaleNvsNamespace[] = "scale";
constexpr char kScaleCalibrationKey[] = "calibration";

bool initialize_nvs_flash() {
  auto result = nvs_flash_init();
  if (result == ESP_ERR_NVS_NO_FREE_PAGES ||
      result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    if (nvs_flash_erase() != ESP_OK) {
      return false;
    }
    result = nvs_flash_init();
  }
  return result == ESP_OK;
}

}  // namespace

bool EspMax6675Transport::initialize() {
  const auto output_mask =
      (1ULL << config::kBoilerThermocoupleChipSelectGpio) |
      (1ULL << config::kBoilerThermocoupleClockGpio);
  gpio_set_level(
      static_cast<gpio_num_t>(config::kBoilerThermocoupleChipSelectGpio), 1);
  gpio_set_level(
      static_cast<gpio_num_t>(config::kBoilerThermocoupleClockGpio), 0);

  gpio_config_t outputs{};
  outputs.pin_bit_mask = output_mask;
  outputs.mode = GPIO_MODE_INPUT_OUTPUT;
  outputs.pull_up_en = GPIO_PULLUP_DISABLE;
  outputs.pull_down_en = GPIO_PULLDOWN_DISABLE;
  outputs.intr_type = GPIO_INTR_DISABLE;
  if (gpio_config(&outputs) != ESP_OK ||
      gpio_set_level(
          static_cast<gpio_num_t>(config::kBoilerThermocoupleChipSelectGpio),
          1) != ESP_OK ||
      gpio_set_level(
          static_cast<gpio_num_t>(config::kBoilerThermocoupleClockGpio), 0) !=
          ESP_OK) {
    return false;
  }

  gpio_config_t inputs{};
  inputs.pin_bit_mask = 1ULL << config::kBoilerThermocoupleDataGpio;
  inputs.mode = GPIO_MODE_INPUT;
  inputs.pull_up_en = GPIO_PULLUP_DISABLE;
  inputs.pull_down_en = GPIO_PULLDOWN_DISABLE;
  inputs.intr_type = GPIO_INTR_DISABLE;
  if (gpio_config(&inputs) != ESP_OK) {
    return false;
  }

  initialized_ = true;
  return true;
}

bool EspMax6675Transport::read_frame(std::uint16_t& frame) {
  if (!initialized_) {
    return false;
  }
  constexpr auto selected_gpio = config::kBoilerThermocoupleChipSelectGpio;
  constexpr auto selected_data_gpio = config::kBoilerThermocoupleDataGpio;
  constexpr auto selected_clock_gpio = config::kBoilerThermocoupleClockGpio;
  if (gpio_set_level(
          static_cast<gpio_num_t>(config::kBoilerThermocoupleChipSelectGpio),
          1) != ESP_OK ||
      gpio_set_level(
          static_cast<gpio_num_t>(config::kBoilerThermocoupleClockGpio), 0) !=
          ESP_OK) {
    ESP_LOGE(kThermocoupleLogTag, "boiler sensor idle setup failed");
    return false;
  }

  portENTER_CRITICAL(&bus_lock_);
  if (gpio_set_level(static_cast<gpio_num_t>(selected_gpio), 0) != ESP_OK) {
    gpio_set_level(static_cast<gpio_num_t>(selected_gpio), 1);
    portEXIT_CRITICAL(&bus_lock_);
    ESP_LOGE(kThermocoupleLogTag,
             "boiler sensor CS setup failed on GPIO%" PRId32,
             selected_gpio);
    return false;
  }

  esp_rom_delay_us(1);
  const auto selected_level =
      gpio_get_level(static_cast<gpio_num_t>(selected_gpio));
  if (selected_level != 0) {
    gpio_set_level(static_cast<gpio_num_t>(selected_gpio), 1);
    portEXIT_CRITICAL(&bus_lock_);
    ESP_LOGE(kThermocoupleLogTag,
             "boiler sensor CS verification failed: GPIO%" PRId32 "=%d",
             selected_gpio, selected_level);
    return false;
  }

  frame = 0;
  bool clock_high_failed = false;
  bool clock_low_failed = false;
  for (std::uint32_t bit = 0; bit < 16U; ++bit) {
    if (gpio_set_level(
            static_cast<gpio_num_t>(selected_clock_gpio), 1) !=
        ESP_OK) {
      clock_high_failed = true;
      break;
    }
    esp_rom_delay_us(1);
    frame = static_cast<std::uint16_t>(
        (frame << 1U) |
        static_cast<std::uint16_t>(gpio_get_level(
            static_cast<gpio_num_t>(selected_data_gpio)) != 0));
    if (gpio_set_level(
            static_cast<gpio_num_t>(selected_clock_gpio), 0) !=
        ESP_OK) {
      clock_low_failed = true;
      break;
    }
    esp_rom_delay_us(1);
  }

  gpio_set_level(static_cast<gpio_num_t>(selected_clock_gpio), 0);
  const auto deselect_result =
      gpio_set_level(static_cast<gpio_num_t>(selected_gpio), 1);
  portEXIT_CRITICAL(&bus_lock_);
  if (clock_high_failed || clock_low_failed) {
    ESP_LOGE(kThermocoupleLogTag,
             "boiler sensor clock-%s failed on GPIO%" PRId32,
             clock_high_failed ? "high" : "low", selected_clock_gpio);
    return false;
  }
  if (deselect_result != ESP_OK) {
    ESP_LOGE(kThermocoupleLogTag,
             "boiler sensor deselect failed on GPIO%" PRId32 ": %s",
             selected_gpio,
             esp_err_to_name(deselect_result));
    return false;
  }

  return true;
}

bool EspHx711Transport::initialize() {
  gpio_set_level(static_cast<gpio_num_t>(config::kScaleClockGpio), 0);
  gpio_config_t clock{};
  clock.pin_bit_mask = 1ULL << config::kScaleClockGpio;
  clock.mode = GPIO_MODE_OUTPUT;
  clock.pull_up_en = GPIO_PULLUP_DISABLE;
  clock.pull_down_en = GPIO_PULLDOWN_DISABLE;
  clock.intr_type = GPIO_INTR_DISABLE;
  gpio_config_t data{};
  data.pin_bit_mask = 1ULL << config::kScaleDataGpio;
  data.mode = GPIO_MODE_INPUT;
  data.pull_up_en = GPIO_PULLUP_DISABLE;
  data.pull_down_en = GPIO_PULLDOWN_DISABLE;
  data.intr_type = GPIO_INTR_DISABLE;
  if (gpio_config(&clock) != ESP_OK || gpio_config(&data) != ESP_OK ||
      gpio_set_level(static_cast<gpio_num_t>(config::kScaleClockGpio), 0) !=
          ESP_OK) {
    return false;
  }
  initialized_ = true;
  return true;
}

Hx711Reading EspHx711Transport::read() {
  if (!initialized_) {
    return {Hx711Status::kTransportError, 0};
  }
  const auto data_gpio = static_cast<gpio_num_t>(config::kScaleDataGpio);
  const auto clock_gpio = static_cast<gpio_num_t>(config::kScaleClockGpio);
  if (gpio_get_level(data_gpio) != 0) {
    return {Hx711Status::kNotReady, 0};
  }

  portENTER_CRITICAL(&bus_lock_);
  if (gpio_get_level(data_gpio) != 0) {
    portEXIT_CRITICAL(&bus_lock_);
    return {Hx711Status::kNotReady, 0};
  }
  std::uint32_t raw = 0;
  bool transport_failed = false;
  for (std::uint32_t bit = 0; bit < 24U; ++bit) {
    if (gpio_set_level(clock_gpio, 1) != ESP_OK) {
      transport_failed = true;
      break;
    }
    esp_rom_delay_us(1);
    raw = (raw << 1U) |
          static_cast<std::uint32_t>(gpio_get_level(data_gpio) != 0);
    if (gpio_set_level(clock_gpio, 0) != ESP_OK) {
      transport_failed = true;
      break;
    }
    esp_rom_delay_us(1);
  }
  // The 25th pulse selects channel A at gain 128 for the next conversion.
  if (!transport_failed) {
    if (gpio_set_level(clock_gpio, 1) != ESP_OK) {
      transport_failed = true;
    } else {
      esp_rom_delay_us(1);
      if (gpio_set_level(clock_gpio, 0) != ESP_OK) {
        transport_failed = true;
      }
    }
  }
  gpio_set_level(clock_gpio, 0);
  portEXIT_CRITICAL(&bus_lock_);
  if (transport_failed) {
    return {Hx711Status::kTransportError, 0};
  }
  if (raw == 0x800000U || raw == 0x7FFFFFU) {
    return {Hx711Status::kSaturated, 0};
  }
  if ((raw & 0x800000U) != 0U) {
    raw |= 0xFF000000U;
  }
  return {Hx711Status::kOk, static_cast<std::int32_t>(raw)};
}

bool EspHx711ReadyWaiter::initialize_for_current_task() {
  if (initialized_) return true;
  task_ = xTaskGetCurrentTaskHandle();
  if (task_ == nullptr) return false;
  const auto install_result = gpio_install_isr_service(ESP_INTR_FLAG_IRAM);
  if (install_result != ESP_OK &&
      install_result != ESP_ERR_INVALID_STATE) {
    task_ = nullptr;
    return false;
  }
  const auto data_gpio = static_cast<gpio_num_t>(config::kScaleDataGpio);
  if (gpio_set_intr_type(data_gpio, GPIO_INTR_NEGEDGE) != ESP_OK ||
      gpio_isr_handler_add(data_gpio, &EspHx711ReadyWaiter::on_ready, this) !=
          ESP_OK ||
      gpio_intr_enable(data_gpio) != ESP_OK) {
    gpio_isr_handler_remove(data_gpio);
    task_ = nullptr;
    return false;
  }
  initialized_ = true;
  return true;
}

bool EspHx711ReadyWaiter::wait(std::uint32_t timeout_ms) {
  if (!initialized_) {
    constexpr std::uint32_t kPollingFallbackIntervalMs = 10U;
    vTaskDelay(pdMS_TO_TICKS(
        std::min(timeout_ms, kPollingFallbackIntervalMs)));
    return false;
  }
  return ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(timeout_ms)) > 0U;
}

void EspHx711ReadyWaiter::on_ready(void* context) {
  auto* waiter = static_cast<EspHx711ReadyWaiter*>(context);
  BaseType_t higher_priority_task_woken = pdFALSE;
  vTaskNotifyGiveFromISR(waiter->task_, &higher_priority_task_woken);
  if (higher_priority_task_woken == pdTRUE) {
    portYIELD_FROM_ISR();
  }
}

bool EspNvsTargetBackend::initialize() {
  if (!initialize_nvs_flash()) {
    return false;
  }
  nvs_handle_t handle = 0;
  if (nvs_open(kNvsNamespace, NVS_READWRITE, &handle) != ESP_OK) {
    return false;
  }
  handle_ = handle;
  initialized_ = true;
  return true;
}

BackendLoadResult EspNvsTargetBackend::load(TemperatureTargets& targets) {
  if (!initialized_) {
    return BackendLoadResult::kError;
  }
  std::array<std::int32_t, 2> stored{};
  std::size_t stored_size = sizeof(stored);
  const auto result =
      nvs_get_blob(handle_, kTargetsKey, stored.data(), &stored_size);
  if (result == ESP_ERR_NVS_NOT_FOUND) {
    return BackendLoadResult::kNotFound;
  }
  if (result != ESP_OK || stored_size != sizeof(stored)) {
    return BackendLoadResult::kError;
  }
  targets = {stored[0], stored[1]};
  return BackendLoadResult::kOk;
}

bool EspNvsTargetBackend::save(const TemperatureTargets& targets) {
  const std::array<std::int32_t, 2> stored{targets.brew_c, targets.steam_c};
  return initialized_ && nvs_set_blob(handle_, kTargetsKey, stored.data(),
                                      sizeof(stored)) == ESP_OK &&
         nvs_commit(handle_) == ESP_OK;
}

bool EspNvsTemperatureCalibrationBackend::initialize() {
  if (!initialize_nvs_flash()) {
    return false;
  }
  nvs_handle_t handle = 0;
  if (nvs_open(kTemperatureCalibrationNvsNamespace, NVS_READWRITE, &handle) !=
      ESP_OK) {
    return false;
  }
  handle_ = handle;
  initialized_ = true;
  return true;
}

BackendLoadResult EspNvsTemperatureCalibrationBackend::load(
    TemperatureCalibration& calibration) {
  if (!initialized_) {
    return BackendLoadResult::kError;
  }
  std::array<std::int32_t, 3> stored{};
  std::size_t stored_size = sizeof(stored);
  const auto result = nvs_get_blob(handle_, kTemperatureCalibrationKey,
                                   stored.data(), &stored_size);
  if (result == ESP_ERR_NVS_NOT_FOUND) {
    return BackendLoadResult::kNotFound;
  }
  if (result != ESP_OK || stored_size != sizeof(stored) ||
      stored[0] != kTemperatureCalibrationBlobMagic ||
      stored[1] != kTemperatureCalibrationBlobVersion) {
    return BackendLoadResult::kError;
  }
  calibration = {stored[2], true};
  return BackendLoadResult::kOk;
}

bool EspNvsTemperatureCalibrationBackend::save(
    const TemperatureCalibration& calibration) {
  const std::array<std::int32_t, 3> stored{
      kTemperatureCalibrationBlobMagic,
      kTemperatureCalibrationBlobVersion,
      calibration.offset_c,
  };
  return initialized_ && calibration.calibrated &&
         temperature_calibration_is_valid(calibration) &&
         nvs_set_blob(handle_, kTemperatureCalibrationKey, stored.data(),
                      sizeof(stored)) == ESP_OK &&
         nvs_commit(handle_) == ESP_OK;
}

bool EspNvsSteamControlSettingsBackend::initialize() {
  if (!initialize_nvs_flash()) {
    return false;
  }
  nvs_handle_t handle = 0;
  if (nvs_open(kSteamControlNvsNamespace, NVS_READWRITE, &handle) != ESP_OK) {
    return false;
  }
  handle_ = handle;
  initialized_ = true;
  return true;
}

BackendLoadResult EspNvsSteamControlSettingsBackend::load(
    SteamControlSettings& settings) {
  if (!initialized_) {
    return BackendLoadResult::kError;
  }
  std::array<std::int32_t, 5> stored{};
  std::size_t stored_size = sizeof(stored);
  const auto result =
      nvs_get_blob(handle_, kSteamControlKey, stored.data(), &stored_size);
  if (result == ESP_ERR_NVS_NOT_FOUND) {
    return BackendLoadResult::kNotFound;
  }
  if (result != ESP_OK || stored_size != sizeof(stored) ||
      stored[0] != kSteamControlBlobMagic ||
      stored[1] != kSteamControlBlobVersion || stored[3] < 0 ||
      stored[4] < 0) {
    return BackendLoadResult::kError;
  }
  settings = {
      stored[2],
      static_cast<std::uint32_t>(stored[3]),
      static_cast<std::uint32_t>(stored[4]),
  };
  return BackendLoadResult::kOk;
}

bool EspNvsSteamControlSettingsBackend::save(
    const SteamControlSettings& settings) {
  const std::array<std::int32_t, 5> stored{
      kSteamControlBlobMagic,
      kSteamControlBlobVersion,
      settings.initial_compensation_c,
      static_cast<std::int32_t>(settings.decay_duration_ms),
      static_cast<std::int32_t>(settings.ready_timeout_ms),
  };
  return initialized_ && steam_control_settings_are_valid(settings) &&
         nvs_set_blob(handle_, kSteamControlKey, stored.data(),
                      sizeof(stored)) == ESP_OK &&
         nvs_commit(handle_) == ESP_OK;
}

bool EspNvsScaleCalibrationBackend::initialize() {
  if (!initialize_nvs_flash()) {
    return false;
  }
  nvs_handle_t handle = 0;
  if (nvs_open(kScaleNvsNamespace, NVS_READWRITE, &handle) != ESP_OK) {
    return false;
  }
  handle_ = handle;
  initialized_ = true;
  return true;
}

BackendLoadResult EspNvsScaleCalibrationBackend::load(
    ScaleCalibration& calibration) {
  if (!initialized_) {
    return BackendLoadResult::kError;
  }
  std::array<std::int32_t, 3> stored{};
  std::size_t size = sizeof(stored);
  const auto result =
      nvs_get_blob(handle_, kScaleCalibrationKey, stored.data(), &size);
  if (result == ESP_ERR_NVS_NOT_FOUND) {
    return BackendLoadResult::kNotFound;
  }
  if (result != ESP_OK || size != sizeof(stored)) {
    return BackendLoadResult::kError;
  }
  calibration = {stored[0], stored[1], stored[2]};
  return BackendLoadResult::kOk;
}

bool EspNvsScaleCalibrationBackend::save(
    const ScaleCalibration& calibration) {
  const std::array<std::int32_t, 3> stored{
      calibration.zero_raw,
      calibration.reference_raw,
      calibration.reference_decigrams,
  };
  return initialized_ && scale_calibration_is_valid(calibration) &&
         nvs_set_blob(handle_, kScaleCalibrationKey, stored.data(),
                      sizeof(stored)) == ESP_OK &&
         nvs_commit(handle_) == ESP_OK;
}

EspGpioOutput::EspGpioOutput(std::int32_t gpio) : gpio_(gpio) {}

bool EspGpioOutput::set_level(bool high) {
  return gpio_set_level(static_cast<gpio_num_t>(gpio_), high ? 1 : 0) == ESP_OK;
}

bool EspGpioOutput::configure_output() {
  gpio_config_t configuration{};
  configuration.pin_bit_mask = 1ULL << static_cast<std::uint32_t>(gpio_);
  configuration.mode = GPIO_MODE_OUTPUT;
  configuration.pull_up_en = GPIO_PULLUP_DISABLE;
  configuration.pull_down_en = GPIO_PULLDOWN_DISABLE;
  configuration.intr_type = GPIO_INTR_DISABLE;
  return gpio_config(&configuration) == ESP_OK;
}

EspGptimerSafetyLease::EspGptimerSafetyLease(std::int32_t gpio,
                                             bool active_high)
    : gpio_(gpio), off_level_(active_high ? 0U : 1U) {}

bool EspGptimerSafetyLease::initialize() {
  initialized_ = false;
  portENTER_CRITICAL(&trip_lock_);
  tripped_ = false;
  portEXIT_CRITICAL(&trip_lock_);
  if (gpio_set_level(static_cast<gpio_num_t>(gpio_), off_level_) != ESP_OK) {
    return false;
  }

  gptimer_config_t timer_config{};
  timer_config.clk_src = GPTIMER_CLK_SRC_DEFAULT;
  timer_config.direction = GPTIMER_COUNT_UP;
  timer_config.resolution_hz = 1000000U;
  if (gptimer_new_timer(&timer_config, &timer_) != ESP_OK) {
    timer_ = nullptr;
    return false;
  }

  gptimer_event_callbacks_t callbacks{};
  callbacks.on_alarm = on_alarm;
  if (gptimer_register_event_callbacks(timer_, &callbacks, this) != ESP_OK ||
      gptimer_enable(timer_) != ESP_OK || gptimer_start(timer_) != ESP_OK) {
    gpio_set_level(static_cast<gpio_num_t>(gpio_), off_level_);
    if (timer_ != nullptr) {
      gptimer_disable(timer_);
      gptimer_del_timer(timer_);
      timer_ = nullptr;
    }
    return false;
  }

  initialized_ = true;
  return true;
}

bool EspGptimerSafetyLease::arm(std::uint32_t duration_ms) {
  if (!initialized_ || timer_ == nullptr || duration_ms == 0U || tripped()) {
    return false;
  }

  std::uint64_t current_count = 0;
  if (gptimer_get_raw_count(timer_, &current_count) != ESP_OK) {
    return false;
  }
  gptimer_alarm_config_t alarm{};
  alarm.alarm_count = current_count +
                      static_cast<std::uint64_t>(duration_ms) * 1000ULL;
  alarm.flags.auto_reload_on_alarm = false;
  return gptimer_set_alarm_action(timer_, &alarm) == ESP_OK;
}

bool EspGptimerSafetyLease::disarm() {
  return initialized_ && timer_ != nullptr &&
         gptimer_set_alarm_action(timer_, nullptr) == ESP_OK;
}

bool EspGptimerSafetyLease::tripped() const {
  portENTER_CRITICAL(&trip_lock_);
  const bool value = tripped_;
  portEXIT_CRITICAL(&trip_lock_);
  return value;
}

bool EspGptimerSafetyLease::on_alarm(
    gptimer_handle_t, const gptimer_alarm_event_data_t*, void* context) {
  static_cast<EspGptimerSafetyLease*>(context)->fail_off_from_isr();
  return false;
}

void EspGptimerSafetyLease::fail_off_from_isr() {
  gpio_set_level(static_cast<gpio_num_t>(gpio_), off_level_);
  portENTER_CRITICAL_ISR(&trip_lock_);
  tripped_ = true;
  portEXIT_CRITICAL_ISR(&trip_lock_);
}

void EspOutputCriticalSection::enter() { portENTER_CRITICAL(&lock_); }

void EspOutputCriticalSection::exit() { portEXIT_CRITICAL(&lock_); }

}  // namespace philcoino::peripherals
