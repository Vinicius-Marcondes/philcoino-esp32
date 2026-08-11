#include "philcoino/esp_networking.hpp"

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstring>
#include <memory>
#include <string>
#include <utility>

#include "esp_event.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_https_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "esp_wifi_default.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "mdns.h"
#include "sdkconfig.h"
#include "philcoino/api_routes.hpp"
#include "philcoino/config.hpp"
#include "philcoino/extraction_telemetry.hpp"

namespace philcoino::networking {
namespace {

constexpr char kLogTag[] = "philcoino-net";
constexpr EventBits_t kConnectedBit = BIT0;
constexpr EventBits_t kConnectionFailedBit = BIT1;
constexpr std::size_t kMaximumAuthorizationLength = 512;
constexpr std::size_t kMaximumRequestBodyLength = 1024;
constexpr std::int64_t kRequestBodyDeadlineUs = 2'000'000;
constexpr unsigned kMaximumBodyTimeouts = 3;
constexpr std::size_t kFirmwareUploadChunkBytes = 4096;
constexpr std::size_t kSha256HexLength = 64;
constexpr std::int64_t kFirmwareUploadDeadlineUs = 180'000'000;
constexpr unsigned kMaximumFirmwareUploadTimeouts = 180;
constexpr std::uint32_t kMaximumWifiRetryDelayMs = 30'000;
constexpr std::uint32_t kMaximumMdnsRetryDelayMs = 30'000;
constexpr std::uint32_t kDhcpAcquisitionTimeoutMs = 30'000;
constexpr std::uint32_t kAssociationPollIntervalMs = 250;

std::uint64_t uptime_ms() {
  return static_cast<std::uint64_t>(esp_timer_get_time() / 1000);
}

const char* status_text(int status) {
  switch (status) {
    case 200: return "200 OK";
    case 202: return "202 Accepted";
    case 400: return "400 Bad Request";
    case 401: return "401 Unauthorized";
    case 404: return "404 Not Found";
    case 409: return "409 Conflict";
    case 413: return "413 Payload Too Large";
    case 415: return "415 Unsupported Media Type";
    case 422: return "422 Unprocessable Content";
    case 429: return "429 Too Many Requests";
    case 503: return "503 Service Unavailable";
    default: return "500 Internal Server Error";
  }
}

esp_err_t send_http_response(httpd_req_t* request,
                             const HttpResponse& response,
                             const std::string& path) {
  httpd_resp_set_status(request, status_text(response.status));
  httpd_resp_set_type(request, "application/json");
  if (response.bearer_challenge) {
    httpd_resp_set_hdr(request, "WWW-Authenticate",
                       "Bearer realm=\"philcoino\"");
  }
  const auto result = httpd_resp_send(request, response.body.c_str(),
                                      response.body.size());
  if (result != ESP_OK) {
    ESP_LOGE(kLogTag,
             "HTTP response send failed path=%s bytes=%u error=%s",
             path.c_str(), static_cast<unsigned>(response.body.size()),
             esp_err_to_name(result));
  }
  return result;
}

HttpMethod request_method(int method) {
  switch (method) {
    case HTTP_DELETE: return HttpMethod::kDelete;
    case HTTP_PATCH: return HttpMethod::kPatch;
    case HTTP_POST: return HttpMethod::kPost;
    case HTTP_PUT: return HttpMethod::kPut;
    default: return HttpMethod::kGet;
  }
}

httpd_method_t http_method(HttpMethod method) {
  switch (method) {
    case HttpMethod::kDelete: return HTTP_DELETE;
    case HttpMethod::kPatch: return HTTP_PATCH;
    case HttpMethod::kPost: return HTTP_POST;
    case HttpMethod::kPut: return HTTP_PUT;
    case HttpMethod::kGet: return HTTP_GET;
  }
  return HTTP_GET;
}

class AtomicFlagReset final {
 public:
  explicit AtomicFlagReset(std::atomic<bool>& flag) : flag_(flag) {}
  ~AtomicFlagReset() { flag_.store(false, std::memory_order_release); }

