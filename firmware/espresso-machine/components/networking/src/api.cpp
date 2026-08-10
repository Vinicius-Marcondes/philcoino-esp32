#include "philcoino/api.hpp"

#include <cstddef>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <utility>

#include "philcoino/api_codec.hpp"
#include "philcoino/api_routes.hpp"
#include "philcoino/weighted_trace.hpp"

namespace philcoino::networking {
namespace {

using codec::cooldown_conflict;
using codec::error_response;
using codec::extraction_conflict;
using codec::json_response;
using codec::kMalformedMessage;
using codec::parse_cooldown_start;
using codec::parse_heater_enabled;
using codec::parse_mode;
using codec::parse_scale_calibration_complete;
using codec::parse_steam_control_settings;
using codec::parse_start;
using codec::parse_temperature_calibration_candidate;
using codec::parse_temperature_calibration_query;
using codec::parse_temperature_calibration_session;
using codec::parse_temperatures;
using codec::serialize_compensation;
using codec::serialize_cooldown;
using codec::serialize_device;
using codec::serialize_extraction;
using codec::serialize_health;
using codec::serialize_heater_enabled;
using codec::serialize_mode;
using codec::serialize_scale;
using codec::serialize_state;
using codec::serialize_steam_control;
using codec::serialize_targets;
using codec::serialize_temperature_calibration;

class ScopedApiLock {
 public:
  ScopedApiLock(ApiSynchronization& synchronization, ApiDomain domain)
      : synchronization_(synchronization),
        domain_(domain),
        locked_(synchronization_.lock(domain_)) {}

  ~ScopedApiLock() {
    if (locked_) {
      synchronization_.unlock(domain_);
    }
  }

  bool locked() const { return locked_; }
  void unlock() {
    if (locked_) {
      synchronization_.unlock(domain_);
      locked_ = false;
    }
  }

