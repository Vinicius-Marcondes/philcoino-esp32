#pragma once

#include <array>
#include <cstdint>
#include <string>

#include "philcoino/control.hpp"
#include "philcoino/peripherals.hpp"

namespace philcoino::networking {

class HistoryBuffer;

inline constexpr char kApiVersion[] = "1";
inline constexpr char kMdnsServiceType[] = "_philcoino";
inline constexpr char kMdnsProtocol[] = "_tcp";
inline constexpr std::uint16_t kHttpPort = 80;

enum class HttpMethod { kGet, kPatch, kPost, kPut };
enum class ApiDomain { kTemperature, kExtraction };

class ApiSynchronization {
 public:
  virtual ~ApiSynchronization() = default;
  virtual bool lock(ApiDomain domain) = 0;
  virtual void unlock(ApiDomain domain) = 0;
};

struct DeviceIdentity {
  std::string device_id;
  std::string name;
  std::string model;
  std::string firmware_version;
};

struct HttpResponse {
  int status{500};
  std::string body;
  bool bearer_challenge{false};
};

struct DiscoveryTxtItem {
  std::string key;
  std::string value;
};

using DiscoveryTxt = std::array<DiscoveryTxtItem, 5>;

DiscoveryTxt discovery_txt(const DeviceIdentity& identity);

bool constant_time_bearer_matches(const char* authorization,
                                  const std::string& expected_token);

class FirmwareApi {
 public:
  FirmwareApi(DeviceIdentity identity, std::string bearer_token,
              control::TemperatureController& controller,
              peripherals::TargetStorage& target_storage,
              control::ExtractionController& extraction_controller,
              control::CooldownController& cooldown_controller,
              peripherals::ProfileStorage& profile_storage,
              ApiSynchronization& synchronization,
              HistoryBuffer* history = nullptr,
              control::ScaleController* scale_controller = nullptr);

  HttpResponse handle(HttpMethod method, const std::string& path,
                      const char* authorization, const std::string& body,
                      std::uint64_t uptime_ms);
  bool authorized(const char* authorization) const;

 private:
  HttpResponse health(std::uint64_t uptime_ms) const;
  HttpResponse device() const;
  HttpResponse state(std::uint64_t uptime_ms) const;
  HttpResponse update_temperatures(const std::string& body,
                                   std::uint64_t uptime_ms);
  HttpResponse update_mode(const std::string& body,
                           std::uint64_t uptime_ms);
  HttpResponse update_heater(const std::string& body,
                             std::uint64_t uptime_ms);
  HttpResponse dismiss_over_temperature(std::uint64_t uptime_ms);
  HttpResponse state_v2(std::uint64_t uptime_ms) const;
  HttpResponse history(const std::string& query,
                       std::uint64_t uptime_ms) const;
  HttpResponse profiles() const;
  HttpResponse scale(std::uint64_t uptime_ms) const;
  HttpResponse start_scale_calibration(std::uint64_t uptime_ms);
  HttpResponse complete_scale_calibration(const std::string& body,
                                          std::uint64_t uptime_ms);
  HttpResponse cancel_scale_calibration(std::uint64_t uptime_ms);
  HttpResponse acknowledge_scale_warning(std::uint64_t uptime_ms);
  HttpResponse replace_profiles(const std::string& body,
                                std::uint64_t uptime_ms);
  HttpResponse start_extraction(const std::string& body,
                                std::uint64_t uptime_ms);
  HttpResponse stop_extraction(std::uint64_t uptime_ms);
  HttpResponse start_cooldown(const std::string& body,
                              std::uint64_t uptime_ms);
  HttpResponse stop_cooldown(std::uint64_t uptime_ms);

  DeviceIdentity identity_;
  std::string bearer_token_;
  control::TemperatureController& controller_;
  peripherals::TargetStorage& target_storage_;
  control::ExtractionController& extraction_controller_;
  control::CooldownController& cooldown_controller_;
  peripherals::ProfileStorage& profile_storage_;
  ApiSynchronization& synchronization_;
  HistoryBuffer* history_;
  control::ScaleController* scale_controller_;
};

}  // namespace philcoino::networking