 private:
  std::atomic<bool>& flag_;
};

}  // namespace

EspNetworkServer::EspNetworkServer(FirmwareApi& api,
                                   const DeviceIdentity& identity,
                                   EspTlsIdentity& tls_identity,
                                   ExtractionTelemetryBuffer*
                                       extraction_telemetry,
                                   FirmwareUpdateCoordinator* firmware_update)
    : api_(api),
      identity_(identity),
      tls_identity_(tls_identity),
      extraction_telemetry_(extraction_telemetry),
      firmware_update_(firmware_update) {
  if (extraction_telemetry_ != nullptr) {
    extraction_telemetry_->set_notification(notify_extraction_stream, this);
  }
}

bool EspNetworkServer::start(const char* ssid, const char* password) {
  if (!start_wifi(ssid, password) || !start_http()) {
    return false;
  }
  start_mdns_retry();
  ESP_LOGI(kLogTag,
           "HTTPS server started; mDNS will advertise after an IP address is acquired");
  return true;
}

WifiStatus EspNetworkServer::wifi_status() const {
  return wifi_status_.load(std::memory_order_relaxed);
}

bool EspNetworkServer::start_wifi(const char* ssid, const char* password) {
  if (wifi_started_.load(std::memory_order_acquire)) return true;
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
  wifi_started_.store(true, std::memory_order_release);
  ESP_LOGI(kLogTag,
           "Wi-Fi station association started; background recovery remains active");
  return true;
}

void EspNetworkServer::handle_wifi_event(const char* event_base,
                                         std::int32_t event_id,
                                         void* event_data) {
  if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
    wifi_status_.store(WifiStatus::kConnecting, std::memory_order_relaxed);
    schedule_wifi_reconnect();
    return;
  }
  if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_CONNECTED) {
    wifi_status_.store(WifiStatus::kAssociated, std::memory_order_relaxed);
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
    schedule_wifi_reconnect();
    return;
  }
  if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
    wifi_status_.store(WifiStatus::kConnected, std::memory_order_relaxed);
    xEventGroupClearBits(static_cast<EventGroupHandle_t>(event_group_),
                         kConnectionFailedBit);
    xEventGroupSetBits(static_cast<EventGroupHandle_t>(event_group_),
                       kConnectedBit);
    const auto* got_ip = static_cast<const ip_event_got_ip_t*>(event_data);
    if (got_ip != nullptr) {
      ESP_LOGI(kLogTag, "Wi-Fi acquired IPv4 address: " IPSTR,
               IP2STR(&got_ip->ip_info.ip));
    }
    if (!mdns_started_.load(std::memory_order_acquire)) {
      start_mdns_retry();
    }
  }
}

void EspNetworkServer::schedule_wifi_reconnect() {
  bool expected = false;
  if (!wifi_reconnect_running_.compare_exchange_strong(
          expected, true, std::memory_order_acq_rel)) {
    return;
  }
  if (xTaskCreate(wifi_reconnect_task, "philcoino-wifi", 3072, this, 4,
                  nullptr) != pdPASS) {
    wifi_reconnect_running_.store(false, std::memory_order_release);
    wifi_status_.store(WifiStatus::kFailed, std::memory_order_relaxed);
    xEventGroupSetBits(static_cast<EventGroupHandle_t>(event_group_),
                       kConnectionFailedBit);
    ESP_LOGE(kLogTag, "Could not start bounded Wi-Fi recovery task");
  }
}

