#include "philcoino/api_codec.hpp"

#include <cmath>
#include <iomanip>
#include <locale>
#include <sstream>
#include <vector>

#include "philcoino/api_json.hpp"
#include "philcoino/config.hpp"

namespace philcoino::networking::codec {
namespace {

using JsonField = json::Field;
using JsonObjectParser = json::ObjectParser;
using JsonValue = json::Value;

const char* status_name(control::ControlStatus status) {
  switch (status) {
    case control::ControlStatus::kHeating: return "heating";
    case control::ControlStatus::kReady: return "ready";
    case control::ControlStatus::kFault: return "fault";
  }
  return "fault";
}

const char* temperature_calibration_status_name(
    control::TemperatureCalibrationStatus status) {
  switch (status) {
    case control::TemperatureCalibrationStatus::kUncalibrated:
      return "uncalibrated";
    case control::TemperatureCalibrationStatus::kCalibrating:
      return "calibrating";
    case control::TemperatureCalibrationStatus::kCalibrated:
      return "calibrated";
  }
  return "uncalibrated";
}

float json_temperature(float temperature_c) {
  return std::isfinite(temperature_c) ? temperature_c : 0.0F;
}

bool calibration_id_is_valid(const std::string& value) {
  if (value.size() < 16U || value.size() > 64U) {
    return false;
  }
  for (std::size_t index = 0; index < value.size(); ++index) {
    const char character = value[index];
    const bool alphanumeric =
        (character >= 'A' && character <= 'Z') ||
        (character >= 'a' && character <= 'z') ||
        (character >= '0' && character <= '9');
    if (!alphanumeric &&
        (index == 0U ||
         (character != '.' && character != '_' && character != '~' &&
          character != '-'))) {
      return false;
    }
  }
  return true;
}

void serialize_safe_target_bounds(
    std::ostringstream& output,
    const control::TemperatureSafeTargetBounds& bounds) {
  output << "{\"minimumC\":" << bounds.minimum_c
         << ",\"maximumC\":" << bounds.maximum_c << '}';
}

const char* sensor_name(peripherals::TemperatureSensor sensor) {
  return sensor == peripherals::TemperatureSensor::kBoiler ? "boiler"
                                                            : "steam";
}

}  // namespace

const char* mode_name(control::ControlMode mode) {
  return mode == control::ControlMode::kBrew ? "brew" : "steam";
}

std::string serialize_health(std::uint64_t uptime_ms) {
  std::ostringstream output;
  output << "{\"status\":\"ok\",\"uptimeMs\":" << uptime_ms << '}';
  return output.str();
}

std::string serialize_device(const DeviceIdentity& identity) {
  std::ostringstream output;
  output << "{\"deviceId\":\"" << identity.device_id << "\",\"name\":\""
         << identity.name << "\",\"model\":\"" << identity.model
         << "\",\"apiVersion\":\"" << kApiVersion
         << "\",\"firmwareVersion\":\"" << identity.firmware_version
         << "\"}";
  return output.str();
}

std::string serialize_state(const control::ControlSnapshot& snapshot,
                            std::uint64_t uptime_ms) {
  std::ostringstream output;
  output.imbue(std::locale::classic());
  output << std::setprecision(6) << "{\"status\":\""
         << status_name(snapshot.status) << "\",\"activeMode\":\""
         << mode_name(snapshot.mode) << "\",\"boilerTemperatureC\":";
  if (snapshot.boiler_temperature.status ==
          peripherals::ThermocoupleStatus::kOk &&
      std::isfinite(snapshot.boiler_temperature.temperature_c)) {
    output << snapshot.boiler_temperature.temperature_c;
  } else {
    output << "null";
  }
  output << ",\"steamTemperatureC\":";
  if (snapshot.steam_temperature.status ==
          peripherals::ThermocoupleStatus::kOk &&
      std::isfinite(snapshot.steam_temperature.temperature_c)) {
    output << snapshot.steam_temperature.temperature_c;
  } else {
    output << "null";
  }
  output << ",\"brewTargetC\":" << snapshot.targets.brew_c
         << ",\"steamTargetC\":" << snapshot.targets.steam_c
         << ",\"heaterEnabled\":"
         << (snapshot.heater_enabled_permission ? "true" : "false")
         << ",\"heaterActive\":"
         << (snapshot.heater_enabled ? "true" : "false")
         << ",\"fault\":";
  if (snapshot.fault_active) {
    output << "{\"code\":\"" << control::fault_code_name(snapshot.fault.code)
           << "\",\"message\":\"" << snapshot.fault.message
           << "\",\"sensor\":";
    if (snapshot.fault.sensor_available) {
      output << '"' << sensor_name(snapshot.fault.sensor) << '"';
    } else {
      output << "null";
    }
    output << '}';
  } else {
    output << "null";
  }
  output << ",\"steamTimeoutRemainingMs\":";
  if (snapshot.steam_timeout.active) {
    output << snapshot.steam_timeout.remaining_ms;
  } else {
    output << "null";
  }
  output << ",\"steamReadyTimeoutMs\":"
         << snapshot.steam_control.settings.ready_timeout_ms;
  output << ",\"uptimeMs\":" << uptime_ms << '}';
  return output.str();
}

bool parse_temperatures(const std::string& body,
                        peripherals::TemperatureTargets current,
                        peripherals::TemperatureTargets& updated,
                        bool& constraint_violation) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.empty()) {
    return false;
  }
  peripherals::TemperatureTargets candidate = current;
  bool candidate_constraint_violation = false;
  for (const auto& field : fields) {
    if ((field.key != "brewTargetC" && field.key != "steamTargetC") ||
        field.value.type != JsonValue::Type::kNumber) {
      return false;
    }
    if (std::floor(field.value.number) != field.value.number) {
      candidate_constraint_violation = true;
      continue;
    }
    if (field.key == "brewTargetC") {
      if (field.value.number <
              static_cast<double>(config::kBrewTargetMinimumC) ||
          field.value.number >
              static_cast<double>(config::kBrewTargetMaximumC)) {
        candidate_constraint_violation = true;
      } else {
        candidate.brew_c = static_cast<std::int32_t>(field.value.number);
      }
    } else if (
        field.value.number <
            static_cast<double>(config::kSteamTargetMinimumC) ||
        field.value.number >
            static_cast<double>(config::kSteamTargetMaximumC)) {
      candidate_constraint_violation = true;
    } else {
      candidate.steam_c = static_cast<std::int32_t>(field.value.number);
    }
  }
  if (!peripherals::targets_are_valid(candidate)) {
    candidate_constraint_violation = true;
  }
  constraint_violation = candidate_constraint_violation;
  if (!candidate_constraint_violation) {
    updated = candidate;
  }
  return true;
}

