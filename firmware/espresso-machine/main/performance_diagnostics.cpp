#include "performance_diagnostics.hpp"

#include <algorithm>
#include <cinttypes>

#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"

namespace philcoino::diagnostics {
namespace {

constexpr char kLogTag[] = "philcoino-perf";
constexpr std::int64_t kLogIntervalUs = 10'000'000;
constexpr std::uint64_t kControllerDeadlineUs = 1'000'000;

const char* route_name(networking::HttpPerformanceRoute route) {
  using networking::HttpPerformanceRoute;
  switch (route) {
    case HttpPerformanceRoute::kUnknown: return "unknown";
    case HttpPerformanceRoute::kHealth: return "health";
    case HttpPerformanceRoute::kDevice: return "device";
    case HttpPerformanceRoute::kStateV1: return "state_v1";
    case HttpPerformanceRoute::kTemperatures: return "temperatures";
    case HttpPerformanceRoute::kMode: return "mode";
    case HttpPerformanceRoute::kHeater: return "heater";
    case HttpPerformanceRoute::kDismissOverTemperature:
      return "dismiss_over_temperature";
    case HttpPerformanceRoute::kStateV2: return "state_v2";
    case HttpPerformanceRoute::kStateV2Prediction:
      return "state_v2_prediction";
    case HttpPerformanceRoute::kHistory: return "history";
    case HttpPerformanceRoute::kProfilesGet: return "profiles_get";
    case HttpPerformanceRoute::kProfilesPut: return "profiles_put";
    case HttpPerformanceRoute::kExtractionStart:
      return "extraction_start";
    case HttpPerformanceRoute::kExtractionStop: return "extraction_stop";
    case HttpPerformanceRoute::kCooldownStart: return "cooldown_start";
    case HttpPerformanceRoute::kCooldownStop: return "cooldown_stop";
    case HttpPerformanceRoute::kCount: return "count";
  }
  return "unknown";
}

std::size_t reported_minimum(std::size_t value) {
  return value == static_cast<std::size_t>(-1) ? 0 : value;
}

}  // namespace

PerformanceDiagnostics* PerformanceDiagnostics::instance_ = nullptr;

PerformanceDiagnostics::PerformanceDiagnostics() {
  instance_ = this;
  if (heap_caps_register_failed_alloc_callback(failed_allocation) != ESP_OK) {
    ESP_LOGW(kLogTag, "allocation failure callback registration failed");
  }
  next_log_us_ = esp_timer_get_time() + kLogIntervalUs;
  ESP_LOGI(kLogTag,
           "enabled reset_reason=%d free_heap=%u minimum_heap=%u "
           "largest_block=%u",
           static_cast<int>(esp_reset_reason()),
           static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_8BIT)),
           static_cast<unsigned>(
               heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT)),
           static_cast<unsigned>(
               heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)));
}

void PerformanceDiagnostics::record_duration(DurationAggregate& aggregate,
                                             std::uint64_t duration_us) {
  ++aggregate.count;
  aggregate.total_us += duration_us;
  aggregate.maximum_us = std::max(aggregate.maximum_us, duration_us);
}

void PerformanceDiagnostics::failed_allocation(std::size_t, std::uint32_t,
                                               const char*) {
  if (instance_ != nullptr) {
    instance_->allocation_failures_.fetch_add(1, std::memory_order_relaxed);
  }
}

void PerformanceDiagnostics::prediction_update_started() {
  prediction_started_us_ = esp_timer_get_time();
}

void PerformanceDiagnostics::prediction_update_finished() {
  const auto duration_us = static_cast<std::uint64_t>(
      esp_timer_get_time() - prediction_started_us_);
  portENTER_CRITICAL(&lock_);
  record_duration(prediction_, duration_us);
  portEXIT_CRITICAL(&lock_);
}