void EspNetworkServer::wifi_reconnect_task(void* context) {
  auto* server = static_cast<EspNetworkServer*>(context);
  std::uint32_t delay_ms = 1'000;
  std::uint32_t associated_ms = 0;
  while (server->wifi_status() != WifiStatus::kConnected) {
    if (server->wifi_status() == WifiStatus::kAssociated) {
      vTaskDelay(pdMS_TO_TICKS(kAssociationPollIntervalMs));
      associated_ms += kAssociationPollIntervalMs;
      if (associated_ms < kDhcpAcquisitionTimeoutMs) {
        continue;
      }

      ESP_LOGW(kLogTag,
               "Wi-Fi association did not acquire an IP address within %u ms; restarting association",
               static_cast<unsigned>(kDhcpAcquisitionTimeoutMs));
      associated_ms = 0;
      const auto disconnect_result = esp_wifi_disconnect();
      if (disconnect_result != ESP_OK &&
          disconnect_result != ESP_ERR_WIFI_NOT_CONNECT) {
        ESP_LOGW(kLogTag, "Wi-Fi disconnect before retry failed: %s",
                 esp_err_to_name(disconnect_result));
      }
      continue;
    }

    associated_ms = 0;
    const auto result = esp_wifi_connect();
    if (result != ESP_OK) {
      ESP_LOGW(kLogTag, "Wi-Fi association attempt failed: %s",
               esp_err_to_name(result));
    }
    vTaskDelay(pdMS_TO_TICKS(delay_ms));
    delay_ms = std::min(delay_ms * 2U, kMaximumWifiRetryDelayMs);
  }
  server->wifi_reconnect_running_.store(false, std::memory_order_release);
  // Close the event/task-exit race: a disconnect that happened while this
  // task was winding down must always schedule another supervisor instance.
  if (server->wifi_status() != WifiStatus::kConnected) {
    server->schedule_wifi_reconnect();
  }
  vTaskDelete(nullptr);
}

bool EspNetworkServer::start_mdns() {
  if (mdns_started_.load(std::memory_order_acquire)) {
    return true;
  }
  bool expected = false;
  if (!mdns_starting_.compare_exchange_strong(
          expected, true, std::memory_order_acq_rel)) {
    return mdns_started_.load(std::memory_order_acquire);
  }
  AtomicFlagReset starting_reset(mdns_starting_);
  if (mdns_init() != ESP_OK) {
    return false;
  }
  if (mdns_hostname_set(identity_.device_id.c_str()) != ESP_OK ||
      mdns_instance_name_set(identity_.name.c_str()) != ESP_OK) {
    mdns_free();
    return false;
  }

  const auto txt = discovery_txt(identity_);
  std::array<mdns_txt_item_t, 5> metadata{};
  for (std::size_t index = 0; index < txt.size(); ++index) {
    metadata[index] = {txt[index].key.c_str(), txt[index].value.c_str()};
  }
  if (mdns_service_add(identity_.name.c_str(), kMdnsServiceType,
                       kMdnsProtocol, kHttpsPort, metadata.data(),
                       metadata.size()) != ESP_OK) {
    mdns_free();
    return false;
  }
  mdns_started_.store(true, std::memory_order_release);
  return true;
}

void EspNetworkServer::start_mdns_retry() {
  bool expected = false;
  if (!mdns_retry_running_.compare_exchange_strong(
          expected, true, std::memory_order_acq_rel)) {
    return;
  }
  if (xTaskCreate(mdns_retry_task, "philcoino-mdns", 3072, this, 3, nullptr) !=
      pdPASS) {
    mdns_retry_running_.store(false, std::memory_order_release);
    ESP_LOGE(kLogTag, "Could not start bounded mDNS recovery task");
  }
}

void EspNetworkServer::mdns_retry_task(void* context) {
  auto* server = static_cast<EspNetworkServer*>(context);
  std::uint32_t delay_ms = 1000;
  while (!server->mdns_started_.load(std::memory_order_acquire)) {
    vTaskDelay(pdMS_TO_TICKS(delay_ms));
    if (server->wifi_status() == WifiStatus::kConnected &&
        server->start_mdns()) {
      ESP_LOGI(kLogTag,
               "mDNS advertising _philcoino._tcp on HTTPS port %u",
               static_cast<unsigned>(kHttpsPort));
      break;
    }
    delay_ms = std::min(delay_ms * 2U, kMaximumMdnsRetryDelayMs);
  }
  server->mdns_retry_running_.store(false, std::memory_order_release);
  vTaskDelete(nullptr);
}