 private:
  ApiSynchronization& synchronization_;
  ApiDomain domain_;
  bool locked_;
};

control::CooldownInput current_cooldown_input(
    const control::TemperatureController& controller,
    const control::ExtractionController& extraction) {
  float temperature_c = 0.0F;
  const bool sensor_valid =
      controller.brew_effective_temperature(temperature_c);
  return {sensor_valid, controller.has_fault(), extraction.active(),
          temperature_c};
}

bool ascii_case_equal(char left, char right) {
  if (left >= 'A' && left <= 'Z') {
    left = static_cast<char>(left - 'A' + 'a');
  }
  if (right >= 'A' && right <= 'Z') {
    right = static_cast<char>(right - 'A' + 'a');
  }
  return left == right;
}

HttpResponse temperature_calibration_error(
    control::TemperatureCalibrationResult result) {
  using Result = control::TemperatureCalibrationResult;
  switch (result) {
    case Result::kActive:
      return error_response(409, "temperature_calibration_active",
                            "A temperature calibration is already active.");
    case Result::kInactive:
      return error_response(409, "temperature_calibration_inactive",
                            "No temperature calibration is active.");
    case Result::kSessionMismatch:
      return error_response(
          409, "temperature_calibration_session_mismatch",
          "The calibration session identifier does not own the active session.");
    case Result::kExpired:
      return error_response(409, "temperature_calibration_expired",
                            "The temperature calibration session expired.");
    case Result::kSensorUnavailable:
      return error_response(
          409, "sensor_unavailable",
          "Temperature calibration requires a valid boiler sensor reading.");
    case Result::kHeaterDisabled:
      return error_response(
          409, "heater_disabled",
          "Enable heater permission before starting temperature calibration.");
    case Result::kFault:
      return error_response(
          409, "machine_faulted",
          "Temperature calibration cannot run while a fault is latched.");
    case Result::kSteamMode:
      return error_response(
          409, "brew_mode_required",
          "Return the machine to Brew before starting temperature calibration.");
    case Result::kMutationConflict:
      return error_response(
          409, "calibration_in_progress",
          "Another firmware-owned mutation prevents this calibration action.");
    case Result::kUnsafeTarget:
      return error_response(
          409, "temperature_target_unsafe",
          "The saved offset would require a raw Steam target above the cap.");
    case Result::kOutputFailure:
      return error_response(
          500, "internal_error",
          "The heater-off command failed during temperature calibration.");
    case Result::kAdoptionPending:
      return error_response(
          500, "internal_error",
          "Persisted temperature calibration could not be acknowledged.");
    case Result::kOk: break;
  }
  return error_response(500, "internal_error",
                        "Temperature calibration failed.");
}

}  // namespace

DiscoveryTxt discovery_txt(const DeviceIdentity& identity) {
  return {{{"deviceId", identity.device_id},
           {"name", identity.name},
           {"apiVersion", kApiVersion},
           {"firmwareVersion", identity.firmware_version},
           {"model", identity.model}}};
}

bool constant_time_bearer_matches(const char* authorization,
                                  const std::string& expected_token) {
  const char* supplied = "";
  std::size_t supplied_length = 0;
  bool valid_scheme = authorization != nullptr;
  constexpr char kScheme[] = "Bearer";
  if (valid_scheme) {
    for (std::size_t index = 0; index < sizeof(kScheme) - 1; ++index) {
      if (authorization[index] == '\0' ||
          !ascii_case_equal(authorization[index], kScheme[index])) {
        valid_scheme = false;
        break;
      }
    }
  }
  if (valid_scheme) {
    const char* cursor = authorization + sizeof(kScheme) - 1;
    if (*cursor != ' ' && *cursor != '\t') {
      valid_scheme = false;
    } else {
      while (*cursor == ' ' || *cursor == '\t') {
        ++cursor;
      }
      supplied = cursor;
      supplied_length = std::strlen(supplied);
      valid_scheme = supplied_length > 0;
    }
  }

  volatile unsigned difference = static_cast<unsigned>(
      supplied_length ^ expected_token.size());
  for (std::size_t index = 0; index < expected_token.size(); ++index) {
    const unsigned supplied_byte =
        index < supplied_length
            ? static_cast<unsigned char>(supplied[index])
            : 0U;
    difference |= supplied_byte ^
                  static_cast<unsigned char>(expected_token[index]);
  }
  return valid_scheme && !expected_token.empty() && difference == 0U;
}

FirmwareApi::FirmwareApi(DeviceIdentity identity, std::string bearer_token,
                         control::TemperatureController& controller,
                         peripherals::TargetStorage& target_storage,
                         peripherals::TemperatureCalibrationStorage&
                             temperature_calibration_storage,
                         control::ExtractionController& extraction_controller,
                         control::CooldownController& cooldown_controller,
                         peripherals::ScaleCalibrationStorage&
                             scale_calibration_storage,
                         ApiSynchronization& synchronization,
                         control::ScaleController* scale_controller,
                         WeightedTraceBuffer* weighted_trace,
                         peripherals::SteamControlSettingsStorage*
                             steam_control_settings_storage)
    : identity_(std::move(identity)),
      bearer_token_(std::move(bearer_token)),
      controller_(controller),
      target_storage_(target_storage),
      temperature_calibration_storage_(temperature_calibration_storage),
      extraction_controller_(extraction_controller),
      cooldown_controller_(cooldown_controller),
      scale_calibration_storage_(scale_calibration_storage),
      synchronization_(synchronization),
      scale_controller_(scale_controller),
      weighted_trace_(weighted_trace),
      steam_control_settings_storage_(steam_control_settings_storage) {}

bool FirmwareApi::authorized(const char* authorization) const {
  return constant_time_bearer_matches(authorization, bearer_token_);
}

HttpResponse FirmwareApi::handle(HttpMethod method, const std::string& path,
                                 const char* authorization,
                                 const std::string& body,
                                 std::uint64_t uptime_ms) {
  const auto* route = find_api_route(method, path);
  if (route == nullptr) {
    return error_response(404, "internal_error",
                          "The requested endpoint does not exist.");
  }
  if (route->requires_authentication && !authorized(authorization)) {
    return error_response(401, "unauthorized",
                          "A valid bearer token is required.", true);
  }
  return handle_resolved(*route, path, body, uptime_ms);
}

HttpResponse FirmwareApi::handle_resolved(const ApiRouteDescriptor& route,
                                          const std::string& path,
                                          const std::string& body,
                                          std::uint64_t uptime_ms) {
  const auto query_separator = path.find('?');
  const std::string query = query_separator == std::string::npos
                                ? std::string{}
                                : path.substr(query_separator + 1U);
  if (route.id != ApiRouteId::kStateV2 &&
      route.id != ApiRouteId::kScaleTrace &&
      route.id != ApiRouteId::kTemperatureCalibrationGet &&
      query_separator != std::string::npos) {
    return error_response(404, "internal_error",
                          "The requested endpoint does not exist.");
  }

  switch (route.id) {
    case ApiRouteId::kHealth: return health(uptime_ms);
    case ApiRouteId::kDevice: return device();
    case ApiRouteId::kTemperatures:
      return update_temperatures(body, uptime_ms);
    case ApiRouteId::kStateV2: return state_v2(query, uptime_ms);
    case ApiRouteId::kSteamControlSettingsGet:
      return steam_control_settings(uptime_ms);
    case ApiRouteId::kSteamControlSettingsPatch:
      return update_steam_control_settings(body, uptime_ms);
    case ApiRouteId::kTemperatureCalibrationGet:
      return temperature_calibration(query, uptime_ms);
    case ApiRouteId::kTemperatureCalibrationStart:
      return start_temperature_calibration(uptime_ms);
    case ApiRouteId::kTemperatureCalibrationCandidate:
      return update_temperature_calibration_candidate(body, uptime_ms);
    case ApiRouteId::kTemperatureCalibrationSave:
      return save_temperature_calibration(body, uptime_ms);
    case ApiRouteId::kTemperatureCalibrationCancel:
      return cancel_temperature_calibration(body, uptime_ms);
    case ApiRouteId::kScaleGet: return scale(uptime_ms);
    case ApiRouteId::kScaleTrace: return scale_trace(query, uptime_ms);
    case ApiRouteId::kScaleCalibrationStart:
      return start_scale_calibration(uptime_ms);
    case ApiRouteId::kScaleCalibrationComplete:
      return complete_scale_calibration(body, uptime_ms);
    case ApiRouteId::kScaleCalibrationCancel:
      return cancel_scale_calibration(uptime_ms);
    case ApiRouteId::kScaleWarningAcknowledge:
      return acknowledge_scale_warning(uptime_ms);
    case ApiRouteId::kExtractionStart:
      return start_extraction(body, uptime_ms);
    case ApiRouteId::kExtractionStop: return stop_extraction(uptime_ms);
    case ApiRouteId::kCooldownStart: return start_cooldown(body, uptime_ms);
    case ApiRouteId::kCooldownStop: return stop_cooldown(uptime_ms);
    case ApiRouteId::kStateV1: return state(uptime_ms);
    case ApiRouteId::kMode: return update_mode(body, uptime_ms);
    case ApiRouteId::kHeater: return update_heater(body, uptime_ms);
    case ApiRouteId::kDismissOverTemperature:
      return dismiss_over_temperature(uptime_ms);
  }
  return error_response(404, "internal_error",
                        "The requested endpoint does not exist.");
}

HttpResponse FirmwareApi::health(std::uint64_t uptime_ms) const {
  return json_response(200, serialize_health(uptime_ms));
}

HttpResponse FirmwareApi::device() const {
  return json_response(200, serialize_device(identity_));
}

HttpResponse FirmwareApi::state(std::uint64_t uptime_ms) const {
  control::ControlSnapshot snapshot{};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    snapshot = controller_.snapshot(static_cast<std::uint32_t>(uptime_ms));
  }
  return json_response(200, serialize_state(snapshot, uptime_ms));
}

