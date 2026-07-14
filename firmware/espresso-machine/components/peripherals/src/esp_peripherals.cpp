#include "philcoino/esp_peripherals.hpp"

#include <algorithm>
#include <array>
#include <cinttypes>

#include "driver/gpio.h"
#include "driver/i2c_master.h"
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
constexpr char kProfileNvsNamespace[] = "profiles";
constexpr char kProfilesKey[] = "set";
constexpr std::array<std::uint8_t, 4> kProfileBlobMagic{'P', 'F', 'P', '2'};
constexpr std::uint8_t kProfileBlobVersion = 1;
constexpr std::size_t kStoredProfileSize = 1U + kProfileNameCapacity + 3U;
constexpr std::size_t kProfileBlobSize =
    kProfileBlobMagic.size() + 1U + kProfileSlotCount * kStoredProfileSize;

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

i2c_master_dev_handle_t as_i2c_device(void* handle) {
  return static_cast<i2c_master_dev_handle_t>(handle);
}

const char* frame_status(std::uint16_t frame) {
  if ((frame & 0x0004U) != 0U) {
    return "open_circuit";
  }
  if ((frame & 0x8002U) != 0U) {
    return "invalid_frame";
  }
  return "ok";
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

  if (gpio_set_level(static_cast<gpio_num_t>(selected_gpio), 0) != ESP_OK) {
    gpio_set_level(static_cast<gpio_num_t>(selected_gpio), 1);
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
    ESP_LOGE(kThermocoupleLogTag,
             "boiler sensor CS verification failed: GPIO%" PRId32 "=%d",
             selected_gpio, selected_level);
    return false;
  }

  frame = 0;
  for (std::uint32_t bit = 0; bit < 16U; ++bit) {
    if (gpio_set_level(
            static_cast<gpio_num_t>(selected_clock_gpio), 1) !=
        ESP_OK) {
      gpio_set_level(
          static_cast<gpio_num_t>(selected_clock_gpio), 0);
      gpio_set_level(static_cast<gpio_num_t>(selected_gpio), 1);
      ESP_LOGE(kThermocoupleLogTag,
               "boiler sensor clock-high failed on GPIO%" PRId32,
               selected_clock_gpio);
      return false;
    }
    esp_rom_delay_us(1);
    frame = static_cast<std::uint16_t>(
        (frame << 1U) |
        static_cast<std::uint16_t>(gpio_get_level(
            static_cast<gpio_num_t>(selected_data_gpio)) != 0));
    if (gpio_set_level(
            static_cast<gpio_num_t>(selected_clock_gpio), 0) !=
        ESP_OK) {
      gpio_set_level(static_cast<gpio_num_t>(selected_gpio), 1);
      ESP_LOGE(kThermocoupleLogTag,
               "boiler sensor clock-low failed on GPIO%" PRId32,
               selected_clock_gpio);
      return false;
    }
    esp_rom_delay_us(1);
  }

  const auto deselect_result =
      gpio_set_level(static_cast<gpio_num_t>(selected_gpio), 1);
  if (deselect_result != ESP_OK) {
    ESP_LOGE(kThermocoupleLogTag,
             "boiler sensor deselect failed on GPIO%" PRId32 ": %s",
             selected_gpio,
             esp_err_to_name(deselect_result));
    return false;
  }

  ESP_LOGI(kThermocoupleLogTag,
           "boiler CS=GPIO%" PRId32 " SCK=GPIO%" PRId32 " SO=GPIO%" PRId32
           " raw=0x%04X status=%s cs_verified=1",
           selected_gpio, selected_clock_gpio, selected_data_gpio,
           static_cast<unsigned>(frame), frame_status(frame));
  return true;
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

bool EspNvsProfileBackend::initialize() {
  if (!initialize_nvs_flash()) {
    return false;
  }
  nvs_handle_t handle = 0;
  if (nvs_open(kProfileNvsNamespace, NVS_READWRITE, &handle) != ESP_OK) {
    return false;
  }
  handle_ = handle;
  initialized_ = true;
  return true;
}

BackendLoadResult EspNvsProfileBackend::load(ExtractionProfiles& profiles) {
  if (!initialized_) {
    return BackendLoadResult::kError;
  }
  std::array<std::uint8_t, kProfileBlobSize> stored{};
  std::size_t stored_size = stored.size();
  const auto result =
      nvs_get_blob(handle_, kProfilesKey, stored.data(), &stored_size);
  if (result == ESP_ERR_NVS_NOT_FOUND) {
    return BackendLoadResult::kNotFound;
  }
  if (result != ESP_OK || stored_size != stored.size() ||
      !std::equal(kProfileBlobMagic.begin(), kProfileBlobMagic.end(),
                  stored.begin()) ||
      stored[kProfileBlobMagic.size()] != kProfileBlobVersion) {
    return BackendLoadResult::kError;
  }

  std::size_t offset = kProfileBlobMagic.size() + 1U;
  for (auto& profile : profiles) {
    profile = {};
    const auto configured = stored[offset++];
    if (configured > 1U) {
      return BackendLoadResult::kError;
    }
    profile.configured = configured == 1U;
    for (auto& character : profile.name) {
      character = static_cast<char>(stored[offset++]);
    }
    profile.pre_infusion_seconds = stored[offset++];
    profile.soak_seconds = stored[offset++];
    profile.main_extraction_seconds = stored[offset++];
  }
  return BackendLoadResult::kOk;
}

bool EspNvsProfileBackend::save(const ExtractionProfiles& profiles) {
  if (!initialized_ || !extraction_profiles_are_valid(profiles)) {
    return false;
  }
  std::array<std::uint8_t, kProfileBlobSize> stored{};
  std::copy(kProfileBlobMagic.begin(), kProfileBlobMagic.end(), stored.begin());
  stored[kProfileBlobMagic.size()] = kProfileBlobVersion;
  std::size_t offset = kProfileBlobMagic.size() + 1U;
  for (const auto& profile : profiles) {
    stored[offset++] = profile.configured ? 1U : 0U;
    for (const auto character : profile.name) {
      stored[offset++] = static_cast<std::uint8_t>(character);
    }
    stored[offset++] = profile.pre_infusion_seconds;
    stored[offset++] = profile.soak_seconds;
    stored[offset++] = profile.main_extraction_seconds;
  }
  return nvs_set_blob(handle_, kProfilesKey, stored.data(), stored.size()) ==
             ESP_OK &&
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

bool EspOledTransport::initialize() {
  i2c_master_bus_config_t bus_config{};
  bus_config.i2c_port = I2C_NUM_0;
  bus_config.sda_io_num = static_cast<gpio_num_t>(config::kOledSdaGpio);
  bus_config.scl_io_num = static_cast<gpio_num_t>(config::kOledSclGpio);
  bus_config.clk_source = I2C_CLK_SRC_DEFAULT;
  bus_config.glitch_ignore_cnt = 7;
  bus_config.flags.enable_internal_pullup = false;
  i2c_master_bus_handle_t bus = nullptr;
  if (i2c_new_master_bus(&bus_config, &bus) != ESP_OK) {
    return false;
  }

  i2c_device_config_t device_config{};
  device_config.dev_addr_length = I2C_ADDR_BIT_LEN_7;
  device_config.device_address = config::kOledI2cAddress;
  device_config.scl_speed_hz = 400000;
  i2c_master_dev_handle_t device = nullptr;
  if (i2c_master_bus_add_device(bus, &device_config, &device) != ESP_OK) {
    return false;
  }
  bus_ = bus;
  device_ = device;
  initialized_ = true;
  return true;
}

bool EspOledTransport::write_command(const std::uint8_t* bytes,
                                     std::size_t length) {
  return write(0x00, bytes, length);
}

bool EspOledTransport::write_data(const std::uint8_t* bytes,
                                  std::size_t length) {
  return write(0x40, bytes, length);
}

bool EspOledTransport::write(std::uint8_t control, const std::uint8_t* bytes,
                             std::size_t length) {
  constexpr std::size_t kMaximumPayload = Ssd1306Display::kBufferSize;
  if (!initialized_ || bytes == nullptr || length == 0 ||
      length > kMaximumPayload) {
    return false;
  }
  std::array<std::uint8_t, kMaximumPayload + 1> packet{};
  packet[0] = control;
  for (std::size_t index = 0; index < length; ++index) {
    packet[index + 1] = bytes[index];
  }
  return i2c_master_transmit(as_i2c_device(device_), packet.data(), length + 1,
                             100) == ESP_OK;
}

}  // namespace philcoino::peripherals
