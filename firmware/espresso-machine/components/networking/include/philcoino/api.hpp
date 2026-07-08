#pragma once

#include <array>
#include <cstdint>
#include <string>

#include "philcoino/control.hpp"
#include "philcoino/peripherals.hpp"

namespace philcoino::networking {

inline constexpr char kApiVersion[] = "1";
inline constexpr char kMdnsServiceType[] = "_philcoino";
inline constexpr char kMdnsProtocol[] = "_tcp";
inline constexpr std::uint16_t kHttpPort = 80;

enum class HttpMethod { kGet, kPatch, kPost, kPut };

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
              peripherals::TargetStorage& target_storage);

  HttpResponse handle(HttpMethod method, const std::string& path,
                      const char* authorization, const std::string& body,
                      std::uint64_t uptime_ms);

 private:
  HttpResponse health(std::uint64_t uptime_ms) const;
  HttpResponse device() const;
  HttpResponse state(std::uint64_t uptime_ms) const;
  HttpResponse update_temperatures(const std::string& body,
                                   std::uint64_t uptime_ms);
  HttpResponse update_mode(const std::string& body,
                           std::uint64_t uptime_ms);
  HttpResponse dismiss_over_temperature(std::uint64_t uptime_ms);

  DeviceIdentity identity_;
  std::string bearer_token_;
  control::TemperatureController& controller_;
  peripherals::TargetStorage& target_storage_;
};

}  // namespace philcoino::networking
