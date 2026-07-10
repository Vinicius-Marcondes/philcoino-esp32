#pragma once

#include <cstddef>
#include <cstdint>

#include "philcoino/peripherals.hpp"

namespace philcoino::peripherals {

class EspMax6675Transport final : public Max6675Transport {
 public:
  bool initialize();
  bool read_frame(std::uint16_t& frame) override;

 private:
  bool initialized_{false};
};

class EspNvsTargetBackend final : public TargetBackend {
 public:
  bool initialize();
  BackendLoadResult load(TemperatureTargets& targets) override;
  bool save(const TemperatureTargets& targets) override;

 private:
  std::uint32_t handle_{0};
  bool initialized_{false};
};

class EspGpioOutput final : public DigitalOutput {
 public:
  explicit EspGpioOutput(std::int32_t gpio);

  bool set_level(bool high) override;
  bool configure_output() override;

 private:
  std::int32_t gpio_;
};

class EspOledTransport final : public OledTransport {
 public:
  bool initialize();
  bool write_command(const std::uint8_t* bytes,
                     std::size_t length) override;
  bool write_data(const std::uint8_t* bytes, std::size_t length) override;

 private:
  bool write(std::uint8_t control, const std::uint8_t* bytes,
             std::size_t length);

  void* bus_{nullptr};
  void* device_{nullptr};
  bool initialized_{false};
};

}  // namespace philcoino::peripherals