bool parse_mode(const std::string& body, control::ControlMode& mode) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 1U ||
      fields[0].key != "mode" ||
      fields[0].value.type != JsonValue::Type::kString) {
    return false;
  }
  if (fields[0].value.string == "brew") {
    mode = control::ControlMode::kBrew;
    return true;
  }
  if (fields[0].value.string == "steam") {
    mode = control::ControlMode::kSteam;
    return true;
  }
  return false;
}

bool parse_heater_enabled(const std::string& body, bool& enabled) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 1U ||
      fields[0].key != "enabled" ||
      fields[0].value.type != JsonValue::Type::kBoolean) {
    return false;
  }
  enabled = fields[0].value.boolean;
  return true;
}

bool parse_settings(
    const std::string& body,
    peripherals::TemperatureTargets current_targets,
    peripherals::SteamControlSettings current_steam,
    peripherals::TemperatureTargets& updated_targets,
    peripherals::SteamControlSettings& updated_steam,
    bool& has_temperature_settings,
    bool& has_steam_settings,
    bool& constraint_violation) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.empty()) {
    return false;
  }

  std::ostringstream temperatures;
  temperatures.imbue(std::locale::classic());
  temperatures << '{';
  bool first_temperature = true;
  has_temperature_settings = false;
  has_steam_settings = false;
  constraint_violation = false;
  auto parsed_steam = current_steam;
  for (const auto& field : fields) {
    if (field.key == "steamReadyTimeoutMs") {
      if (field.value.type != JsonValue::Type::kNumber ||
          std::floor(field.value.number) != field.value.number ||
          has_steam_settings) {
        return false;
      }
      has_steam_settings = true;
      if (field.value.number < config::kSteamReadyTimeoutMinimumMs ||
          field.value.number > config::kSteamReadyTimeoutMaximumMs) {
        constraint_violation = true;
      } else {
        parsed_steam.ready_timeout_ms =
            static_cast<std::uint32_t>(field.value.number);
      }
      continue;
    }
    if (field.key != "brewTargetC" && field.key != "steamTargetC") {
      return false;
    }
    if (field.value.type != JsonValue::Type::kNumber) {
      return false;
    }
    if (!first_temperature) temperatures << ',';
    first_temperature = false;
    has_temperature_settings = true;
    temperatures << '"' << field.key << "\":" << std::setprecision(17)
                 << field.value.number;
  }
  temperatures << '}';

  bool invalid = false;
  auto parsed_targets = current_targets;
  if (has_temperature_settings &&
      !parse_temperatures(temperatures.str(), current_targets,
                          parsed_targets, invalid)) {
    return false;
  }
  constraint_violation = constraint_violation || invalid ||
                         !peripherals::steam_control_settings_are_valid(
                             parsed_steam);
  if (!constraint_violation) {
    updated_targets = parsed_targets;
    updated_steam = parsed_steam;
  }
  return true;
}

