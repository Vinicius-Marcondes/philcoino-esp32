#pragma once

#include <array>
#include <atomic>
#include <cstdint>
#include <string>

#include "philcoino/api.hpp"
#include "philcoino/esp_security.hpp"
#include "philcoino/firmware_update.hpp"

namespace philcoino::networking {

class ExtractionTelemetryBuffer;

enum class WifiStatus {
  kOff,
  kConnecting,
  kAssociated,
  kConnected,
  kRetrying,
  kFailed,
};

class EspNetworkServer {
 public:
  EspNetworkServer(FirmwareApi& api, const DeviceIdentity& identity,
                   EspTlsIdentity& tls_identity,
                   ExtractionTelemetryBuffer* extraction_telemetry,
                   FirmwareUpdateCoordinator* firmware_update);

  bool start(const char* ssid, const char* password);
  WifiStatus wifi_status() const;

 private:
  bool start_wifi(const char* ssid, const char* password);
  void schedule_wifi_reconnect();
  static void wifi_reconnect_task(void* context);
  bool start_mdns();
  void start_mdns_retry();
  static void mdns_retry_task(void* context);
  bool start_http();
  void handle_wifi_event(const char* event_base, std::int32_t event_id,
                         void* event_data);
  int handle_http_request(void* request);
  int handle_extraction_stream(void* request);
  int handle_firmware_update(void* request);
  void run_extraction_stream();
  static void extraction_stream_task(void* context);
  static void notify_extraction_stream(void* context);
  static void firmware_reboot_task(void* context);

  FirmwareApi& api_;
  DeviceIdentity identity_;
  EspTlsIdentity& tls_identity_;
  ExtractionTelemetryBuffer* extraction_telemetry_;
  FirmwareUpdateCoordinator* firmware_update_;
  void* event_group_{nullptr};
  void* http_server_{nullptr};
  void* wifi_event_handler_{nullptr};
  void* ip_event_handler_{nullptr};
  std::atomic<WifiStatus> wifi_status_{WifiStatus::kOff};
  std::atomic<bool> wifi_started_{false};
  std::atomic<bool> wifi_reconnect_running_{false};
  std::atomic<bool> mdns_started_{false};
  std::atomic<bool> mdns_starting_{false};
  std::atomic<bool> mdns_retry_running_{false};
  std::atomic<bool> extraction_stream_active_{false};
  void* extraction_stream_request_{nullptr};
  std::atomic<void*> extraction_stream_task_handle_{nullptr};
  std::array<char, 33> extraction_stream_boot_id_{};
  std::array<char, 65> extraction_stream_extraction_id_{};
  std::uint64_t extraction_stream_after_sequence_{0};
  bool extraction_stream_cursor_supplied_{false};
};

}  // namespace philcoino::networking
