#pragma once

#include <cstddef>
#include <cstdint>

#include "driver/gptimer.h"
#include "esp_attr.h"
#include "freertos/FreeRTOS.h"
#include "philcoino/peripherals.hpp"

namespace philcoino::peripherals {

class EspOutputCriticalSection final : public OutputCriticalSection {
 public:
  void enter() override;
  void exit() override;

 private:
  portMUX_TYPE lock_ = portMUX_INITIALIZER_UNLOCKED;
};

class EspMax6675Transport final : public Max6675Transport {
 public:
  bool initialize();
  bool read_frame(std::uint16_t& frame) override;

 private:
  bool initialized_{false};
};

class EspHx711Transport final : public Hx711Transport {
 public:
  bool initialize();
  Hx711Reading read() override;

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

class EspNvsProfileBackend final : public ProfileBackend {
 public:
  bool initialize();
  BackendLoadResult load(ExtractionProfiles& profiles) override;
  bool save(const ExtractionProfiles& profiles) override;

 private:
  std::uint32_t handle_{0};
  bool initialized_{false};
};

class EspNvsScaleCalibrationBackend final : public ScaleCalibrationBackend {
 public:
  bool initialize();
  BackendLoadResult load(ScaleCalibration& calibration) override;
  bool save(const ScaleCalibration& calibration) override;

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

class EspGptimerSafetyLease final : public SsrSafetyLease {
 public:
  EspGptimerSafetyLease(std::int32_t gpio, bool active_high);

  bool initialize() override;
  bool arm(std::uint32_t duration_ms) override;
  bool disarm() override;
  bool tripped() const override;

 private:
  static bool IRAM_ATTR on_alarm(gptimer_handle_t timer,
                                 const gptimer_alarm_event_data_t* event,
                                 void* context);
  void IRAM_ATTR fail_off_from_isr();

  gptimer_handle_t timer_{nullptr};
  std::int32_t gpio_;
  std::uint32_t off_level_;
  mutable portMUX_TYPE trip_lock_ = portMUX_INITIALIZER_UNLOCKED;
  bool tripped_{false};
  bool initialized_{false};
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