HttpResponse FirmwareApi::steam_control_settings(
    std::uint64_t uptime_ms) const {
  control::SteamControlSnapshot snapshot{};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    snapshot = controller_.steam_control_snapshot(
        static_cast<std::uint32_t>(uptime_ms));
  }
  return json_response(200, serialize_steam_control(snapshot));
}

HttpResponse FirmwareApi::update_steam_control_settings(
    const std::string& body, std::uint64_t uptime_ms) {
  if (steam_control_settings_storage_ == nullptr) {
    return error_response(500, "internal_error",
                          "Steam control settings storage is unavailable.");
  }
  peripherals::SteamControlSettings current{};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    if (controller_.has_fault()) {
      return error_response(
          409, "machine_faulted",
          "Steam control settings cannot change while a fault is latched.");
    }
    current = controller_.steam_control_settings();
  }

  peripherals::SteamControlSettings updated{};
  bool constraint_violation = false;
  if (!parse_steam_control_settings(body, current, updated,
                                    constraint_violation)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  if (constraint_violation) {
    return error_response(
        400, "malformed_request",
        "Steam control settings must use whole bounded units.");
  }

  bool no_change = false;
  bool prepared = false;
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    current = controller_.steam_control_settings();
    peripherals::SteamControlSettings revalidated{};
    if (!parse_steam_control_settings(body, current, revalidated,
                                      constraint_violation) ||
        constraint_violation) {
      return error_response(400, "malformed_request", kMalformedMessage);
    }
    updated = revalidated;
    no_change =
        updated.initial_compensation_c == current.initial_compensation_c &&
        updated.decay_duration_ms == current.decay_duration_ms &&
        updated.ready_timeout_ms == current.ready_timeout_ms;
    prepared =
        no_change ||
        controller_.prepare_steam_control_settings_update(
            updated, static_cast<std::uint32_t>(uptime_ms));
  }
  if (!prepared) {
    return error_response(
        409, "internal_error",
        "Another temperature mutation is active or heater fail-off failed.");
  }
  if (!no_change && !steam_control_settings_storage_->save(updated)) {
    bool rolled_back = false;
    {
      ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
      rolled_back =
          lock.locked() &&
          controller_.rollback_steam_control_settings_update(
              static_cast<std::uint32_t>(uptime_ms));
    }
    if (!rolled_back) {
      return error_response(
          500, "internal_error",
          "Steam settings persistence failed and rollback was not acknowledged.");
    }
    return error_response(500, "persistence_failure",
                          "Steam control settings could not be persisted.");
  }

  control::SteamControlSnapshot snapshot{};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Persisted Steam settings could not be acknowledged.");
    }
    if (!no_change &&
        !controller_.adopt_persisted_steam_control_settings(
            updated, static_cast<std::uint32_t>(uptime_ms))) {
      return error_response(500, "internal_error",
                            "Persisted Steam settings could not be adopted.");
    }
    snapshot = controller_.steam_control_snapshot(
        static_cast<std::uint32_t>(uptime_ms));
  }
  return json_response(200, serialize_steam_control(snapshot));
}

HttpResponse FirmwareApi::temperature_calibration(
    const std::string& query, std::uint64_t uptime_ms) {
  bool calibration_id_supplied = false;
  std::string calibration_id;
  if (!parse_temperature_calibration_query(
          query, calibration_id_supplied, calibration_id)) {
    return error_response(400, "malformed_request",
                          "The temperature calibration query is malformed.");
  }

  control::TemperatureCalibrationSnapshot snapshot{};
  control::TemperatureCalibrationResult result{
      control::TemperatureCalibrationResult::kOk};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    if (controller_.temperature_calibration_active()) {
      result = calibration_id_supplied
                   ? controller_.renew_temperature_calibration(
                         calibration_id,
                         static_cast<std::uint32_t>(uptime_ms))
                   : control::TemperatureCalibrationResult::kSessionMismatch;
    } else if (calibration_id_supplied) {
      result = controller_.renew_temperature_calibration(
          calibration_id, static_cast<std::uint32_t>(uptime_ms));
    }
    if (result == control::TemperatureCalibrationResult::kOk) {
      snapshot = controller_.temperature_calibration_snapshot(
          static_cast<std::uint32_t>(uptime_ms));
    }
  }
  return result == control::TemperatureCalibrationResult::kOk
             ? json_response(200,
                             serialize_temperature_calibration(snapshot))
             : temperature_calibration_error(result);
}