bool parse_temperature_calibration_query(
    const std::string& query, bool& calibration_id_supplied,
    std::string& calibration_id) {
  if (query.empty()) {
    calibration_id_supplied = false;
    calibration_id.clear();
    return true;
  }
  constexpr char prefix[] = "calibrationId=";
  if (query.compare(0, sizeof(prefix) - 1U, prefix) != 0 ||
      query.find('&') != std::string::npos) {
    return false;
  }
  const auto candidate = query.substr(sizeof(prefix) - 1U);
  if (!calibration_id_is_valid(candidate)) {
    return false;
  }
  calibration_id_supplied = true;
  calibration_id = candidate;
  return true;
}

bool parse_temperature_calibration_candidate(
    const std::string& body, std::string& calibration_id,
    std::int32_t& candidate_raw_target_c) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 2U) {
    return false;
  }
  std::string candidate_id;
  std::int32_t candidate_target = 0;
  bool id_seen = false;
  bool target_seen = false;
  for (const auto& field : fields) {
    if (field.key == "calibrationId" &&
        field.value.type == JsonValue::Type::kString) {
      candidate_id = field.value.string;
      id_seen = calibration_id_is_valid(candidate_id);
    } else if (field.key == "candidateRawTargetC" &&
               field.value.type == JsonValue::Type::kNumber &&
               std::floor(field.value.number) == field.value.number &&
               field.value.number >=
                   config::kTemperatureCalibrationCandidateMinimumC &&
               field.value.number <=
                   config::kTemperatureCalibrationCandidateMaximumC) {
      candidate_target =
          static_cast<std::int32_t>(field.value.number);
      target_seen = true;
    } else {
      return false;
    }
  }
  if (!id_seen || !target_seen) {
    return false;
  }
  calibration_id = candidate_id;
  candidate_raw_target_c = candidate_target;
  return true;
}

bool parse_temperature_calibration_session(
    const std::string& body, std::string& calibration_id) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 1U ||
      fields[0].key != "calibrationId" ||
      fields[0].value.type != JsonValue::Type::kString ||
      !calibration_id_is_valid(fields[0].value.string)) {
    return false;
  }
  calibration_id = fields[0].value.string;
  return true;
}

std::string serialize_temperature_calibration(
    const control::TemperatureCalibrationSnapshot& snapshot) {
  std::ostringstream output;
  output.imbue(std::locale::classic());
  output << std::setprecision(6) << "{\"status\":\""
         << temperature_calibration_status_name(snapshot.status)
         << "\",\"sensor\":\"" << sensor_name(snapshot.sensor)
         << "\",\"savedOffsetC\":" << snapshot.saved_offset_c
         << ",\"temperatureRawC\":";
  if (snapshot.temperature_available) {
    output << json_temperature(snapshot.raw_temperature_c);
  } else {
    output << "null";
  }
  output << ",\"temperatureC\":";
  if (snapshot.temperature_available) {
    output << json_temperature(snapshot.effective_temperature_c);
  } else {
    output << "null";
  }
  output << ",\"heaterActive\":"
         << (snapshot.heater_active ? "true" : "false")
         << ",\"ready\":" << (snapshot.ready ? "true" : "false")
         << ",\"safeTargetBounds\":";
  serialize_safe_target_bounds(output, snapshot.safe_target_bounds);
  if (snapshot.status ==
      control::TemperatureCalibrationStatus::kCalibrating) {
    output << ",\"calibrationId\":\"" << snapshot.calibration_id
           << "\",\"candidateRawTargetC\":"
           << snapshot.candidate_raw_target_c
           << ",\"offsetPreviewC\":" << snapshot.offset_preview_c
           << ",\"advisoryStableMs\":" << snapshot.advisory_stable_ms
           << ",\"sessionLeaseRemainingMs\":"
           << snapshot.session_lease_remaining_ms
           << ",\"previewSafeTargetBounds\":";
    serialize_safe_target_bounds(output,
                                 snapshot.preview_safe_target_bounds);
  }
  output << '}';
  return output.str();
}

}  // namespace philcoino::networking::codec
