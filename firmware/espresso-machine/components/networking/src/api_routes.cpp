#include "philcoino/api_routes.hpp"

#include <algorithm>
#include <string_view>

namespace philcoino::networking {

const ApiRouteDescriptor* find_api_route(HttpMethod method,
                                         const std::string& path) {
  const auto query = path.find('?');
  const std::string_view route_path(
      path.data(), query == std::string::npos ? path.size() : query);
  for (const auto& route : kApiRoutes) {
    if (route.id == ApiRouteId::kPairingSessionAction ||
        route.id == ApiRouteId::kTemperatureCalibrationStart ||
        route.id == ApiRouteId::kTemperatureCalibrationCandidate ||
        route.id == ApiRouteId::kTemperatureCalibrationSave ||
        route.id == ApiRouteId::kTemperatureCalibrationCancel ||
        route.id == ApiRouteId::kTemperatureCalibrationRenew) continue;
    if (route.method == method &&
        route_path == std::string_view(route.path)) {
      return &route;
    }
  }
  constexpr std::string_view kCalibrationPrefix =
      "/api/v4/temperature-calibrations/";
  if (route_path.size() > kCalibrationPrefix.size() &&
      route_path.substr(0U, kCalibrationPrefix.size()) == kCalibrationPrefix) {
    const auto remainder = route_path.substr(kCalibrationPrefix.size());
    const auto slash = remainder.find('/');
    const auto sensor = remainder.substr(0U, slash);
    const auto suffix = slash == std::string_view::npos
                            ? std::string_view{}
                            : remainder.substr(slash);
    if ((sensor == "boiler" || sensor == "steam") &&
        (suffix == "/current" || suffix == "/current/lease")) {
      for (const auto& route : kApiRoutes) {
        const bool lease = route.id == ApiRouteId::kTemperatureCalibrationRenew;
        const bool calibration_route =
            route.id == ApiRouteId::kTemperatureCalibrationStart ||
            route.id == ApiRouteId::kTemperatureCalibrationCandidate ||
            route.id == ApiRouteId::kTemperatureCalibrationSave ||
            route.id == ApiRouteId::kTemperatureCalibrationCancel || lease;
        if (calibration_route && route.method == method &&
            lease == (suffix == "/current/lease")) {
          return &route;
        }
      }
    }
  }
  constexpr std::string_view kPrefix = "/api/v4/pairing/sessions/";
  if (method == HttpMethod::kPost && route_path.size() > kPrefix.size() &&
      route_path.substr(0U, kPrefix.size()) == kPrefix) {
    const auto remainder = route_path.substr(kPrefix.size());
    const auto separator = remainder.find('/');
    if (separator == 32U &&
        (remainder.substr(separator + 1U) == "proof" ||
         remainder.substr(separator + 1U) == "complete") &&
        std::all_of(remainder.begin(), remainder.begin() + 32,
                    [](char character) {
                      return (character >= '0' && character <= '9') ||
                             (character >= 'a' && character <= 'f');
                    })) {
      for (const auto& route : kApiRoutes) {
        if (route.id == ApiRouteId::kPairingSessionAction) return &route;
      }
    }
  }
  return nullptr;
}

bool request_requires_auth(HttpMethod method, const std::string& path) {
  const auto* route = find_api_route(method, path);
  return route != nullptr && route->requires_authentication;
}

}  // namespace philcoino::networking