HttpResponse FirmwareApi::start_temperature_calibration(
    std::uint64_t uptime_ms) {
  control::TemperatureCalibrationSnapshot snapshot{};
  control::TemperatureCalibrationResult result{
      control::TemperatureCalibrationResult::kOk};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    if (extraction_controller_.active()) {
      return error_response(
          409, "extraction_active",
          "Stop extraction before starting temperature calibration.");
    }
    if (cooldown_controller_.active()) {
      return error_response(
          409, "cooldown_active",
          "Stop cooldown before starting temperature calibration.");
    }
    if (scale_controller_ != nullptr &&
        scale_controller_->snapshot(
            static_cast<std::uint32_t>(uptime_ms))
                .calibration_status ==
            control::ScaleCalibrationStatus::kCalibrating) {
      return error_response(
          409, "calibration_in_progress",
          "Finish scale calibration before starting temperature calibration.");
    }
    std::ostringstream session;
    session << "temp-cal-" << std::hex << std::setfill('0')
            << std::setw(8)
            << static_cast<std::uint32_t>(uptime_ms) << '-'
            << std::setw(8) << ++temperature_calibration_sequence_;
    result = controller_.start_temperature_calibration(
        session.str(), static_cast<std::uint32_t>(uptime_ms));
    if (result == control::TemperatureCalibrationResult::kOk) {
      snapshot = controller_.temperature_calibration_snapshot(
          static_cast<std::uint32_t>(uptime_ms));
    }
  }
  return result == control::TemperatureCalibrationResult::kOk
             ? json_response(200,
                             serialize_temperature_calibration(snapshot))
             : temperature_calibration_error(result);
}

HttpResponse FirmwareApi::update_temperature_calibration_candidate(
    const std::string& body, std::uint64_t uptime_ms) {
  std::string calibration_id;
  std::int32_t candidate_raw_target_c = 0;
  if (!parse_temperature_calibration_candidate(
          body, calibration_id, candidate_raw_target_c)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }

  control::TemperatureCalibrationSnapshot snapshot{};
  control::TemperatureCalibrationResult result{
      control::TemperatureCalibrationResult::kOk};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    result = controller_.update_temperature_calibration_candidate(
        calibration_id, candidate_raw_target_c,
        static_cast<std::uint32_t>(uptime_ms));
    if (result == control::TemperatureCalibrationResult::kOk) {
      snapshot = controller_.temperature_calibration_snapshot(
          static_cast<std::uint32_t>(uptime_ms));
    }
  }
  return result == control::TemperatureCalibrationResult::kOk
             ? json_response(200,
                             serialize_temperature_calibration(snapshot))
             : temperature_calibration_error(result);
}

HttpResponse FirmwareApi::save_temperature_calibration(
    const std::string& body, std::uint64_t uptime_ms) {
  std::string calibration_id;
  if (!parse_temperature_calibration_session(body, calibration_id)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }

  peripherals::TemperatureCalibration candidate{};
  control::TemperatureCalibrationResult result{
      control::TemperatureCalibrationResult::kOk};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    result = controller_.prepare_temperature_calibration_save(
        calibration_id, candidate,
        static_cast<std::uint32_t>(uptime_ms));
  }
  if (result != control::TemperatureCalibrationResult::kOk) {
    return temperature_calibration_error(result);
  }

  if (!temperature_calibration_storage_.save(candidate)) {
    bool rolled_back = false;
    {
      ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
      rolled_back =
          lock.locked() &&
          controller_.rollback_temperature_calibration_save(
              calibration_id, static_cast<std::uint32_t>(uptime_ms)) ==
              control::TemperatureCalibrationResult::kOk;
    }
    if (!rolled_back) {
      return error_response(
          500, "internal_error",
          "Calibration persistence failed and rollback was not acknowledged.");
    }
    return error_response(
        500, "persistence_failure",
        "Temperature calibration could not be persisted.");
  }

  control::TemperatureCalibrationSnapshot snapshot{};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(
          500, "internal_error",
          "Persisted temperature calibration could not be acknowledged.");
    }
    result = controller_.adopt_persisted_temperature_calibration(
        calibration_id, candidate,
        static_cast<std::uint32_t>(uptime_ms));
    if (result == control::TemperatureCalibrationResult::kOk) {
      snapshot = controller_.temperature_calibration_snapshot(
          static_cast<std::uint32_t>(uptime_ms));
    }
  }
  return result == control::TemperatureCalibrationResult::kOk
             ? json_response(200,
                             serialize_temperature_calibration(snapshot))
             : temperature_calibration_error(result);
}

HttpResponse FirmwareApi::cancel_temperature_calibration(
    const std::string& body, std::uint64_t uptime_ms) {
  std::string calibration_id;
  if (!parse_temperature_calibration_session(body, calibration_id)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  control::TemperatureCalibrationSnapshot snapshot{};
  control::TemperatureCalibrationResult result{
      control::TemperatureCalibrationResult::kOk};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    result = controller_.cancel_temperature_calibration(
        calibration_id, static_cast<std::uint32_t>(uptime_ms));
    if (result == control::TemperatureCalibrationResult::kOk) {
      snapshot = controller_.temperature_calibration_snapshot(
          static_cast<std::uint32_t>(uptime_ms));
    }
  }
  return result == control::TemperatureCalibrationResult::kOk
             ? json_response(200,
                             serialize_temperature_calibration(snapshot))
             : temperature_calibration_error(result);
}

