#pragma once

#include <atomic>
#include <string>

#include "philcoino/api.hpp"

namespace philcoino::networking {

enum class WifiStatus { kOff, kConnecting, kConnected, kRetrying, kFailed };

class EspNetworkServer {
 public:
  EspNetworkServer(FirmwareApi& api, const DeviceIdentity& identity);

  bool start(const char* ssid, const char* password);
  WifiStatus wifi_status() const;

 private:
  bool start_wifi(const char* ssid, const char* password);
  bool start_mdns();
  bool start_http();
  void handle_wifi_event(const char* event_base, std::int32_t event_id,
                         void* event_data);
  int handle_http_request(void* request);

  FirmwareApi& api_;
  DeviceIdentity identity_;
  void* event_group_{nullptr};
  void* http_server_{nullptr};
  void* wifi_event_handler_{nullptr};
  void* ip_event_handler_{nullptr};
  std::atomic<WifiStatus> wifi_status_{WifiStatus::kOff};
};

}  // namespace philcoino::networking
