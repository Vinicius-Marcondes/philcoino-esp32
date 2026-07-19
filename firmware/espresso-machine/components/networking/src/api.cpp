#include "philcoino/api.hpp"

#include <cstddef>
#include <cstring>
#include <utility>

#include "philcoino/api_codec.hpp"
#include "philcoino/api_routes.hpp"
#include "philcoino/history.hpp"

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
using codec::parse_profiles;
using codec::parse_start;
using codec::parse_temperatures;
using codec::serialize_compensation;
using codec::serialize_cooldown;
using codec::serialize_device;
using codec::serialize_extraction;
using codec::serialize_health;
using codec::serialize_heater_enabled;
using codec::serialize_mode;
using codec::serialize_profiles;
using codec::serialize_state;
using codec::serialize_targets;

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
                         control::ExtractionController& extraction_controller,
                         control::CooldownController& cooldown_controller,
                         peripherals::ProfileStorage& profile_storage,
                         ApiSynchronization& synchronization,
                         HistoryBuffer* history)
    : identity_(std::move(identity)),
      bearer_token_(std::move(bearer_token)),
      controller_(controller),
      target_storage_(target_storage),
      extraction_controller_(extraction_controller),
      cooldown_controller_(cooldown_controller),
      profile_storage_(profile_storage),
      synchronization_(synchronization),
      history_(history) {}

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

  const auto query_separator = path.find('?');
  const std::string query = query_separator == std::string::npos
                                ? std::string{}
                                : path.substr(query_separator + 1U);
  if (route->id != ApiRouteId::kHistory && query_separator != std::string::npos) {
    return error_response(404, "internal_error",
                          "The requested endpoint does not exist.");
  }

  switch (route->id) {
    case ApiRouteId::kHealth: return health(uptime_ms);
    case ApiRouteId::kDevice: return device();
    case ApiRouteId::kTemperatures:
      return update_temperatures(body, uptime_ms);
    case ApiRouteId::kStateV2: return state_v2(uptime_ms);
    case ApiRouteId::kHistory: return history(query, uptime_ms);
    case ApiRouteId::kProfilesGet: return profiles();
    case ApiRouteId::kProfilesPut: return replace_profiles(body, uptime_ms);
    case ApiRouteId::kExtractionStart:
      return start_extraction(body, uptime_ms);
    case ApiRouteId::kExtractionStop: return stop_extraction(uptime_ms);
    case ApiRouteId::kCooldownStart: return start_cooldown(body, uptime_ms);
    case ApiRouteId::kCooldownStop: return stop_cooldown(uptime_ms);
    case ApiRouteId::kStateV1:
    case ApiRouteId::kMode:
    case ApiRouteId::kHeater:
    case ApiRouteId::kDismissOverTemperature: break;
  }

  ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
  if (!lock.locked()) {
    return error_response(500, "internal_error",
                          "Temperature control synchronization failed.");
  }
  switch (route->id) {
    case ApiRouteId::kStateV1: return state(uptime_ms);
    case ApiRouteId::kMode: return update_mode(body, uptime_ms);
    case ApiRouteId::kHeater: return update_heater(body, uptime_ms);
    case ApiRouteId::kDismissOverTemperature:
      return dismiss_over_temperature(uptime_ms);
    default:
      return error_response(404, "internal_error",
                            "The requested endpoint does not exist.");
  }
}

HttpResponse FirmwareApi::health(std::uint64_t uptime_ms) const {
  return json_response(200, serialize_health(uptime_ms));
}

HttpResponse FirmwareApi::device() const {
  return json_response(200, serialize_device(identity_));
}

HttpResponse FirmwareApi::history(const std::string& query,
                                  std::uint64_t uptime_ms) const {
  if (history_ == nullptr) {
    return error_response(500, "internal_error",
                          "Temperature history is unavailable.");
  }
  HistoryCursor cursor{};
  if (!parse_history_cursor(query, cursor)) {
    return error_response(400, "malformed_request",
                          "The history cursor is malformed.");
  }
  HistoryPage page{};
  if (!history_->page(cursor, uptime_ms, page)) {
    return error_response(400, "malformed_request",
                          "The history cursor is outside the current sequence.");
  }
  return json_response(200, serialize_history_page(identity_.device_id, page));
}

HttpResponse FirmwareApi::state(std::uint64_t uptime_ms) const {
  return json_response(
      200, serialize_state(
               controller_.snapshot(static_cast<std::uint32_t>(uptime_ms)),
               uptime_ms));
}