bool EspNetworkServer::start_http() {
  if (http_server_ != nullptr) {
    return true;
  }
  httpd_ssl_config_t configuration = HTTPD_SSL_CONFIG_DEFAULT();
  configuration.httpd.stack_size = 8192;
  configuration.httpd.max_uri_handlers =
      static_cast<std::uint16_t>(kApiRoutes.size() + 1U);
  configuration.httpd.uri_match_fn = httpd_uri_match_wildcard;
  configuration.httpd.lru_purge_enable = true;
  configuration.httpd.recv_wait_timeout = 1;
  configuration.httpd.send_wait_timeout = 2;
  configuration.port_secure = kHttpsPort;
  configuration.transport_mode = HTTPD_SSL_TRANSPORT_SECURE;
  configuration.servercert = tls_identity_.certificate();
  configuration.servercert_len = tls_identity_.certificate_length();
  configuration.prvtkey_pem = tls_identity_.private_key();
  configuration.prvtkey_len = tls_identity_.private_key_length();
  configuration.tls_handshake_timeout_ms = 10'000;
  httpd_handle_t server = nullptr;
  if (httpd_ssl_start(&server, &configuration) != ESP_OK) {
    return false;
  }
  http_server_ = server;

  auto stream_handler = [](httpd_req_t* request) -> esp_err_t {
    return static_cast<esp_err_t>(
        static_cast<EspNetworkServer*>(request->user_ctx)
            ->handle_extraction_stream(request));
  };
  httpd_uri_t stream_uri{};
  stream_uri.uri = "/api/v3/extractions/current/stream";
  stream_uri.method = HTTP_GET;
  stream_uri.handler = stream_handler;
  stream_uri.user_ctx = this;
  if (httpd_register_uri_handler(server, &stream_uri) != ESP_OK) {
    httpd_ssl_stop(server);
    http_server_ = nullptr;
    return false;
  }

  auto firmware_update_handler = [](httpd_req_t* request) -> esp_err_t {
    return static_cast<esp_err_t>(
        static_cast<EspNetworkServer*>(request->user_ctx)
            ->handle_firmware_update(request));
  };
  httpd_uri_t firmware_update_uri{};
  firmware_update_uri.uri = "/api/v3/firmware-updates";
  firmware_update_uri.method = HTTP_POST;
  firmware_update_uri.handler = firmware_update_handler;
  firmware_update_uri.user_ctx = this;
  if (httpd_register_uri_handler(server, &firmware_update_uri) != ESP_OK) {
    httpd_ssl_stop(server);
    http_server_ = nullptr;
    return false;
  }

  auto handler = [](httpd_req_t* request) -> esp_err_t {
    return static_cast<esp_err_t>(
        static_cast<EspNetworkServer*>(request->user_ctx)
            ->handle_http_request(request));
  };
  for (const auto& route : kApiRoutes) {
    if (route.id == ApiRouteId::kExtractionStream ||
        route.id == ApiRouteId::kFirmwareUpdate) {
      continue;
    }
    httpd_uri_t uri{};
    uri.uri = route.path;
    uri.method = http_method(route.method);
    uri.handler = handler;
    uri.user_ctx = this;
    if (httpd_register_uri_handler(server, &uri) != ESP_OK) {
      httpd_ssl_stop(server);
      http_server_ = nullptr;
      return false;
    }
  }
  return true;
}

