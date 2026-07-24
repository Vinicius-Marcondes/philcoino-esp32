#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>

#include "freertos/FreeRTOS.h"
#include "philcoino/esp_networking.hpp"
#include "philcoino/prediction.hpp"

namespace philcoino::diagnostics {

class PerformanceDiagnostics final
    : public control::PredictionPerformanceObserver,
      public networking::NetworkPerformanceObserver {
 public:
  PerformanceDiagnostics();

  void prediction_update_started() override;
  void prediction_update_finished() override;
  void record_http_request(
      const networking::HttpRequestPerformanceSample& sample) override;
  void record_wifi_disconnect(std::uint8_t reason,
                              std::int8_t rssi) override;

  void record_controller_update(std::uint64_t duration_us,
                                std::uint64_t interval_us,
                                bool timing_invalid,
                                std::size_t stack_high_water_bytes);
  void record_mutex_wait(std::uint64_t duration_us, bool acquired);
  void record_mutex_hold(std::uint64_t duration_us);
  void record_workflow_stack(std::size_t stack_high_water_bytes);
  void maybe_log();

 private:
  struct DurationAggregate {
    std::uint64_t count{0};
    std::uint64_t total_us{0};
    std::uint64_t maximum_us{0};
  };

  struct RouteAggregate {
    DurationAggregate request{};
    DurationAggregate api{};
    DurationAggregate send{};
    std::uint64_t response_bytes{0};
    std::uint64_t send_failures{0};
    std::uint64_t non_success_responses{0};
    std::size_t maximum_open_sessions{0};
    std::size_t minimum_heap{static_cast<std::size_t>(-1)};
    std::size_t minimum_largest_block{static_cast<std::size_t>(-1)};
    std::size_t minimum_http_stack{static_cast<std::size_t>(-1)};
  };

  static void record_duration(DurationAggregate& aggregate,
                              std::uint64_t duration_us);
  static void failed_allocation(std::size_t size, std::uint32_t caps,
                                const char* function_name);

  static PerformanceDiagnostics* instance_;

  portMUX_TYPE lock_ = portMUX_INITIALIZER_UNLOCKED;
  std::array<RouteAggregate,
             static_cast<std::size_t>(
                 networking::HttpPerformanceRoute::kCount)>
      routes_{};
  DurationAggregate prediction_{};
  DurationAggregate controller_{};
  DurationAggregate mutex_wait_{};
  DurationAggregate mutex_hold_{};
  std::uint64_t controller_interval_min_us_{static_cast<std::uint64_t>(-1)};
  std::uint64_t controller_interval_max_us_{0};
  std::uint64_t controller_timing_invalid_{0};
  std::uint64_t controller_deadline_misses_{0};
  std::uint64_t mutex_failures_{0};
  std::uint64_t wifi_disconnects_{0};
  std::uint8_t last_wifi_reason_{0};
  std::int8_t last_wifi_rssi_{0};
  std::size_t main_stack_min_{static_cast<std::size_t>(-1)};
  std::size_t workflow_stack_min_{static_cast<std::size_t>(-1)};
  std::atomic<std::uint32_t> allocation_failures_{0};
  std::int64_t prediction_started_us_{0};
  std::int64_t next_log_us_{0};
};

}  // namespace philcoino::diagnostics
