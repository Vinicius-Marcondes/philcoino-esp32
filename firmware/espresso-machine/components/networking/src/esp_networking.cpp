#include "philcoino/esp_networking.hpp"

#include <array>
#include <cstddef>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

#include "esp_event.h"
#include "esp_err.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "esp_wifi_default.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "mdns.h"
#include "philcoino/config.hpp"

namespace philcoino::networking {
namespace {

constexpr char kLogTag[] = "philcoino-net";
constexpr EventBits_t kConnectedBit = BIT0;
constexpr EventBits_t kConnectionFailedBit = BIT1;
constexpr std::size_t kMaximumAuthorizationLength = 512;
constexpr std::size_t kMaximumRequestBodyLength = 256;

std::uint64_t uptime_ms() {
  return static_cast<std::uint64_t>(esp_timer_get_time() / 1000);
}

const char* status_text(int status) {
  switch (status) {
    case 200: return "200 OK";
    case 400: return "400 Bad Request";
    case 401: return "401 Unauthorized";
    case 404: return "404 Not Found";
    case 409: return "409 Conflict";
    default: return "500 Internal Server Error";
  }
}

HttpMethod request_method(int method) {
  switch (method) {
    case HTTP_PATCH: return HttpMethod::kPatch;
    case HTTP_POST: return HttpMethod::kPost;
    case HTTP_PUT: return HttpMethod::kPut;
    default: return HttpMethod::kGet;
  }
}

}  // namespace

EspNetworkServer::EspNetworkServer(FirmwareApi& api, void* api_mutex,
                                   const DeviceIdentity& identity)
    : api_(api), api_mutex_(api_mutex), identity_(identity) {}

bool EspNetworkServer::start(const char* ssid, const char* password) {
  if (!start_wifi(ssid, password) || !start_http()) {
    return false;
  }
  if (!start_mdns()) {
    httpd_stop(static_cast<httpd_handle_t>(http_server_));
    http_server_ = nullptr;
    return false;
  }
  ESP_LOGI(kLogTag, "HTTP and mDNS services started");
  return true;
}

WifiStatus EspNetworkServer::wifi_status() const {
  return wifi_status_.load(std::memory_order_relaxed);
}

bool EspNetworkServer::start_wifi(const char* ssid, const char* password) {
  wifi_config_t configuration{};
  if (ssid == nullptr || password == nullptr || ssid[0] == '\0' ||
      std::strlen(ssid) >= sizeof(configuration.sta.ssid) ||
      std::strlen(password) >= sizeof(configuration.sta.password)) {
    ESP_LOGE(kLogTag, "Wi-Fi configuration is missing or too long");
    wifi_status_.store(WifiStatus::kFailed, std::memory_order_relaxed);
    return false;
  }
  wifi_status_.store(WifiStatus::kConnecting, std::memory_order_relaxed);
  if (esp_netif_init() != ESP_OK) {
    wifi_status_.store(WifiStatus::kFailed, std::memory_order_relaxed);
    return false;
  }
  const auto event_loop_result = esp_event_loop_create_default();
  if (event_loop_result != ESP_OK && event_loop_result != ESP_ERR_INVALID_STATE) {
    wifi_status_.store(WifiStatus::kFailed, std::memory_order_relaxed);
    return false;
  }
  if (esp_netif_create_default_wifi_sta() == nullptr) {
    wifi_status_.store(WifiStatus::kFailed, std::memory_order_relaxed);
    return false;
  }

  wifi_init_config_t initialization = WIFI_INIT_CONFIG_DEFAULT();
  if (esp_wifi_init(&initialization) != ESP_OK) {
    wifi_status_.store(WifiStatus::kFailed, std::memory_order_relaxed);
    return false;
  }

  event_group_ = xEventGroupCreate();
  if (event_group_ == nullptr) {
    wifi_status_.store(WifiStatus::kFailed, std::memory_order_relaxed);
    return false;
  }

  auto handler = [](void* argument, esp_event_base_t event_base,
                    std::int32_t event_id, void* event_data) {
    static_cast<EspNetworkServer*>(argument)->handle_wifi_event(event_base,
                                                                event_id,
                                                                event_data);
  };
  esp_event_handler_instance_t wifi_instance = nullptr;
  esp_event_handler_instance_t ip_instance = nullptr;
  if (esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, handler,
                                          this, &wifi_instance) != ESP_OK ||
      esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, handler,
                                          this, &ip_instance) != ESP_OK) {
    wifi_status_.store(WifiStatus::kFailed, std::memory_order_relaxed);
    return false;
  }
  wifi_event_handler_ = wifi_instance;
  ip_event_handler_ = ip_instance;

  std::memcpy(configuration.sta.ssid, ssid, std::strlen(ssid) + 1);
  std::memcpy(configuration.sta.password, password,
              std::strlen(password) + 1);
  if (esp_wifi_set_mode(WIFI_MODE_STA) != ESP_OK ||
      esp_wifi_set_config(WIFI_IF_STA, &configuration) != ESP_OK ||
      esp_wifi_start() != ESP_OK) {
    wifi_status_.store(WifiStatus::kFailed, std::memory_order_relaxed);
    return false;
  }
  const esp_err_t tx_power_result =
      esp_wifi_set_max_tx_power(config::kWifiMaximumTxPowerQuarterDbm);
  if (tx_power_result == ESP_OK) {
    ESP_LOGI(kLogTag, "Wi-Fi TX power limited: quarter-dBm=%d",
             static_cast<int>(config::kWifiMaximumTxPowerQuarterDbm));
  } else {
    ESP_LOGW(kLogTag,
             "Wi-Fi TX power limit rejected: quarter-dBm=%d err=%s; using "
             "default",
             static_cast<int>(config::kWifiMaximumTxPowerQuarterDbm),
             esp_err_to_name(tx_power_result));
  }

  const EventBits_t bits = xEventGroupWaitBits(
      static_cast<EventGroupHandle_t>(event_group_),
      kConnectedBit | kConnectionFailedBit, pdFALSE, pdFALSE, portMAX_DELAY);
  if ((bits & kConnectedBit) == 0) {
    ESP_LOGE(kLogTag, "Wi-Fi station connection failed");
    wifi_status_.store(WifiStatus::kFailed, std::memory_order_relaxed);
    return false;
  }
  ESP_LOGI(kLogTag, "Wi-Fi station connected");
  return true;
}

