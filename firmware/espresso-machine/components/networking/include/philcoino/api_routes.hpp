#pragma once

#include <array>
#include <string>

#include "philcoino/api.hpp"

namespace philcoino::networking {

enum class ApiRouteId {
  kHealth,
  kPairingSessionStart,
  kPairingSessionAction,
  kState,
  kSettings,
  kMode,
  kHeaterPermission,
  kDismissOverTemperature,
  kTemperatureCalibrationStart,
  kTemperatureCalibrationCandidate,
  kTemperatureCalibrationSave,
  kTemperatureCalibrationCancel,
  kTemperatureCalibrationRenew,
  kScaleCalibrationStart,
  kScaleCalibrationComplete,
  kScaleCalibrationCancel,
  kScaleWarningAcknowledge,
  kExtractionStart,
  kExtractionStop,
  kExtractionStream,
  kCooldownStart,
  kCooldownStop,
};

struct ApiRouteDescriptor {
  ApiRouteId id;
  HttpMethod method;
  const char* path;
  bool requires_authentication;
};

inline constexpr std::array<ApiRouteDescriptor, 22> kApiRoutes{{
    {ApiRouteId::kHealth, HttpMethod::kGet, "/healthz", false},
    {ApiRouteId::kPairingSessionStart, HttpMethod::kPost,
     "/api/v3/pairing/sessions", false},
    {ApiRouteId::kPairingSessionAction, HttpMethod::kPost,
     "/api/v3/pairing/sessions/*", false},
    {ApiRouteId::kState, HttpMethod::kGet, "/api/v3/state", true},
    {ApiRouteId::kSettings, HttpMethod::kPatch, "/api/v3/settings", true},
    {ApiRouteId::kMode, HttpMethod::kPut, "/api/v3/mode", true},
    {ApiRouteId::kHeaterPermission, HttpMethod::kPut,
     "/api/v3/heater-permission", true},
    {ApiRouteId::kDismissOverTemperature, HttpMethod::kPost,
     "/api/v3/faults/over-temperature/dismiss", true},
    {ApiRouteId::kTemperatureCalibrationStart, HttpMethod::kPost,
     "/api/v3/temperature-calibrations/current", true},
    {ApiRouteId::kTemperatureCalibrationCandidate, HttpMethod::kPatch,
     "/api/v3/temperature-calibrations/current", true},
    {ApiRouteId::kTemperatureCalibrationSave, HttpMethod::kPut,
     "/api/v3/temperature-calibrations/current", true},
    {ApiRouteId::kTemperatureCalibrationCancel, HttpMethod::kDelete,
     "/api/v3/temperature-calibrations/current", true},
    {ApiRouteId::kTemperatureCalibrationRenew, HttpMethod::kPost,
     "/api/v3/temperature-calibrations/current/lease", true},
    {ApiRouteId::kScaleCalibrationStart, HttpMethod::kPost,
     "/api/v3/scale-calibrations/current", true},
    {ApiRouteId::kScaleCalibrationComplete, HttpMethod::kPut,
     "/api/v3/scale-calibrations/current", true},
    {ApiRouteId::kScaleCalibrationCancel, HttpMethod::kDelete,
     "/api/v3/scale-calibrations/current", true},
    {ApiRouteId::kScaleWarningAcknowledge, HttpMethod::kPost,
     "/api/v3/scale/warnings/acknowledge", true},
    {ApiRouteId::kExtractionStart, HttpMethod::kPost,
     "/api/v3/extractions", true},
    {ApiRouteId::kExtractionStop, HttpMethod::kDelete,
     "/api/v3/extractions/current", true},
    {ApiRouteId::kExtractionStream, HttpMethod::kGet,
     "/api/v3/extractions/current/stream", true},
    {ApiRouteId::kCooldownStart, HttpMethod::kPost,
     "/api/v3/cooldowns", true},
    {ApiRouteId::kCooldownStop, HttpMethod::kDelete,
     "/api/v3/cooldowns/current", true},
}};

const ApiRouteDescriptor* find_api_route(HttpMethod method,
                                         const std::string& path);
bool request_requires_auth(HttpMethod method, const std::string& path);

}  // namespace philcoino::networking
