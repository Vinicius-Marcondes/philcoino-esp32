#pragma once

#include <array>
#include <cstdint>
#include <string>

#include "philcoino/control.hpp"
#include "philcoino/peripherals.hpp"

namespace philcoino::networking {

class WeightedTraceBuffer;
struct ApiRouteDescriptor;

inline constexpr char kApiVersion[] = "2";
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
              peripherals::TemperatureCalibrationStorage&
                  temperature_calibration_storage,
              control::ExtractionController& extraction_controller,
              control::CooldownController& cooldown_controller,
              peripherals::ScaleCalibrationStorage& scale_calibration_storage,
              ApiSynchronization& synchronization,
              control::ScaleController* scale_controller = nullptr,
              WeightedTraceBuffer* weighted_trace = nullptr,
              peripherals::SteamControlSettingsStorage*
                  steam_control_settings_storage = nullptr);

  HttpResponse handle(HttpMethod method, const std::string& path,
                      const char* authorization, const std::string& body,
                      std::uint64_t uptime_ms);
  HttpResponse handle_resolved(const ApiRouteDescriptor& route,
                               const std::string& path,
                               const std::string& body,
                               std::uint64_t uptime_ms);
  bool authorized(const char* authorization) const;

 private:
  HttpResponse health(std::uint64_t uptime_ms) const;
  HttpResponse device() const;
  HttpResponse state(std::uint64_t uptime_ms) const;
  HttpResponse steam_control_settings(std::uint64_t uptime_ms) const;
  HttpResponse update_steam_control_settings(const std::string& body,
                                             std::uint64_t uptime_ms);
  HttpResponse update_temperatures(const std::string& body,
                                   std::uint64_t uptime_ms);
  HttpResponse update_mode(const std::string& body,
                           std::uint64_t uptime_ms);
  HttpResponse update_heater(const std::string& body,
                             std::uint64_t uptime_ms);
  HttpResponse dismiss_over_temperature(std::uint64_t uptime_ms);
  HttpResponse temperature_calibration(const std::string& query,
                                       std::uint64_t uptime_ms);
  HttpResponse start_temperature_calibration(std::uint64_t uptime_ms);
  HttpResponse update_temperature_calibration_candidate(
      const std::string& body, std::uint64_t uptime_ms);
  HttpResponse save_temperature_calibration(const std::string& body,
                                            std::uint64_t uptime_ms);
  HttpResponse cancel_temperature_calibration(const std::string& body,
                                              std::uint64_t uptime_ms);
  HttpResponse state_v2(const std::string& query,
                        std::uint64_t uptime_ms) const;
  HttpResponse scale(std::uint64_t uptime_ms) const;
  HttpResponse scale_trace(const std::string& query,
                           std::uint64_t uptime_ms) const;
  HttpResponse start_scale_calibration(std::uint64_t uptime_ms);
  HttpResponse complete_scale_calibration(const std::string& body,
                                          std::uint64_t uptime_ms);
  HttpResponse cancel_scale_calibration(std::uint64_t uptime_ms);
  HttpResponse acknowledge_scale_warning(std::uint64_t uptime_ms);
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
  peripherals::TemperatureCalibrationStorage&
      temperature_calibration_storage_;
  control::ExtractionController& extraction_controller_;
  control::CooldownController& cooldown_controller_;
  peripherals::ScaleCalibrationStorage& scale_calibration_storage_;
  ApiSynchronization& synchronization_;
  control::ScaleController* scale_controller_;
  WeightedTraceBuffer* weighted_trace_;
  peripherals::SteamControlSettingsStorage*
      steam_control_settings_storage_;
  std::uint32_t temperature_calibration_sequence_{0};
};

}  // namespace philcoino::networking