HttpResponse FirmwareApi::update_temperatures(const std::string& body,
                                              std::uint64_t uptime_ms) {
  peripherals::TemperatureTargets current{};
  bool calibration_conflict = false;
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    if (controller_.temperature_calibration_active()) {
      controller_.abort_temperature_calibration(
          static_cast<std::uint32_t>(uptime_ms));
      calibration_conflict = true;
    } else {
      current = controller_.targets();
    }
  }
  if (calibration_conflict) {
    return error_response(
        409, "temperature_calibration_active",
        "Temperature calibration was cancelled before changing targets.");
  }
  peripherals::TemperatureTargets updated{};
  bool constraint_violation = false;
  if (!parse_temperatures(body, current, updated, constraint_violation)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  if (constraint_violation) {
    return error_response(
        400, "temperature_out_of_range",
        "Temperature targets must be whole values within their allowed ranges.");
  }
  bool no_change = false;
  bool revalidation_failed = false;
  bool unsafe_target = false;
  bool prepare_failed = false;
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    current = controller_.targets();
    if (!parse_temperatures(body, current, updated, constraint_violation) ||
        constraint_violation) {
      revalidation_failed = true;
    } else if (!controller_.targets_reachable(updated)) {
      unsafe_target = true;
    } else {
      no_change = updated.brew_c == current.brew_c &&
                  updated.steam_c == current.steam_c;
      prepare_failed =
          !no_change &&
          !controller_.prepare_target_update(
              updated, static_cast<std::uint32_t>(uptime_ms));
    }
  }
  if (revalidation_failed) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  if (unsafe_target) {
    return error_response(
        400, "temperature_target_unsafe",
        "The requested effective target would exceed the raw temperature ceiling.");
  }
  if (prepare_failed) {
    return error_response(500, "internal_error",
                          "Temperature control synchronization failed.");
  }
  if (no_change) {
    return json_response(200, serialize_targets(current));
  }
  if (!target_storage_.save(updated)) {
    bool rollback_acknowledged = false;
    {
      ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
      rollback_acknowledged =
          lock.locked() &&
          controller_.rollback_target_update(
              static_cast<std::uint32_t>(uptime_ms));
    }
    if (!rollback_acknowledged) {
      return error_response(
          500, "internal_error",
          "Target persistence failed and safe rollback could not be acknowledged.");
    }
    return error_response(500, "persistence_failure",
                          "Temperature targets could not be persisted.");
  }
  bool adopted = false;
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    adopted = lock.locked() &&
              controller_.adopt_persisted_targets(
                  updated, static_cast<std::uint32_t>(uptime_ms));
  }
  if (!adopted) {
    return error_response(500, "internal_error",
                          "Persisted targets could not be acknowledged.");
  }
  return json_response(200, serialize_targets(updated));
}

HttpResponse FirmwareApi::update_mode(const std::string& body,
                                      std::uint64_t uptime_ms) {
  control::ControlMode mode{};
  if (!parse_mode(body, mode)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  enum class Result {
    kOk,
    kFault,
    kWorkflowActive,
    kCalibrationActive,
    kFailed,
  };
  Result result = Result::kOk;
  control::ControlMode acknowledged{};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    if (controller_.temperature_calibration_active()) {
      controller_.abort_temperature_calibration(
          static_cast<std::uint32_t>(uptime_ms));
      result = Result::kCalibrationActive;
    } else if (controller_.has_fault()) {
      result = Result::kFault;
    } else if (mode == control::ControlMode::kSteam &&
               (extraction_controller_.active() ||
                cooldown_controller_.active())) {
      result = Result::kWorkflowActive;
    } else if (!controller_.set_mode(
                   mode, static_cast<std::uint32_t>(uptime_ms))) {
      result = Result::kFailed;
    } else {
      acknowledged = controller_.mode();
    }
  }
  if (result == Result::kFault) {
    return error_response(
        409, "sensor_unavailable",
        "Mode cannot be changed while a machine fault is latched.");
  }
  if (result == Result::kWorkflowActive) {
    return error_response(
        409, "sensor_unavailable",
        "Steam mode is unavailable while extraction or cooldown is active.");
  }
  if (result == Result::kCalibrationActive) {
    return error_response(
        409, "temperature_calibration_active",
        "Temperature calibration was cancelled before changing mode.");
  }
  if (result == Result::kFailed) {
    return error_response(500, "internal_error",
                          "The control mode could not be changed safely.");
  }
  return json_response(200, serialize_mode(acknowledged));
}

HttpResponse FirmwareApi::update_heater(const std::string& body,
                                        std::uint64_t uptime_ms) {
  bool enabled = false;
  if (!parse_heater_enabled(body, enabled)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  bool updated = false;
  bool acknowledged = false;
  bool calibration_conflict = false;
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    if (controller_.temperature_calibration_active()) {
      controller_.abort_temperature_calibration(
          static_cast<std::uint32_t>(uptime_ms));
      calibration_conflict = true;
    } else {
      updated = controller_.set_heater_enabled(
          enabled, static_cast<std::uint32_t>(uptime_ms));
      acknowledged = controller_.heater_enabled_permission();
    }
  }
  if (calibration_conflict) {
    return error_response(
        409, "temperature_calibration_active",
        "Temperature calibration was cancelled before changing heater permission.");
  }
  if (!updated) {
    return error_response(500, "internal_error",
                          "The heater permission could not be changed safely.");
  }
  return json_response(200, serialize_heater_enabled(acknowledged));
}

HttpResponse FirmwareApi::dismiss_over_temperature(std::uint64_t uptime_ms) {
  bool dismissed = false;
  control::ControlSnapshot snapshot{};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    dismissed = controller_.dismiss_over_temperature(
        static_cast<std::uint32_t>(uptime_ms));
    snapshot = controller_.snapshot(static_cast<std::uint32_t>(uptime_ms));
  }
  if (!dismissed) {
    return error_response(
        409, "sensor_unavailable",
        "Over-temperature can only be dismissed after the active temperature returns to target.");
  }
  return json_response(200, serialize_state(snapshot, uptime_ms));
}