HttpResponse FirmwareApi::update_temperatures(const std::string& body,
                                              std::uint64_t uptime_ms) {
  peripherals::TemperatureTargets current{};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    current = controller_.targets();
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
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    current = controller_.targets();
    if (!parse_temperatures(body, current, updated, constraint_violation) ||
        constraint_violation) {
      return error_response(400, "malformed_request", kMalformedMessage);
    }
    no_change = updated.brew_c == current.brew_c &&
                updated.steam_c == current.steam_c;
    if (!no_change &&
        !controller_.prepare_target_update(
            updated, static_cast<std::uint32_t>(uptime_ms))) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
  }
  if (no_change) {
    return json_response(200, serialize_targets(current));
  }
  if (!target_storage_.save(updated)) {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked() || !controller_.rollback_target_update(
                              static_cast<std::uint32_t>(uptime_ms))) {
      return error_response(
          500, "internal_error",
          "Target persistence failed and safe rollback could not be acknowledged.");
    }
    return error_response(500, "persistence_failure",
                          "Temperature targets could not be persisted.");
  }
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked() || !controller_.adopt_persisted_targets(
                              updated, static_cast<std::uint32_t>(uptime_ms))) {
      return error_response(500, "internal_error",
                            "Persisted targets could not be acknowledged.");
    }
  }
  return json_response(200, serialize_targets(updated));
}

HttpResponse FirmwareApi::update_mode(const std::string& body,
                                      std::uint64_t uptime_ms) {
  control::ControlMode mode{};
  if (!parse_mode(body, mode)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  if (controller_.has_fault()) {
    return error_response(
        409, "sensor_unavailable",
        "Mode cannot be changed while a machine fault is latched.");
  }
  if (mode == control::ControlMode::kSteam &&
      (extraction_controller_.active() || cooldown_controller_.active())) {
    return error_response(
        409, "sensor_unavailable",
        "Steam mode is unavailable while extraction or cooldown is active.");
  }
  if (!controller_.set_mode(mode, static_cast<std::uint32_t>(uptime_ms))) {
    return error_response(500, "internal_error",
                          "The control mode could not be changed safely.");
  }
  return json_response(200, serialize_mode(controller_.mode()));
}

HttpResponse FirmwareApi::update_heater(const std::string& body,
                                        std::uint64_t uptime_ms) {
  bool enabled = false;
  if (!parse_heater_enabled(body, enabled)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  if (!controller_.set_heater_enabled(
          enabled, static_cast<std::uint32_t>(uptime_ms))) {
    return error_response(500, "internal_error",
                          "The heater permission could not be changed safely.");
  }
  return json_response(
      200, serialize_heater_enabled(controller_.heater_enabled_permission()));
}

HttpResponse FirmwareApi::dismiss_over_temperature(std::uint64_t uptime_ms) {
  if (!controller_.dismiss_over_temperature(
          static_cast<std::uint32_t>(uptime_ms))) {
    return error_response(
        409, "sensor_unavailable",
        "Over-temperature can only be dismissed after the active temperature returns to target.");
  }
  return state(uptime_ms);
}

HttpResponse FirmwareApi::state_v2(std::uint64_t uptime_ms) const {
  control::ControlSnapshot machine{};
  control::ExtractionSnapshot extraction{};
  control::CooldownSnapshot cooldown{};
  std::string compensation;
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
    const auto now_ms = static_cast<std::uint32_t>(uptime_ms);
    if (!cooldown_controller_.active()) {
      if (extraction_controller_.update(now_ms) ==
          control::ExtractionUpdateResult::kOutputFailure) {
        controller_.latch_fault(control::FaultCode::kInternalError);
      }
    }
    extraction = extraction_controller_.snapshot(now_ms);
    controller_.set_extraction_phase(
        cooldown_controller_.active() ? control::ExtractionPhase::kIdle
                                      : extraction.phase,
        now_ms);
    if (cooldown_controller_.active()) {
      cooldown_controller_.update(
          current_cooldown_input(controller_, extraction_controller_), now_ms);
    }
    extraction = extraction_controller_.snapshot(now_ms);
    cooldown = cooldown_controller_.snapshot(now_ms);
    machine = controller_.snapshot(now_ms);
    compensation = serialize_compensation(
        controller_.extraction_compensation_active(), extraction);
  }
  return json_response(200, std::string("{\"machine\":") +
                                serialize_state(machine, uptime_ms) +
                                ",\"extraction\":" +
                                serialize_extraction(extraction) +
                                ",\"compensation\":" + compensation +
                                ",\"cooldown\":" +
                                serialize_cooldown(cooldown) + '}');
}

HttpResponse FirmwareApi::profiles() const {
  peripherals::ExtractionProfiles current{};
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Extraction control synchronization failed.");
    }
    current = extraction_controller_.profiles();
  }
  return json_response(200, serialize_profiles(current));
}

