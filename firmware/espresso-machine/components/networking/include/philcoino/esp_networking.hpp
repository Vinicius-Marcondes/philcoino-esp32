#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>

#include "philcoino/api.hpp"

namespace philcoino::networking {

enum class WifiStatus { kOff, kConnecting, kConnected, kRetrying, kFailed };

enum class HttpPerformanceRoute : std::uint8_t {
  kUnknown,
  kHealth,
  kDevice,
  kStateV1,
  kTemperatures,
  kMode,
  kHeater,
  kDismissOverTemperature,
  kStateV2,
  kStateV2Prediction,
  kHistory,
  kProfilesGet,
  kProfilesPut,
  kExtractionStart,
  kExtractionStop,
  kCooldownStart,
  kCooldownStop,
  kCount,
};

struct HttpRequestPerformanceSample {
  HttpPerformanceRoute route{HttpPerformanceRoute::kUnknown};
  int status{0};
  std::size_t response_bytes{0};
  std::uint64_t request_duration_us{0};
  std::uint64_t api_duration_us{0};
  std::uint64_t send_duration_us{0};
  std::size_t heap_free_before{0};
  std::size_t heap_minimum_during{0};
  std::size_t heap_free_after{0};
  std::size_t largest_free_before{0};
  std::size_t largest_free_after{0};
  std::size_t http_stack_high_water_bytes{0};
  std::size_t open_sessions{0};
  int send_result{-1};
};

class NetworkPerformanceObserver {
 public:
  virtual ~NetworkPerformanceObserver() = default;
  virtual void record_http_request(
      const HttpRequestPerformanceSample& sample) = 0;
  virtual void record_wifi_disconnect(std::uint8_t reason,
                                      std::int8_t rssi) = 0;
};

class EspNetworkServer {
 public:
  EspNetworkServer(FirmwareApi& api, const DeviceIdentity& identity,
                   NetworkPerformanceObserver* performance_observer = nullptr);

  bool start(const char* ssid, const char* password);
  WifiStatus wifi_status() const;

 private:
  bool start_wifi(const char* ssid, const char* password);
  bool start_mdns();
  void start_mdns_retry();
  static void mdns_retry_task(void* context);
  bool start_http();
  void handle_wifi_event(const char* event_base, std::int32_t event_id,
                         void* event_data);
  int handle_http_request(void* request);

  FirmwareApi& api_;
  DeviceIdentity identity_;
  NetworkPerformanceObserver* performance_observer_{nullptr};
  void* event_group_{nullptr};
  void* http_server_{nullptr};
  void* wifi_event_handler_{nullptr};
  void* ip_event_handler_{nullptr};
  std::atomic<WifiStatus> wifi_status_{WifiStatus::kOff};
  std::atomic<bool> mdns_started_{false};
  std::atomic<bool> mdns_starting_{false};
  std::atomic<bool> mdns_retry_running_{false};
};

}  // namespace philcoino::networking