void EspNetworkServer::handle_wifi_event(const char* event_base,
                                         std::int32_t event_id,
                                         void* event_data) {
  if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
    wifi_status_.store(WifiStatus::kConnecting, std::memory_order_relaxed);
    if (esp_wifi_connect() != ESP_OK) {
      wifi_status_.store(WifiStatus::kFailed, std::memory_order_relaxed);
      xEventGroupSetBits(static_cast<EventGroupHandle_t>(event_group_),
                         kConnectionFailedBit);
    }
    return;
  }
  if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
    wifi_status_.store(WifiStatus::kRetrying, std::memory_order_relaxed);
    xEventGroupClearBits(static_cast<EventGroupHandle_t>(event_group_),
                         kConnectedBit);
    const auto* disconnected =
        static_cast<const wifi_event_sta_disconnected_t*>(event_data);
    if (disconnected != nullptr) {
      ESP_LOGW(kLogTag, "Wi-Fi disconnected: reason=%u rssi=%d; retrying",
               static_cast<unsigned>(disconnected->reason),
               static_cast<int>(disconnected->rssi));
    }
    if (esp_wifi_connect() != ESP_OK) {
      wifi_status_.store(WifiStatus::kFailed, std::memory_order_relaxed);
      xEventGroupSetBits(static_cast<EventGroupHandle_t>(event_group_),
                         kConnectionFailedBit);
    }
    return;
  }
  if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
    wifi_status_.store(WifiStatus::kConnected, std::memory_order_relaxed);
    xEventGroupClearBits(static_cast<EventGroupHandle_t>(event_group_),
                         kConnectionFailedBit);
    xEventGroupSetBits(static_cast<EventGroupHandle_t>(event_group_),
                       kConnectedBit);
  }
}