HttpResponse FirmwareApi::state_v2(const std::string& query,
                                   std::uint64_t uptime_ms) const {
  if (!query.empty()) {
    return error_response(400, "malformed_request",
                          "The state query is malformed.");
  }
  control::ControlSnapshot machine{};
  control::ExtractionSnapshot extraction{};
  control::CooldownSnapshot cooldown{};
  bool compensation_active = false;
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    const auto now_ms = static_cast<std::uint32_t>(uptime_ms);
    extraction = extraction_controller_.snapshot(now_ms);
    cooldown = cooldown_controller_.snapshot(now_ms);
    machine = controller_.snapshot(now_ms);
    compensation_active = controller_.extraction_compensation_active();
  }
  const auto serialized_machine = serialize_state(machine, uptime_ms);
  const auto serialized_extraction = serialize_extraction(extraction);
  const auto compensation =
      serialize_compensation(compensation_active, extraction);
  const auto serialized_cooldown = serialize_cooldown(cooldown);
  std::string response;
  response.reserve(64U + serialized_machine.size() +
                   serialized_extraction.size() + compensation.size() +
                   serialized_cooldown.size());
  response.append("{\"machine\":");
  response.append(serialized_machine);
  response.append(",\"extraction\":");
  response.append(serialized_extraction);
  response.append(",\"compensation\":");
  response.append(compensation);
  response.append(",\"cooldown\":");
  response.append(serialized_cooldown);
  response.push_back('}');
  return json_response(200, std::move(response));
}

HttpResponse FirmwareApi::scale(std::uint64_t uptime_ms) const {
  if (scale_controller_ == nullptr) {
    return error_response(500, "internal_error", "Scale support is unavailable.");
  }
  control::ScaleSnapshot current{};
  control::WeightExtractionSnapshot weight{};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Scale synchronization failed.");
    }
    const auto now_ms = static_cast<std::uint32_t>(uptime_ms);
    current = scale_controller_->snapshot(now_ms);
    weight = extraction_controller_.weight_snapshot(current, now_ms);
  }
  return json_response(200, serialize_scale(current, weight));
}

HttpResponse FirmwareApi::scale_trace(const std::string& query,
                                      std::uint64_t uptime_ms) const {
  if (scale_controller_ == nullptr || weighted_trace_ == nullptr) {
    return error_response(500, "internal_error",
                          "Scale trace support is unavailable.");
  }
  WeightedTraceCursor cursor{};
  if (!parse_weighted_trace_cursor(query, cursor)) {
    return error_response(400, "malformed_request",
                          "The scale trace cursor is malformed.");
  }
  control::ScaleSnapshot current{};
  control::WeightExtractionSnapshot weight{};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Scale synchronization failed.");
    }
    const auto now_ms = static_cast<std::uint32_t>(uptime_ms);
    current = scale_controller_->snapshot(now_ms);
    weight = extraction_controller_.weight_snapshot(current, now_ms);
  }
  WeightedTracePage page{};
  const bool has_page = weighted_trace_->page(cursor, uptime_ms, page);
  if (cursor.supplied && !has_page && weighted_trace_->has_trace()) {
    return error_response(400, "malformed_request",
                          "The scale trace cursor is outside the retained trace.");
  }
  std::string response{"{\"scale\":"};
  response.append(serialize_scale(current, weight));
  response.append(",\"trace\":");
  if (has_page) {
    response.append(serialize_weighted_trace_page(identity_.device_id, page));
  } else {
    response.append("null");
  }
  response.push_back('}');
  return json_response(200, std::move(response));
}

HttpResponse FirmwareApi::start_scale_calibration(std::uint64_t uptime_ms) {
  if (scale_controller_ == nullptr) {
    return error_response(500, "internal_error", "Scale support is unavailable.");
  }
  ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
  if (!lock.locked()) {
    return error_response(500, "internal_error",
                          "Scale synchronization failed.");
  }
  if (controller_.temperature_calibration_active()) {
    controller_.abort_temperature_calibration(
        static_cast<std::uint32_t>(uptime_ms));
    lock.unlock();
    return error_response(
        409, "temperature_calibration_active",
        "Temperature calibration was cancelled before starting scale calibration.");
  }
  const auto result = scale_controller_->start_calibration(
      extraction_controller_.active() || cooldown_controller_.active(),
      static_cast<std::uint32_t>(uptime_ms));
  if (result != control::ScaleCalibrationResult::kOk) {
    lock.unlock();
    return error_response(
        409,
        result == control::ScaleCalibrationResult::kWorkflowActive
            ? "extraction_active"
            : result == control::ScaleCalibrationResult::kUnavailable
                  ? "scale_unavailable"
                  : result == control::ScaleCalibrationResult::kAdoptionPending
                        ? "calibration_in_progress"
                        : "scale_not_stable",
        result == control::ScaleCalibrationResult::kWorkflowActive
            ? "Scale calibration requires all workflows to be idle."
            : result == control::ScaleCalibrationResult::kUnavailable
                  ? "The scale is unavailable."
                  : result == control::ScaleCalibrationResult::kAdoptionPending
                        ? "Persisted scale calibration is awaiting acknowledgement."
                        : "The scale must be stable before calibration.");
  }
  const auto current =
      scale_controller_->snapshot(static_cast<std::uint32_t>(uptime_ms));
  const auto weight = extraction_controller_.weight_snapshot(
      current, static_cast<std::uint32_t>(uptime_ms));
  lock.unlock();
  return json_response(
      200, serialize_scale(current, weight));
}