void PerformanceDiagnostics::record_http_request(
    const networking::HttpRequestPerformanceSample& sample) {
  const auto index = static_cast<std::size_t>(sample.route);
  if (index >= routes_.size()) return;
  portENTER_CRITICAL(&lock_);
  auto& aggregate = routes_[index];
  record_duration(aggregate.request, sample.request_duration_us);
  record_duration(aggregate.api, sample.api_duration_us);
  record_duration(aggregate.send, sample.send_duration_us);
  aggregate.response_bytes += sample.response_bytes;
  if (sample.send_result != 0) ++aggregate.send_failures;
  if (sample.status < 200 || sample.status >= 300) {
    ++aggregate.non_success_responses;
  }
  aggregate.maximum_open_sessions =
      std::max(aggregate.maximum_open_sessions, sample.open_sessions);
  if (sample.heap_minimum_during != 0) {
    aggregate.minimum_heap =
        std::min(aggregate.minimum_heap, sample.heap_minimum_during);
  }
  aggregate.minimum_largest_block = std::min(
      aggregate.minimum_largest_block,
      std::min(sample.largest_free_before, sample.largest_free_after));
  aggregate.minimum_http_stack =
      std::min(aggregate.minimum_http_stack,
               sample.http_stack_high_water_bytes);
  portEXIT_CRITICAL(&lock_);
}

void PerformanceDiagnostics::record_wifi_disconnect(std::uint8_t reason,
                                                    std::int8_t rssi) {
  portENTER_CRITICAL(&lock_);
  ++wifi_disconnects_;
  last_wifi_reason_ = reason;
  last_wifi_rssi_ = rssi;
  portEXIT_CRITICAL(&lock_);
}

void PerformanceDiagnostics::record_controller_update(
    std::uint64_t duration_us, std::uint64_t interval_us, bool timing_invalid,
    std::size_t stack_high_water_bytes) {
  portENTER_CRITICAL(&lock_);
  record_duration(controller_, duration_us);
  if (interval_us != 0) {
    controller_interval_min_us_ =
        std::min(controller_interval_min_us_, interval_us);
    controller_interval_max_us_ =
        std::max(controller_interval_max_us_, interval_us);
    if (interval_us > kControllerDeadlineUs) ++controller_deadline_misses_;
  }
  if (timing_invalid) ++controller_timing_invalid_;
  main_stack_min_ = std::min(main_stack_min_, stack_high_water_bytes);
  portEXIT_CRITICAL(&lock_);
}

void PerformanceDiagnostics::record_mutex_wait(std::uint64_t duration_us,
                                               bool acquired) {
  portENTER_CRITICAL(&lock_);
  record_duration(mutex_wait_, duration_us);
  if (!acquired) ++mutex_failures_;
  portEXIT_CRITICAL(&lock_);
}

void PerformanceDiagnostics::record_mutex_hold(std::uint64_t duration_us) {
  portENTER_CRITICAL(&lock_);
  record_duration(mutex_hold_, duration_us);
  portEXIT_CRITICAL(&lock_);
}

void PerformanceDiagnostics::record_workflow_stack(
    std::size_t stack_high_water_bytes) {
  portENTER_CRITICAL(&lock_);
  workflow_stack_min_ =
      std::min(workflow_stack_min_, stack_high_water_bytes);
  portEXIT_CRITICAL(&lock_);
}