int EspNetworkServer::handle_firmware_update(void* opaque_request) {
  auto* request = static_cast<httpd_req_t*>(opaque_request);
  constexpr char kPath[] = "/api/v3/firmware-updates";
  std::array<char, kMaximumAuthorizationLength + 1U> authorization{};
  const std::size_t authorization_length =
      httpd_req_get_hdr_value_len(request, "Authorization");
  const char* authorization_value = nullptr;
  if (authorization_length > 0U &&
      authorization_length <= kMaximumAuthorizationLength &&
      httpd_req_get_hdr_value_str(request, "Authorization",
                                  authorization.data(),
                                  authorization_length + 1U) == ESP_OK) {
    authorization_value = authorization.data();
  }
  if (!api_.authorized(authorization_value)) {
    return send_http_response(
        request,
        {401,
         "{\"error\":{\"code\":\"unauthorized\",\"message\":\"A valid bearer token is required.\"}}",
         true},
        kPath);
  }
  if (firmware_update_ == nullptr) {
    return send_http_response(
        request,
        {503,
         "{\"error\":{\"code\":\"firmware_update_unavailable\",\"message\":\"Firmware update storage is unavailable.\"}}",
         false},
        kPath);
  }

  std::array<char, 65> content_type{};
  const std::size_t content_type_length =
      httpd_req_get_hdr_value_len(request, "Content-Type");
  if (content_type_length == 0U ||
      content_type_length >= content_type.size() ||
      httpd_req_get_hdr_value_str(request, "Content-Type",
                                  content_type.data(),
                                  content_type_length + 1U) != ESP_OK ||
      std::strcmp(content_type.data(), "application/octet-stream") != 0) {
    return send_http_response(
        request,
        {415,
         "{\"error\":{\"code\":\"unsupported_media_type\",\"message\":\"Firmware updates require application/octet-stream.\"}}",
         false},
        kPath);
  }

  std::array<char, kSha256HexLength + 1U> digest{};
  const std::size_t digest_length =
      httpd_req_get_hdr_value_len(request, "X-Philcoino-Image-SHA256");
  if (digest_length != kSha256HexLength ||
      httpd_req_get_hdr_value_str(request, "X-Philcoino-Image-SHA256",
                                  digest.data(), digest.size()) != ESP_OK) {
    return send_http_response(
        request,
        {400,
         "{\"error\":{\"code\":\"firmware_metadata_invalid\",\"message\":\"A lowercase hexadecimal image SHA-256 is required.\"}}",
         false},
        kPath);
  }

  const auto begin_result = firmware_update_->begin(
      request->content_len, digest.data(),
      static_cast<std::uint32_t>(uptime_ms()));
  if (begin_result != FirmwareUpdateResult::kOk) {
    switch (begin_result) {
      case FirmwareUpdateResult::kImageTooLarge:
        return send_http_response(
            request,
            {413,
             "{\"error\":{\"code\":\"firmware_image_too_large\",\"message\":\"The firmware image does not fit the inactive OTA slot.\"}}",
             false},
            kPath);
      case FirmwareUpdateResult::kInvalidMetadata:
        return send_http_response(
            request,
            {400,
             "{\"error\":{\"code\":\"firmware_metadata_invalid\",\"message\":\"The firmware image metadata is invalid.\"}}",
             false},
            kPath);
      case FirmwareUpdateResult::kSafetyConflict:
      case FirmwareUpdateResult::kBusy:
        return send_http_response(
            request,
            {409,
             "{\"error\":{\"code\":\"firmware_update_busy\",\"message\":\"Stop extraction, cooldown, and calibration before updating.\"}}",
             false},
            kPath);
      case FirmwareUpdateResult::kOutputFailure:
        return send_http_response(
            request,
            {409,
             "{\"error\":{\"code\":\"output_shutdown_failed\",\"message\":\"The firmware could not confirm fail-off output commands.\"}}",
             false},
            kPath);
      default:
        return send_http_response(
            request,
            {500,
             "{\"error\":{\"code\":\"firmware_update_failed\",\"message\":\"The inactive OTA slot could not be prepared.\"}}",
             false},
            kPath);
    }
  }

  std::unique_ptr<std::uint8_t, decltype(&heap_caps_free)> chunk(
      static_cast<std::uint8_t*>(
          heap_caps_malloc(kFirmwareUploadChunkBytes, MALLOC_CAP_8BIT)),
      heap_caps_free);
  if (chunk == nullptr) {
    firmware_update_->abort();
    return send_http_response(
        request,
        {500,
         "{\"error\":{\"code\":\"firmware_update_failed\",\"message\":\"The OTA receive buffer could not be allocated.\"}}",
         false},
        kPath);
  }
  std::size_t remaining = request->content_len;
  unsigned timeout_count = 0U;
  const auto deadline_us = esp_timer_get_time() + kFirmwareUploadDeadlineUs;
  while (remaining > 0U) {
    if (esp_timer_get_time() >= deadline_us) {
      firmware_update_->abort();
      return ESP_FAIL;
    }
    const auto requested = std::min(remaining, kFirmwareUploadChunkBytes);
    const int received = httpd_req_recv(
        request, reinterpret_cast<char*>(chunk.get()), requested);
    if (received == HTTPD_SOCK_ERR_TIMEOUT) {
      ++timeout_count;
      if (timeout_count >= kMaximumFirmwareUploadTimeouts) {
        firmware_update_->abort();
        return ESP_FAIL;
      }
      continue;
    }
    if (received <= 0) {
      firmware_update_->abort();
      return ESP_FAIL;
    }
    const auto length = static_cast<std::size_t>(received);
    if (firmware_update_->write(chunk.get(), length) !=
        FirmwareUpdateResult::kOk) {
      return send_http_response(
          request,
          {500,
           "{\"error\":{\"code\":\"firmware_update_failed\",\"message\":\"Writing the inactive OTA slot failed.\"}}",
           false},
          kPath);
    }
    remaining -= length;
  }

  const auto written = firmware_update_->bytes_written();
  const auto finish_result = firmware_update_->finish();
  if (finish_result != FirmwareUpdateResult::kOk) {
    if (finish_result == FirmwareUpdateResult::kDigestMismatch) {
      return send_http_response(
          request,
          {422,
           "{\"error\":{\"code\":\"firmware_digest_mismatch\",\"message\":\"The uploaded firmware SHA-256 does not match.\"}}",
           false},
          kPath);
    }
    if (finish_result == FirmwareUpdateResult::kInvalidImage) {
      return send_http_response(
          request,
          {422,
           "{\"error\":{\"code\":\"firmware_image_invalid\",\"message\":\"ESP-IDF rejected the uploaded application image.\"}}",
           false},
          kPath);
    }
    return send_http_response(
        request,
        {500,
         "{\"error\":{\"code\":\"firmware_update_failed\",\"message\":\"The OTA image could not be finalized.\"}}",
         false},
        kPath);
  }

  const std::string body =
      "{\"status\":\"accepted\",\"rebooting\":true,\"bytesWritten\":" +
      std::to_string(written) + "}";
  const auto response_result = send_http_response(
      request, {202, body, false}, kPath);
  if (xTaskCreate(firmware_reboot_task, "philcoino-ota-reboot", 2048,
                  nullptr, 5, nullptr) != pdPASS) {
    ESP_LOGE(kLogTag,
             "OTA delayed reboot task could not start; rebooting from the request task");
    vTaskDelay(pdMS_TO_TICKS(500));
    esp_restart();
  }
  return response_result;
}

