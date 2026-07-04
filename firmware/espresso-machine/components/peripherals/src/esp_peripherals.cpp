#include "philcoino/esp_peripherals.hpp"

#include <array>

#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/spi_master.h"
#include "esp_err.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "philcoino/config.hpp"

namespace philcoino::peripherals {
namespace {

constexpr spi_host_device_t kThermocoupleSpiHost = SPI2_HOST;
constexpr char kNvsNamespace[] = "targets";
constexpr char kTargetsKey[] = "values";

spi_device_handle_t as_spi_device(void* handle) {
  return static_cast<spi_device_handle_t>(handle);
}

i2c_master_dev_handle_t as_i2c_device(void* handle) {
  return static_cast<i2c_master_dev_handle_t>(handle);
}

}  // namespace

bool EspMax6675Transport::initialize() {
  const auto chip_select_mask =
      (1ULL << config::kBrewThermocoupleChipSelectGpio) |
      (1ULL << config::kSteamThermocoupleChipSelectGpio);
  gpio_set_level(
      static_cast<gpio_num_t>(config::kBrewThermocoupleChipSelectGpio), 1);
  gpio_set_level(
      static_cast<gpio_num_t>(config::kSteamThermocoupleChipSelectGpio), 1);
  gpio_config_t chip_selects{};
  chip_selects.pin_bit_mask = chip_select_mask;
  chip_selects.mode = GPIO_MODE_OUTPUT;
  chip_selects.pull_up_en = GPIO_PULLUP_DISABLE;
  chip_selects.pull_down_en = GPIO_PULLDOWN_DISABLE;
  chip_selects.intr_type = GPIO_INTR_DISABLE;
  if (gpio_config(&chip_selects) != ESP_OK ||
      gpio_set_level(
          static_cast<gpio_num_t>(config::kBrewThermocoupleChipSelectGpio),
          1) != ESP_OK ||
      gpio_set_level(
          static_cast<gpio_num_t>(config::kSteamThermocoupleChipSelectGpio),
          1) != ESP_OK) {
    return false;
  }

  spi_bus_config_t bus{};
  bus.mosi_io_num = -1;
  bus.miso_io_num = config::kThermocoupleDataGpio;
  bus.sclk_io_num = config::kThermocoupleClockGpio;
  bus.quadwp_io_num = -1;
  bus.quadhd_io_num = -1;
  bus.max_transfer_sz = 2;
  if (spi_bus_initialize(kThermocoupleSpiHost, &bus, SPI_DMA_DISABLED) != ESP_OK) {
    return false;
  }

  spi_device_interface_config_t device{};
  device.mode = 0;
  device.clock_speed_hz = 1000000;
  device.queue_size = 1;
  device.spics_io_num = config::kBrewThermocoupleChipSelectGpio;
  spi_device_handle_t brew = nullptr;
  if (spi_bus_add_device(kThermocoupleSpiHost, &device, &brew) != ESP_OK) {
    return false;
  }

  device.spics_io_num = config::kSteamThermocoupleChipSelectGpio;
  spi_device_handle_t steam = nullptr;
  if (spi_bus_add_device(kThermocoupleSpiHost, &device, &steam) != ESP_OK) {
    return false;
  }

  brew_device_ = brew;
  steam_device_ = steam;
  initialized_ = true;
  return true;
}

bool EspMax6675Transport::read_frame(ThermocoupleChannel channel,
                                     std::uint16_t& frame) {
  if (!initialized_) {
    return false;
  }
  std::array<std::uint8_t, 2> received{};
  spi_transaction_t transaction{};
  transaction.length = 16;
  transaction.rxlength = 16;
  transaction.rx_buffer = received.data();
  const auto device = channel == ThermocoupleChannel::kBrew
                          ? as_spi_device(brew_device_)
                          : as_spi_device(steam_device_);
  if (spi_device_transmit(device, &transaction) != ESP_OK) {
    return false;
  }
  frame = static_cast<std::uint16_t>(
      (static_cast<std::uint16_t>(received[0]) << 8U) | received[1]);
  return true;
}

bool EspNvsTargetBackend::initialize() {
  auto result = nvs_flash_init();
  if (result == ESP_ERR_NVS_NO_FREE_PAGES ||
      result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    if (nvs_flash_erase() != ESP_OK) {
      return false;
    }
    result = nvs_flash_init();
  }
  if (result != ESP_OK) {
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
