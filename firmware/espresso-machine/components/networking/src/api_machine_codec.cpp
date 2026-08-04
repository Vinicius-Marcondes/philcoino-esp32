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
  output << "{\"brewMinimumC\":" << bounds.brew_minimum_c
         << ",\"brewMaximumC\":" << bounds.brew_maximum_c
         << ",\"steamMinimumC\":" << bounds.steam_minimum_c
         << ",\"steamMaximumC\":" << bounds.steam_maximum_c << '}';
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
         << mode_name(snapshot.mode) << "\",\"boilerTemperatureC\":"
         << json_temperature(snapshot.boiler_temperature.temperature_c)
         << ",\"brewTargetC\":" << snapshot.targets.brew_c
         << ",\"steamTargetC\":" << snapshot.targets.steam_c
         << ",\"heaterEnabled\":"
         << (snapshot.heater_enabled_permission ? "true" : "false")
         << ",\"heaterActive\":"
         << (snapshot.heater_enabled ? "true" : "false")
         << ",\"fault\":";
  if (snapshot.fault_active) {
    output << "{\"code\":\"" << control::fault_code_name(snapshot.fault.code)
           << "\",\"message\":\"" << snapshot.fault.message << "\"}";
  } else {
    output << "null";
  }
  output << ",\"steamTimeoutRemainingMs\":";
  if (snapshot.steam_timeout.active) {
    output << snapshot.steam_timeout.remaining_ms;
  } else {
    output << "null";
  }
  output << ",\"steamControl\":"
         << serialize_steam_control(snapshot.steam_control);
  output << ",\"uptimeMs\":" << uptime_ms << '}';
  return output.str();
}

std::string serialize_steam_control(
    const control::SteamControlSnapshot& snapshot) {
  std::ostringstream output;
  output.imbue(std::locale::classic());
  output << std::setprecision(6)
         << "{\"settings\":{\"initialCompensationC\":"
         << snapshot.settings.initial_compensation_c
         << ",\"decayDurationMs\":" << snapshot.settings.decay_duration_ms
         << ",\"readyTimeoutMs\":" << snapshot.settings.ready_timeout_ms
         << "},\"compensationActive\":"
         << (snapshot.compensation_active ? "true" : "false")
         << ",\"appliedCompensationC\":"
         << snapshot.applied_compensation_c
         << ",\"controlTemperatureC\":";
  if (snapshot.control_temperature_available) {
    output << json_temperature(snapshot.control_temperature_c);
  } else {
    output << "null";
  }
  output << ",\"heatSoakElapsedMs\":";
  if (snapshot.heat_soak_active) {
    output << snapshot.heat_soak_elapsed_ms;
  } else {
    output << "null";
  }
  output << '}';
  return output.str();
}

std::string serialize_targets(peripherals::TemperatureTargets targets) {
  std::ostringstream output;
  output << "{\"brewTargetC\":" << targets.brew_c
         << ",\"steamTargetC\":" << targets.steam_c << '}';
  return output.str();
}

std::string serialize_mode(control::ControlMode mode) {
  return std::string("{\"mode\":\"") + mode_name(mode) + "\"}";
}

std::string serialize_heater_enabled(bool enabled) {
  return std::string("{\"heaterEnabled\":") +
         (enabled ? "true}" : "false}");
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
      fields[0].key != "heaterEnabled" ||
      fields[0].value.type != JsonValue::Type::kBoolean) {
    return false;
  }
  enabled = fields[0].value.boolean;
  return true;
}

bool parse_steam_control_settings(
    const std::string& body,
    peripherals::SteamControlSettings current,
    peripherals::SteamControlSettings& updated,
    bool& constraint_violation) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.empty()) {
    return false;
  }
  auto candidate = current;
  bool invalid = false;
  for (const auto& field : fields) {
    if (field.value.type != JsonValue::Type::kNumber ||
        std::floor(field.value.number) != field.value.number) {
      return false;
    }
    if (field.key == "initialCompensationC") {
      if (field.value.number <
              config::kSteamCompensationInitialMinimumC ||
          field.value.number >
              config::kSteamCompensationInitialMaximumC) {
        invalid = true;
      } else {
        candidate.initial_compensation_c =
            static_cast<std::int32_t>(field.value.number);
      }
    } else if (field.key == "decayDurationMs") {
      if (field.value.number <
              config::kSteamCompensationDecayMinimumMs ||
          field.value.number >
              config::kSteamCompensationDecayMaximumMs) {
        invalid = true;
      } else {
        candidate.decay_duration_ms =
            static_cast<std::uint32_t>(field.value.number);
      }
    } else if (field.key == "readyTimeoutMs") {
      if (field.value.number < config::kSteamReadyTimeoutMinimumMs ||
          field.value.number > config::kSteamReadyTimeoutMaximumMs) {
        invalid = true;
      } else {
        candidate.ready_timeout_ms =
            static_cast<std::uint32_t>(field.value.number);
      }
    } else {
      return false;
    }
  }
  if (!peripherals::steam_control_settings_are_valid(candidate)) {
    invalid = true;
  }
  constraint_violation = invalid;
  if (!invalid) {
    updated = candidate;
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
         << "\",\"savedOffsetC\":" << snapshot.saved_offset_c
         << ",\"boilerTemperatureRawC\":";
  if (snapshot.temperature_available) {
    output << json_temperature(snapshot.raw_temperature_c);
  } else {
    output << "null";
  }
  output << ",\"boilerTemperatureC\":";
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