void EspNetworkServer::firmware_reboot_task(void*) {
  vTaskDelay(pdMS_TO_TICKS(500));
  esp_restart();
}

int EspNetworkServer::handle_http_request(void* opaque_request) {
  auto* request = static_cast<httpd_req_t*>(opaque_request);
  std::array<char, kMaximumAuthorizationLength + 1U> authorization{};
  const std::size_t header_length =
      httpd_req_get_hdr_value_len(request, "Authorization");
  const char* authorization_value = nullptr;
  if (header_length > 0 && header_length <= kMaximumAuthorizationLength) {
    if (httpd_req_get_hdr_value_str(request, "Authorization",
                                    authorization.data(),
                                    header_length + 1U) == ESP_OK) {
      authorization_value = authorization.data();
    }
  }

  const auto method = request_method(request->method);
  const std::string path(request->uri);
  const auto* route = find_api_route(method, path);
  if (route != nullptr && route->requires_authentication &&
      !api_.authorized(authorization_value)) {
    const HttpResponse response =
        api_.handle(method, path, authorization_value, "", uptime_ms());
    return send_http_response(request, response, path);
  }

  std::string body;
  if (request->content_len > 0 &&
      static_cast<std::size_t>(request->content_len) <=
          kMaximumRequestBodyLength) {
    body.resize(static_cast<std::size_t>(request->content_len));
    std::size_t received = 0;
    unsigned timeout_count = 0;
    const auto deadline_us = esp_timer_get_time() + kRequestBodyDeadlineUs;
    while (received < body.size()) {
      if (esp_timer_get_time() >= deadline_us) {
        return ESP_FAIL;
      }
      const int result = httpd_req_recv(request, body.data() + received,
                                        body.size() - received);
      if (result == HTTPD_SOCK_ERR_TIMEOUT) {
        ++timeout_count;
        if (timeout_count >= kMaximumBodyTimeouts ||
            esp_timer_get_time() >= deadline_us) {
          return ESP_FAIL;
        }
        continue;
      }
      if (result <= 0) {
        return ESP_FAIL;
      }
      received += static_cast<std::size_t>(result);
      if (received < body.size() && esp_timer_get_time() >= deadline_us) {
        return ESP_FAIL;
      }
    }
  } else if (request->content_len > 0) {
    body = "invalid";
  }

  const HttpResponse response =
      route == nullptr
          ? api_.handle(method, path, authorization_value, body, uptime_ms())
          : api_.handle_resolved(*route, path, body, uptime_ms());
  return send_http_response(request, response, path);
}