HttpResponse FirmwareApi::complete_scale_calibration(
    const std::string& body, std::uint64_t uptime_ms) {
  std::int32_t reference_decigrams = 0;
  if (!parse_scale_calibration_complete(body, reference_decigrams)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  if (scale_controller_ == nullptr) {
    return error_response(500, "internal_error", "Scale support is unavailable.");
  }
  control::ScaleCalibrationTransaction transaction{};
  control::ScaleCalibrationResult result{};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Scale synchronization failed.");
    }
    result = scale_controller_->prepare_calibration_completion(
        reference_decigrams,
        extraction_controller_.active() || cooldown_controller_.active(),
        static_cast<std::uint32_t>(uptime_ms), transaction);
  }
  if (result != control::ScaleCalibrationResult::kOk) {
    const char* code =
        result == control::ScaleCalibrationResult::kUnavailable
            ? "scale_unavailable"
            : result == control::ScaleCalibrationResult::kUnstable
                  ? "scale_not_stable"
                  : result == control::ScaleCalibrationResult::kWorkflowActive
                        ? "extraction_active"
                        : result == control::ScaleCalibrationResult::kInvalidReference
                              ? "malformed_request"
                              : "calibration_in_progress";
    return error_response(
        result == control::ScaleCalibrationResult::kInvalidReference ? 400 : 409,
        code,
        "Scale calibration cannot be completed in its current state.");
  }
  if (!scale_calibration_storage_.save(transaction.candidate)) {
    {
      ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
      if (lock.locked()) {
        scale_controller_->calibration_persistence_failed(transaction.token);
      }
    }
    return error_response(500, "persistence_failure",
                          "Scale calibration could not be persisted.");
  }
  control::ScaleSnapshot current{};
  control::WeightExtractionSnapshot weight{};
  bool adopted = false;
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
    if (lock.locked()) {
      adopted = scale_controller_->adopt_persisted_calibration(transaction);
      if (adopted) {
        const auto now_ms = static_cast<std::uint32_t>(uptime_ms);
        current = scale_controller_->snapshot(now_ms);
        weight = extraction_controller_.weight_snapshot(current, now_ms);
      }
    }
  }
  if (!adopted) {
    return error_response(
        500, "internal_error",
        "Persisted scale calibration could not be acknowledged.");
  }
  return json_response(
      200, serialize_scale(current, weight));
}

HttpResponse FirmwareApi::cancel_scale_calibration(std::uint64_t uptime_ms) {
  if (scale_controller_ == nullptr) {
    return error_response(500, "internal_error", "Scale support is unavailable.");
  }
  ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
  if (!lock.locked()) {
    return error_response(500, "internal_error",
                          "Scale synchronization failed.");
  }
  scale_controller_->cancel_calibration();
  const auto current =
      scale_controller_->snapshot(static_cast<std::uint32_t>(uptime_ms));
  const auto weight = extraction_controller_.weight_snapshot(
      current, static_cast<std::uint32_t>(uptime_ms));
  lock.unlock();
  return json_response(
      200, serialize_scale(current, weight));
}

HttpResponse FirmwareApi::acknowledge_scale_warning(
    std::uint64_t uptime_ms) {
  if (scale_controller_ == nullptr) {
    return error_response(500, "internal_error", "Scale support is unavailable.");
  }
  ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
  if (!lock.locked()) {
    return error_response(500, "internal_error",
                          "Scale synchronization failed.");
  }
  extraction_controller_.acknowledge_scale_warning();
  const auto current =
      scale_controller_->snapshot(static_cast<std::uint32_t>(uptime_ms));
  const auto weight = extraction_controller_.weight_snapshot(
      current, static_cast<std::uint32_t>(uptime_ms));
  lock.unlock();
  return json_response(
      200, serialize_scale(current, weight));
}