bool EspNetworkServer::start_mdns() {
  if (mdns_init() != ESP_OK ||
      mdns_hostname_set(identity_.device_id.c_str()) != ESP_OK ||
      mdns_instance_name_set(identity_.name.c_str()) != ESP_OK) {
    return false;
  }

  const auto txt = discovery_txt(identity_);
  std::array<mdns_txt_item_t, 5> metadata{};
  for (std::size_t index = 0; index < txt.size(); ++index) {
    metadata[index] = {txt[index].key.c_str(), txt[index].value.c_str()};
  }
  if (mdns_service_add(identity_.name.c_str(), kMdnsServiceType,
                       kMdnsProtocol, kHttpPort, metadata.data(),
                       metadata.size()) != ESP_OK) {
    mdns_free();
    return false;
  }
  return true;
}

bool EspNetworkServer::start_http() {
  httpd_config_t configuration = HTTPD_DEFAULT_CONFIG();
  configuration.server_port = kHttpPort;
  configuration.stack_size = 6144;
  httpd_handle_t server = nullptr;
  if (httpd_start(&server, &configuration) != ESP_OK) {
    return false;
  }
  http_server_ = server;

  auto handler = [](httpd_req_t* request) -> esp_err_t {
    return static_cast<esp_err_t>(
        static_cast<EspNetworkServer*>(request->user_ctx)
            ->handle_http_request(request));
  };
  const std::array<std::pair<const char*, httpd_method_t>, 6> routes{{
      {"/healthz", HTTP_GET},
      {"/api/v1/device", HTTP_GET},
      {"/api/v1/state", HTTP_GET},
      {"/api/v1/settings/temperatures", HTTP_PATCH},
      {"/api/v1/mode", HTTP_PUT},
      {"/api/v1/faults/over-temperature/dismiss", HTTP_POST},
  }};
  for (const auto& route : routes) {
    httpd_uri_t uri{};
    uri.uri = route.first;
    uri.method = route.second;
    uri.handler = handler;
    uri.user_ctx = this;
    if (httpd_register_uri_handler(server, &uri) != ESP_OK) {
      httpd_stop(server);
      http_server_ = nullptr;
      return false;
    }
  }
  return true;
}

int EspNetworkServer::handle_http_request(void* opaque_request) {
  auto* request = static_cast<httpd_req_t*>(opaque_request);
  std::string authorization;
  const std::size_t header_length =
      httpd_req_get_hdr_value_len(request, "Authorization");
  if (header_length > 0 && header_length <= kMaximumAuthorizationLength) {
    std::vector<char> header(header_length + 1, '\0');
    if (httpd_req_get_hdr_value_str(request, "Authorization", header.data(),
                                    header.size()) == ESP_OK) {
      authorization.assign(header.data(), header_length);
    }
  }

  std::string body;
  if (request->content_len > 0 &&
      static_cast<std::size_t>(request->content_len) <=
          kMaximumRequestBodyLength) {
    body.resize(static_cast<std::size_t>(request->content_len));
    std::size_t received = 0;
    while (received < body.size()) {
      const int result = httpd_req_recv(request, body.data() + received,
                                        body.size() - received);
      if (result == HTTPD_SOCK_ERR_TIMEOUT) {
        continue;
      }
      if (result <= 0) {
        return ESP_FAIL;
      }
      received += static_cast<std::size_t>(result);
    }
  } else if (request->content_len > 0) {
    body = "invalid";
  }

  const auto mutex = static_cast<SemaphoreHandle_t>(api_mutex_);
  if (mutex == nullptr || xSemaphoreTake(mutex, portMAX_DELAY) != pdTRUE) {
    return ESP_FAIL;
  }
  const HttpResponse response = api_.handle(
      request_method(request->method), request->uri,
      authorization.empty() ? nullptr : authorization.c_str(), body,
      uptime_ms());
  xSemaphoreGive(mutex);

  httpd_resp_set_status(request, status_text(response.status));
  httpd_resp_set_type(request, "application/json");
  if (response.bearer_challenge) {
    httpd_resp_set_hdr(request, "WWW-Authenticate",
                       "Bearer realm=\"philcoino\"");
  }
  return httpd_resp_send(request, response.body.c_str(), response.body.size());
}

}  // namespace philcoino::networking