int EspNetworkServer::handle_extraction_stream(void* opaque_request) {
  auto* request = static_cast<httpd_req_t*>(opaque_request);
  std::array<char, kMaximumAuthorizationLength + 1U> authorization{};
  const std::size_t header_length =
      httpd_req_get_hdr_value_len(request, "Authorization");
  const char* authorization_value = nullptr;
  if (header_length > 0U && header_length <= kMaximumAuthorizationLength &&
      httpd_req_get_hdr_value_str(request, "Authorization",
                                  authorization.data(),
                                  header_length + 1U) == ESP_OK) {
    authorization_value = authorization.data();
  }
  if (!api_.authorized(authorization_value)) {
    return send_http_response(
        request,
        {401,
         "{\"error\":{\"code\":\"unauthorized\",\"message\":\"A valid bearer token is required.\"}}",
         true},
        "/api/v3/extractions/current/stream");
  }
  ExtractionTelemetryCursor cursor{};
  const std::size_t query_length = httpd_req_get_url_query_len(request);
  if (query_length > 256U) {
    return send_http_response(
        request,
        {400,
         "{\"error\":{\"code\":\"malformed_request\",\"message\":\"The extraction telemetry cursor is malformed.\"}}",
         false},
        "/api/v3/extractions/current/stream");
  }
  std::array<char, 257> query{};
  if (query_length > 0U &&
      httpd_req_get_url_query_str(request, query.data(),
                                  query_length + 1U) != ESP_OK) {
    return ESP_FAIL;
  }
  if (!parse_extraction_telemetry_cursor(query.data(), cursor)) {
    return send_http_response(
        request,
        {400,
         "{\"error\":{\"code\":\"malformed_request\",\"message\":\"The extraction telemetry cursor is malformed.\"}}",
         false},
        "/api/v3/extractions/current/stream");
  }
  if (extraction_telemetry_ == nullptr ||
      !extraction_telemetry_->cursor_available(cursor)) {
    return send_http_response(
        request,
        {409,
         "{\"error\":{\"code\":\"stream_unavailable\",\"message\":\"The extraction telemetry cursor is unavailable.\"}}",
         false},
        "/api/v3/extractions/current/stream");
  }

  bool expected = false;
  if (!extraction_stream_active_.compare_exchange_strong(
          expected, true, std::memory_order_acq_rel)) {
    return send_http_response(
        request,
        {409,
         "{\"error\":{\"code\":\"stream_busy\",\"message\":\"Another authenticated extraction telemetry subscriber is active.\"}}",
         false},
        "/api/v3/extractions/current/stream");
  }

  httpd_req_t* asynchronous_request = nullptr;
  if (httpd_req_async_handler_begin(request, &asynchronous_request) != ESP_OK) {
    extraction_stream_active_.store(false, std::memory_order_release);
    return ESP_FAIL;
  }
  extraction_stream_request_ = asynchronous_request;
  extraction_stream_cursor_supplied_ = cursor.supplied;
  extraction_stream_boot_id_ = cursor.boot_id;
  extraction_stream_extraction_id_ = cursor.extraction_id;
  extraction_stream_after_sequence_ = cursor.after_sequence;
  if (xTaskCreate(extraction_stream_task, "philcoino-sse", 6144, this, 4,
                  nullptr) != pdPASS) {
    httpd_req_async_handler_complete(asynchronous_request);
    extraction_stream_request_ = nullptr;
    extraction_stream_active_.store(false, std::memory_order_release);
    return ESP_FAIL;
  }
  return ESP_OK;
}

