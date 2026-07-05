#pragma once

#include <string>

#include "philcoino/api.hpp"

namespace philcoino::networking {

class EspNetworkServer {
 public:
  EspNetworkServer(FirmwareApi& api, void* api_mutex,
                   const DeviceIdentity& identity);

 bool start(const char* ssid, const char* password);

 private:
  bool start_wifi(const char* ssid, const char* password);
  bool start_mdns();
  bool start_http();
  void handle_wifi_event(const char* event_base, std::int32_t event_id);
  int handle_http_request(void* request);

  FirmwareApi& api_;
  void* api_mutex_;
  DeviceIdentity identity_;
  void* event_group_{nullptr};
  void* http_server_{nullptr};
  void* wifi_event_handler_{nullptr};
  void* ip_event_handler_{nullptr};
  int wifi_retries_{0};
};

}  // namespace philcoino::networking
