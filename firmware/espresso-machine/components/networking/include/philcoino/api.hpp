#pragma once

#include <array>
#include <cstdint>
#include <string>

#include "philcoino/control.hpp"
#include "philcoino/peripherals.hpp"

namespace philcoino::networking {

struct ApiRouteDescriptor;
class PairingService;

inline constexpr char kApiVersion[] = "3";
inline constexpr char kMdnsServiceType[] = "_philcoino";
inline constexpr char kMdnsProtocol[] = "_tcp";
inline constexpr std::uint16_t kHttpsPort = 443;

enum class HttpMethod { kDelete, kGet, kPatch, kPost, kPut };
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

class FirmwareApi {
 public:
  FirmwareApi(DeviceIdentity identity, PairingService& pairing,
              control::TemperatureController& controller,
              peripherals::TargetStorage& target_storage,
              peripherals::TemperatureCalibrationStorage&
                  temperature_calibration_storage,
              control::ExtractionController& extraction_controller,
              control::CooldownController& cooldown_controller,
              peripherals::ScaleCalibrationStorage& scale_calibration_storage,
              ApiSynchronization& synchronization,
              control::ScaleController* scale_controller = nullptr,
              peripherals::SteamControlSettingsStorage*
                  steam_control_settings_storage = nullptr,
              std::string boot_id = "00000000000000000000000000000000");

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
  HttpResponse state_v3(std::uint64_t uptime_ms);
  HttpResponse acknowledged_mutation(HttpResponse response,
                                     std::uint64_t uptime_ms);
  HttpResponse update_settings(const std::string& body,
                               std::uint64_t uptime_ms);
  HttpResponse update_mode(const std::string& body,
                           std::uint64_t uptime_ms);
  HttpResponse update_heater(const std::string& body,
                             std::uint64_t uptime_ms);
  HttpResponse dismiss_over_temperature(std::uint64_t uptime_ms);
  HttpResponse start_temperature_calibration(std::uint64_t uptime_ms);
  HttpResponse update_temperature_calibration_candidate(
      const std::string& body, std::uint64_t uptime_ms);
  HttpResponse save_temperature_calibration(const std::string& body,
                                            std::uint64_t uptime_ms);
  HttpResponse cancel_temperature_calibration(const std::string& body,
                                              std::uint64_t uptime_ms);
  HttpResponse renew_temperature_calibration(const std::string& body,
                                             std::uint64_t uptime_ms);
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
  PairingService& pairing_;
  control::TemperatureController& controller_;
  peripherals::TargetStorage& target_storage_;
  peripherals::TemperatureCalibrationStorage&
      temperature_calibration_storage_;
  control::ExtractionController& extraction_controller_;
  control::CooldownController& cooldown_controller_;
  peripherals::ScaleCalibrationStorage& scale_calibration_storage_;
  ApiSynchronization& synchronization_;
  control::ScaleController* scale_controller_;
  peripherals::SteamControlSettingsStorage*
      steam_control_settings_storage_;
  std::string boot_id_;
  std::uint64_t revision_{0};
  std::uint32_t temperature_calibration_sequence_{0};
};

}  // namespace philcoino::networking