void PerformanceDiagnostics::maybe_log() {
  const auto now_us = esp_timer_get_time();
  if (now_us < next_log_us_) return;
  next_log_us_ = now_us + kLogIntervalUs;

  portENTER_CRITICAL(&lock_);
  const auto routes = routes_;
  const auto prediction = prediction_;
  const auto controller = controller_;
  const auto mutex_wait = mutex_wait_;
  const auto mutex_hold = mutex_hold_;
  const auto interval_min = controller_interval_min_us_;
  const auto interval_max = controller_interval_max_us_;
  const auto timing_invalid = controller_timing_invalid_;
  const auto deadline_misses = controller_deadline_misses_;
  const auto mutex_failures = mutex_failures_;
  const auto wifi_disconnects = wifi_disconnects_;
  const auto wifi_reason = last_wifi_reason_;
  const auto wifi_rssi = last_wifi_rssi_;
  const auto main_stack = main_stack_min_;
  const auto workflow_stack = workflow_stack_min_;
  portEXIT_CRITICAL(&lock_);
  const auto average_us = [](const auto& aggregate) {
    return aggregate.count == 0 ? 0 : aggregate.total_us / aggregate.count;
  };
  wifi_ap_record_t access_point{};
  const bool wifi_connected =
      esp_wifi_sta_get_ap_info(&access_point) == ESP_OK;

  ESP_LOGI(kLogTag,
           "runtime free_heap=%u minimum_heap=%u largest_block=%u "
           "alloc_failures=%" PRIu64 " main_stack_min=%u "
           "workflow_stack_min=%u wifi_disconnects=%" PRIu64
           " wifi_reason=%u wifi_rssi_last=%d wifi_connected=%u "
           "wifi_rssi_current=%d",
           static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_8BIT)),
           static_cast<unsigned>(
               heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT)),
           static_cast<unsigned>(
               heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)),
           static_cast<std::uint64_t>(
               allocation_failures_.load(std::memory_order_relaxed)),
           static_cast<unsigned>(reported_minimum(main_stack)),
           static_cast<unsigned>(reported_minimum(workflow_stack)),
           wifi_disconnects, static_cast<unsigned>(wifi_reason),
           static_cast<int>(wifi_rssi), wifi_connected ? 1U : 0U,
           wifi_connected ? static_cast<int>(access_point.rssi) : 0);
  ESP_LOGI(kLogTag,
           "control updates=%" PRIu64 " avg_us=%" PRIu64
           " max_us=%" PRIu64 " interval_min_us=%" PRIu64
           " interval_max_us=%" PRIu64 " deadline_misses=%" PRIu64
           " timing_invalid=%" PRIu64 " prediction_updates=%" PRIu64
           " prediction_avg_us=%" PRIu64 " prediction_max_us=%" PRIu64,
           controller.count, average_us(controller), controller.maximum_us,
           interval_min == static_cast<std::uint64_t>(-1) ? 0 : interval_min,
           interval_max, deadline_misses, timing_invalid, prediction.count,
           average_us(prediction), prediction.maximum_us);
  ESP_LOGI(kLogTag,
           "mutex waits=%" PRIu64 " wait_avg_us=%" PRIu64
           " wait_max_us=%" PRIu64 " failures=%" PRIu64
           " holds=%" PRIu64 " hold_avg_us=%" PRIu64
           " hold_max_us=%" PRIu64,
           mutex_wait.count, average_us(mutex_wait), mutex_wait.maximum_us,
           mutex_failures, mutex_hold.count, average_us(mutex_hold),
           mutex_hold.maximum_us);

  for (std::size_t index = 0; index < routes.size(); ++index) {
    const auto& route = routes[index];
    if (route.request.count == 0) continue;
    ESP_LOGI(kLogTag,
             "http route=%s count=%" PRIu64 " bytes=%" PRIu64
             " request_avg_us=%" PRIu64 " request_max_us=%" PRIu64
             " api_avg_us=%" PRIu64 " api_max_us=%" PRIu64
             " send_avg_us=%" PRIu64 " send_max_us=%" PRIu64
             " send_failures=%" PRIu64 " non_2xx=%" PRIu64
             " sessions_max=%u heap_min=%u largest_min=%u stack_min=%u",
             route_name(static_cast<networking::HttpPerformanceRoute>(index)),
             route.request.count, route.response_bytes,
             average_us(route.request), route.request.maximum_us,
             average_us(route.api), route.api.maximum_us,
             average_us(route.send), route.send.maximum_us,
             route.send_failures, route.non_success_responses,
             static_cast<unsigned>(route.maximum_open_sessions),
             static_cast<unsigned>(reported_minimum(route.minimum_heap)),
             static_cast<unsigned>(
                 reported_minimum(route.minimum_largest_block)),
             static_cast<unsigned>(
                 reported_minimum(route.minimum_http_stack)));
  }
}

}  // namespace philcoino::diagnostics
