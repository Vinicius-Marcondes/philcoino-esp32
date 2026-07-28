#include "philcoino/api_codec.hpp"

#include <cmath>
#include <iomanip>
#include <locale>
#include <sstream>
#include <vector>

#include "philcoino/api_json.hpp"

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

float json_temperature(float temperature_c) {
  return std::isfinite(temperature_c) ? temperature_c : 0.0F;
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
  output << ",\"uptimeMs\":" << uptime_ms << '}';
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
      if (field.value.number < 85.0 || field.value.number > 95.0) {
        candidate_constraint_violation = true;
      } else {
        candidate.brew_c = static_cast<std::int32_t>(field.value.number);
      }
    } else if (field.value.number < 110.0 || field.value.number > 120.0) {
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

}  // namespace philcoino::networking::codec