HttpResponse FirmwareApi::start_extraction(const std::string& body,
                                           std::uint64_t uptime_ms) {
  std::string key;
  control::ExtractionSelection selection{};
  control::WeightControl weight_control{};
  bool weighted = false;
  if (!parse_start(body, key, selection, weight_control, weighted)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
  if (!lock.locked()) {
    return error_response(500, "internal_error",
                          "Extraction control synchronization failed.");
  }
  const auto now_ms = static_cast<std::uint32_t>(uptime_ms);
  if (controller_.temperature_calibration_active()) {
    controller_.abort_temperature_calibration(now_ms);
    lock.unlock();
    return error_response(
        409, "temperature_calibration_active",
        "Temperature calibration was cancelled before starting extraction.");
  }
  const control::WeightControl* requested_weight =
      weighted ? &weight_control : nullptr;
  control::ScaleSnapshot scale_snapshot{};
  const control::ScaleSnapshot* requested_scale = nullptr;
  if (scale_controller_ != nullptr) {
    scale_snapshot = scale_controller_->snapshot(now_ms);
  }
  if (weighted && scale_controller_ != nullptr) {
    requested_scale = &scale_snapshot;
  }
  const auto replay_before_update =
      extraction_controller_.replay_status(key, selection, requested_weight);
  if (cooldown_controller_.active()) {
    if (replay_before_update == control::ExtractionReplayStatus::kMatch) {
      const auto snapshot = extraction_controller_.snapshot(now_ms);
      lock.unlock();
      return json_response(
          200, serialize_extraction(snapshot));
    }
    if (replay_before_update == control::ExtractionReplayStatus::kMismatch) {
      lock.unlock();
      return error_response(
          409, "idempotency_mismatch",
          "The idempotency key was already used with a different selection.");
    }
    const auto cooldown = cooldown_controller_.snapshot(now_ms);
    lock.unlock();
    return cooldown_conflict(
        cooldown,
        "Extraction cannot start while cooldown is active.");
  }
  switch (extraction_controller_.replay_status(
      key, selection, requested_weight)) {
    case control::ExtractionReplayStatus::kMatch: {
      const auto snapshot = extraction_controller_.snapshot(now_ms);
      lock.unlock();
      return json_response(200, serialize_extraction(snapshot));
    }
    case control::ExtractionReplayStatus::kMismatch:
      lock.unlock();
      return error_response(
          409, "idempotency_mismatch",
          "The idempotency key was already used with a different selection.");
    case control::ExtractionReplayStatus::kNone: break;
  }
  if (controller_.mode() != control::ControlMode::kBrew) {
    lock.unlock();
    return error_response(
        409, "brew_mode_required",
        "Extraction can start only while Brew mode is acknowledged.");
  }
  const auto result = extraction_controller_.start(
      key, selection, now_ms, requested_weight, requested_scale);
  const auto snapshot = extraction_controller_.snapshot(now_ms);
  if (result == control::StartExtractionResult::kOutputFailure) {
    controller_.latch_fault(control::FaultCode::kInternalError);
  }
  lock.unlock();
  switch (result) {
    case control::StartExtractionResult::kStarted:
    case control::StartExtractionResult::kReplay:
      return json_response(200, serialize_extraction(snapshot));
    case control::StartExtractionResult::kConflict:
      return extraction_conflict(snapshot,
                                 "A different extraction is already active.");
    case control::StartExtractionResult::kIdempotencyMismatch:
      return error_response(
          409, "idempotency_mismatch",
          "The idempotency key was already used with a different selection.");
    case control::StartExtractionResult::kInvalidRequest:
      return error_response(400, "malformed_request", kMalformedMessage);
    case control::StartExtractionResult::kOutputFailure:
      return error_response(500, "internal_error",
                            "The pump command could not be started safely.");
    case control::StartExtractionResult::kScaleNotCalibrated:
      return error_response(409, "scale_not_calibrated",
                            "Calibrate the scale before weighted extraction.");
    case control::StartExtractionResult::kScaleNotStable:
      return error_response(409, "scale_not_stable",
                            "The scale must be stable for automatic tare.");
    case control::StartExtractionResult::kScaleUnavailable:
      return error_response(409, "scale_unavailable",
                            "The scale is unavailable.");
    case control::StartExtractionResult::kScaleWarningUnacknowledged:
      return error_response(
          409, "scale_warning_unacknowledged",
          "Acknowledge the scale fallback warning before another weighted extraction.");
  }
  return error_response(500, "internal_error",
                        "The extraction command failed.");
}

HttpResponse FirmwareApi::stop_extraction(std::uint64_t uptime_ms) {
  ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
  if (!lock.locked()) {
    return error_response(500, "internal_error",
                          "Extraction control synchronization failed.");
  }
  if (cooldown_controller_.active()) {
    lock.unlock();
    return json_response(200, serialize_extraction({}));
  }
  if (!extraction_controller_.stop(static_cast<std::uint32_t>(uptime_ms))) {
    controller_.latch_fault(control::FaultCode::kInternalError);
    lock.unlock();
    return error_response(500, "internal_error",
                          "The pump off command could not be completed.");
  }
  const auto snapshot = extraction_controller_.snapshot(
      static_cast<std::uint32_t>(uptime_ms));
  lock.unlock();
  return json_response(200, serialize_extraction(snapshot));
}

HttpResponse FirmwareApi::start_cooldown(const std::string& body,
                                         std::uint64_t uptime_ms) {
  std::string key;
  if (!parse_cooldown_start(body, key)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
  if (!lock.locked()) {
    return error_response(500, "internal_error",
                          "Workflow control synchronization failed.");
  }
  const auto now_ms = static_cast<std::uint32_t>(uptime_ms);
  if (controller_.temperature_calibration_active()) {
    controller_.abort_temperature_calibration(now_ms);
    lock.unlock();
    return error_response(
        409, "temperature_calibration_active",
        "Temperature calibration was cancelled before starting cooldown.");
  }
  const auto result = cooldown_controller_.start(
      key, current_cooldown_input(controller_, extraction_controller_), now_ms);
  const auto cooldown = cooldown_controller_.snapshot(now_ms);
  const auto extraction = extraction_controller_.snapshot(now_ms);
  lock.unlock();
  switch (result) {
    case control::StartCooldownResult::kStarted:
    case control::StartCooldownResult::kReplay:
      return json_response(200, serialize_cooldown(cooldown));
    case control::StartCooldownResult::kConflict:
      return cooldown_conflict(cooldown,
                               "A different cooldown is already active.");
    case control::StartCooldownResult::kExtractionActive:
      return extraction_conflict(
          extraction,
          "Cooldown cannot start while extraction is active.");
    case control::StartCooldownResult::kSensorUnavailable:
      return error_response(
          409, "sensor_unavailable",
          "Cooldown requires a valid boiler temperature reading.");
    case control::StartCooldownResult::kMachineFault:
      return error_response(
          409, "machine_faulted",
          "Cooldown cannot start while a machine fault is latched.");
    case control::StartCooldownResult::kNotRequired:
      return error_response(
          409, "cooldown_not_required",
          "The Brew-effective temperature must be above the current Brew target.");
    case control::StartCooldownResult::kInvalidRequest:
      return error_response(400, "malformed_request", kMalformedMessage);
    case control::StartCooldownResult::kOutputFailure:
      return error_response(500, "internal_error",
                            "Cooldown outputs could not be started safely.");
  }
  return error_response(500, "internal_error",
                        "The cooldown command failed.");
}

HttpResponse FirmwareApi::stop_cooldown(std::uint64_t uptime_ms) {
  ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
  if (!lock.locked()) {
    return error_response(500, "internal_error",
                          "Workflow control synchronization failed.");
  }
  const auto now_ms = static_cast<std::uint32_t>(uptime_ms);
  const auto result = cooldown_controller_.stop(now_ms);
  const auto cooldown = cooldown_controller_.snapshot(now_ms);
  lock.unlock();
  if (result == control::CooldownUpdateResult::kFailed) {
    return error_response(500, "internal_error",
                          "The cooldown off commands could not be completed.");
  }
  return json_response(200, serialize_cooldown(cooldown));
}

}  // namespace philcoino::networking
