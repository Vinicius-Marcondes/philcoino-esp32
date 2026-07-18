#pragma once

#include <array>
#include <cstddef>
#include <string>

#include "philcoino/api.hpp"

namespace philcoino::networking {

enum class ApiRouteId {
  kHealth,
  kDevice,
  kStateV1,
  kTemperatures,
  kMode,
  kHeater,
  kDismissOverTemperature,
  kStateV2,
  kProfilesGet,
  kProfilesPut,
  kExtractionStart,
  kExtractionStop,
  kCooldownStart,
  kCooldownStop,
};

struct ApiRouteDescriptor {
  ApiRouteId id;
  HttpMethod method;
  const char* path;
  bool requires_authentication;
};

inline constexpr std::array<ApiRouteDescriptor, 14> kApiRoutes{{
    {ApiRouteId::kHealth, HttpMethod::kGet, "/healthz", false},
    {ApiRouteId::kDevice, HttpMethod::kGet, "/api/v1/device", false},
    {ApiRouteId::kStateV1, HttpMethod::kGet, "/api/v1/state", true},
    {ApiRouteId::kTemperatures, HttpMethod::kPatch,
     "/api/v1/settings/temperatures", true},
    {ApiRouteId::kMode, HttpMethod::kPut, "/api/v1/mode", true},
    {ApiRouteId::kHeater, HttpMethod::kPut, "/api/v1/heater", true},
    {ApiRouteId::kDismissOverTemperature, HttpMethod::kPost,
     "/api/v1/faults/over-temperature/dismiss", true},
    {ApiRouteId::kStateV2, HttpMethod::kGet, "/api/v2/state", true},
    {ApiRouteId::kProfilesGet, HttpMethod::kGet, "/api/v2/profiles", true},
    {ApiRouteId::kProfilesPut, HttpMethod::kPut, "/api/v2/profiles", true},
    {ApiRouteId::kExtractionStart, HttpMethod::kPost,
     "/api/v2/extractions/start", true},
    {ApiRouteId::kExtractionStop, HttpMethod::kPost,
     "/api/v2/extractions/stop", true},
    {ApiRouteId::kCooldownStart, HttpMethod::kPost,
     "/api/v2/cooldowns/start", true},
    {ApiRouteId::kCooldownStop, HttpMethod::kPost,
     "/api/v2/cooldowns/stop", true},
}};

const ApiRouteDescriptor* find_api_route(HttpMethod method,
                                         const std::string& path);
bool request_requires_auth(HttpMethod method, const std::string& path);

}  // namespace philcoino::networking