HttpResponse FirmwareApi::replace_profiles(const std::string& body,
                                           std::uint64_t uptime_ms) {
  peripherals::ExtractionProfiles replacement{};
  if (!parse_profiles(body, replacement)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
    if (!lock.locked()) {
      return error_response(500, "internal_error",
                            "Extraction control synchronization failed.");
    }
    if (cooldown_controller_.active()) {
      return cooldown_conflict(
          cooldown_controller_.snapshot(
              static_cast<std::uint32_t>(uptime_ms)),
          "Profiles cannot be replaced while cooldown is active.");
    }
    if (extraction_controller_.update(
            static_cast<std::uint32_t>(uptime_ms)) ==
        control::ExtractionUpdateResult::kOutputFailure) {
      controller_.latch_fault(control::FaultCode::kInternalError);
      return error_response(500, "internal_error",
                            "The pump off command could not be confirmed.");
    }
    if (extraction_controller_.active()) {
      return extraction_conflict(
          extraction_controller_.snapshot(
              static_cast<std::uint32_t>(uptime_ms)),
          "Profiles cannot be replaced while extraction is active.");
    }
  }
  if (!profile_storage_.save(replacement)) {
    return error_response(500, "persistence_failure",
                          "The complete profile set could not be persisted.");
  }
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
    if (!lock.locked() ||
        !extraction_controller_.adopt_persisted_profiles(replacement)) {
      return error_response(500, "internal_error",
                            "Persisted profiles could not be acknowledged.");
    }
  }
  return json_response(200, serialize_profiles(replacement));
}

HttpResponse FirmwareApi::start_extraction(const std::string& body,
                                           std::uint64_t uptime_ms) {
  std::string key;
  control::ExtractionSelection selection{};
  if (!parse_start(body, key, selection)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
  if (!lock.locked()) {
    return error_response(500, "internal_error",
                          "Extraction control synchronization failed.");
  }
  const auto now_ms = static_cast<std::uint32_t>(uptime_ms);
  const auto replay_before_update =
      extraction_controller_.replay_status(key, selection);
  if (cooldown_controller_.active()) {
    if (replay_before_update == control::ExtractionReplayStatus::kMatch) {
      return json_response(
          200, serialize_extraction(extraction_controller_.snapshot(now_ms)));
    }
    if (replay_before_update == control::ExtractionReplayStatus::kMismatch) {
      return error_response(
          409, "idempotency_mismatch",
          "The idempotency key was already used with a different selection.");
    }
    return cooldown_conflict(
        cooldown_controller_.snapshot(now_ms),
        "Extraction cannot start while cooldown is active.");
  }
  if (extraction_controller_.update(now_ms) ==
      control::ExtractionUpdateResult::kOutputFailure) {
    controller_.latch_fault(control::FaultCode::kInternalError);
  }
  switch (extraction_controller_.replay_status(key, selection)) {
    case control::ExtractionReplayStatus::kMatch:
      return json_response(
          200, serialize_extraction(extraction_controller_.snapshot(now_ms)));
    case control::ExtractionReplayStatus::kMismatch:
      return error_response(
          409, "idempotency_mismatch",
          "The idempotency key was already used with a different selection.");
    case control::ExtractionReplayStatus::kNone: break;
  }
  if (controller_.mode() != control::ControlMode::kBrew) {
    return error_response(
        409, "brew_mode_required",
        "Extraction can start only while Brew mode is acknowledged.");
  }
  const auto result = extraction_controller_.start(key, selection, now_ms);
  const auto snapshot = extraction_controller_.snapshot(now_ms);
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
    case control::StartExtractionResult::kProfileNotConfigured:
      return error_response(409, "profile_not_configured",
                            "The selected custom profile slot is empty.");
    case control::StartExtractionResult::kInvalidRequest:
      return error_response(400, "malformed_request", kMalformedMessage);
    case control::StartExtractionResult::kOutputFailure:
      controller_.latch_fault(control::FaultCode::kInternalError);
      return error_response(500, "internal_error",
                            "The pump command could not be started safely.");
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
    return json_response(200, serialize_extraction({}));
  }
  if (!extraction_controller_.stop(static_cast<std::uint32_t>(uptime_ms))) {
    controller_.latch_fault(control::FaultCode::kInternalError);
    return error_response(500, "internal_error",
                          "The pump off command could not be completed.");
  }
  return json_response(
      200, serialize_extraction(extraction_controller_.snapshot(
               static_cast<std::uint32_t>(uptime_ms))));
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
  if (cooldown_controller_.active()) {
    cooldown_controller_.update(
        current_cooldown_input(controller_, extraction_controller_), now_ms);
  } else {
    extraction_controller_.update(now_ms);
  }
  const auto result = cooldown_controller_.start(
      key, current_cooldown_input(controller_, extraction_controller_), now_ms);
  const auto cooldown = cooldown_controller_.snapshot(now_ms);
  switch (result) {
    case control::StartCooldownResult::kStarted:
    case control::StartCooldownResult::kReplay:
      return json_response(200, serialize_cooldown(cooldown));
    case control::StartCooldownResult::kConflict:
      return cooldown_conflict(cooldown,
                               "A different cooldown is already active.");
    case control::StartCooldownResult::kExtractionActive:
      return extraction_conflict(
          extraction_controller_.snapshot(now_ms),
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
  if (result == control::CooldownUpdateResult::kFailed) {
    return error_response(500, "internal_error",
                          "The cooldown off commands could not be completed.");
  }
  return json_response(200, serialize_cooldown(cooldown));
}

}  // namespace philcoino::networking