void EspNetworkServer::extraction_stream_task(void* context) {
  auto* server = static_cast<EspNetworkServer*>(context);
  server->extraction_stream_task_handle_.store(xTaskGetCurrentTaskHandle(),
                                                std::memory_order_release);
  server->run_extraction_stream();
  server->extraction_stream_task_handle_.store(nullptr,
                                                std::memory_order_release);
  server->extraction_stream_active_.store(false, std::memory_order_release);
  vTaskDelete(nullptr);
}

void EspNetworkServer::notify_extraction_stream(void* context) {
  auto* server = static_cast<EspNetworkServer*>(context);
  const auto task = static_cast<TaskHandle_t>(
      server->extraction_stream_task_handle_.load(std::memory_order_acquire));
  if (task != nullptr) {
    xTaskNotifyGive(task);
  }
}

void EspNetworkServer::run_extraction_stream() {
  auto* request = static_cast<httpd_req_t*>(extraction_stream_request_);
  if (request == nullptr || extraction_telemetry_ == nullptr) return;

  ExtractionTelemetryCursor cursor{};
  cursor.supplied = extraction_stream_cursor_supplied_;
  cursor.boot_id = extraction_stream_boot_id_;
  cursor.extraction_id = extraction_stream_extraction_id_;
  cursor.after_sequence = extraction_stream_after_sequence_;
  httpd_resp_set_status(request, "200 OK");
  httpd_resp_set_type(request, "text/event-stream");
  httpd_resp_set_hdr(request, "Cache-Control", "no-cache, no-transform");
  httpd_resp_set_hdr(request, "Connection", "keep-alive");
  httpd_resp_set_hdr(request, "X-Accel-Buffering", "no");

  bool connected = true;
  bool terminal = false;
  while (connected && !terminal) {
    while (connected) {
      ExtractionTelemetryPage page{};
      page.status = ExtractionTelemetryStatus::kRunning;
      if (!extraction_telemetry_->page(cursor, uptime_ms(), page)) {
        if (page.status == ExtractionTelemetryStatus::kTerminal) {
          terminal = true;
        }
        break;
      }
      const auto json =
          serialize_extraction_telemetry_page(identity_.device_id, page);
      if (json.empty()) {
        connected = false;
        break;
      }
      const std::string event_id =
          std::string(page.boot_id.data()) + "." +
          page.extraction_id.data() + "." +
          std::to_string(page.next_sequence);
      const std::string frame = "id: " + event_id +
                                "\nevent: telemetry\ndata: " + json +
                                "\n\n";
      connected = httpd_resp_send_chunk(request, frame.data(), frame.size()) ==
                  ESP_OK;
      cursor.supplied = true;
      cursor.boot_id = page.boot_id;
      cursor.extraction_id = page.extraction_id;
      cursor.after_sequence = page.next_sequence;
      terminal = page.status == ExtractionTelemetryStatus::kTerminal &&
                 !page.has_more;
      if (!page.has_more || terminal) break;
    }
    if (!connected || terminal) break;
    if (ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(kExtractionTelemetryHeartbeatMs)) ==
        0U) {
      constexpr char heartbeat[] = ": heartbeat\n\n";
      connected =
          httpd_resp_send_chunk(request, heartbeat, sizeof(heartbeat) - 1U) ==
          ESP_OK;
    }
  }
  if (connected) {
    httpd_resp_send_chunk(request, nullptr, 0U);
  }
  httpd_req_async_handler_complete(request);
  extraction_stream_request_ = nullptr;
}

}  // namespace philcoino::networking
