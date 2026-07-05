#include "philcoino/api.hpp"

#include <cmath>
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <iomanip>
#include <locale>
#include <sstream>
#include <utility>
#include <vector>

namespace philcoino::networking {
namespace {

constexpr char kMalformedMessage[] = "The JSON request body is malformed.";

struct JsonValue {
  enum class Type { kString, kNumber, kOther };
  Type type{Type::kOther};
  std::string string;
  double number{0.0};
};

struct JsonField {
  std::string key;
  JsonValue value;
};

class JsonObjectParser {
 public:
  explicit JsonObjectParser(const std::string& input) : input_(input) {}

  bool parse(std::vector<JsonField>& fields) {
    skip_whitespace();
    if (!take('{')) {
      return false;
    }
    skip_whitespace();
    if (take('}')) {
      skip_whitespace();
      return at_end();
    }
    while (true) {
      JsonField field;
      if (!parse_string(field.key)) {
        return false;
      }
      for (const auto& existing : fields) {
        if (existing.key == field.key) {
          return false;
        }
      }
      skip_whitespace();
      if (!take(':')) {
        return false;
      }
      skip_whitespace();
      if (!parse_value(field.value)) {
        return false;
      }
      fields.push_back(std::move(field));
      skip_whitespace();
      if (take('}')) {
        skip_whitespace();
        return at_end();
      }
      if (!take(',')) {
        return false;
      }
      skip_whitespace();
    }
  }

 private:
  bool parse_value(JsonValue& value) {
    if (current() == '"') {
      value.type = JsonValue::Type::kString;
      return parse_string(value.string);
    }
    if (current() == '-' || (current() >= '0' && current() <= '9')) {
      value.type = JsonValue::Type::kNumber;
      return parse_number(value.number);
    }
    value.type = JsonValue::Type::kOther;
    return consume_literal("true") || consume_literal("false") ||
           consume_literal("null") || consume_composite();
  }

  bool parse_string(std::string& output) {
    if (!take('"')) {
      return false;
    }
    while (!at_end()) {
      const char character = input_[position_++];
      if (character == '"') {
        return true;
      }
      if (static_cast<unsigned char>(character) < 0x20U) {
        return false;
      }
      if (character != '\\') {
        output.push_back(character);
        continue;
      }
      if (at_end()) {
        return false;
      }
      const char escaped = input_[position_++];
      switch (escaped) {
        case '"': output.push_back('"'); break;
        case '\\': output.push_back('\\'); break;
        case '/': output.push_back('/'); break;
        case 'b': output.push_back('\b'); break;
        case 'f': output.push_back('\f'); break;
        case 'n': output.push_back('\n'); break;
        case 'r': output.push_back('\r'); break;
        case 't': output.push_back('\t'); break;
        case 'u':
          if (!parse_ascii_unicode(output)) {
            return false;
          }
          break;
        default: return false;
      }
    }
    return false;
  }

  bool parse_ascii_unicode(std::string& output) {
    if (position_ + 4 > input_.size()) {
      return false;
    }
    unsigned value = 0;
    for (int index = 0; index < 4; ++index) {
      const char digit = input_[position_++];
      value <<= 4U;
      if (digit >= '0' && digit <= '9') {
        value |= static_cast<unsigned>(digit - '0');
      } else if (digit >= 'a' && digit <= 'f') {
        value |= static_cast<unsigned>(digit - 'a' + 10);
      } else if (digit >= 'A' && digit <= 'F') {
        value |= static_cast<unsigned>(digit - 'A' + 10);
      } else {
        return false;
      }
    }
    if (value > 0x7FU || value == 0) {
      return false;
    }
    output.push_back(static_cast<char>(value));
    return true;
  }

  bool parse_number(double& output) {
    const std::size_t start = position_;
    take('-');
    if (take('0')) {
      if (current() >= '0' && current() <= '9') {
        return false;
      }
    } else if (!consume_digits()) {
      return false;
    }
    if (take('.')) {
      if (!consume_digits()) {
        return false;
      }
    }
    if (current() == 'e' || current() == 'E') {
      ++position_;
      if (current() == '+' || current() == '-') {
        ++position_;
      }
      if (!consume_digits()) {
        return false;
      }
    }
    const std::string token = input_.substr(start, position_ - start);
    char* end = nullptr;
    output = std::strtod(token.c_str(), &end);
    return end != nullptr && *end == '\0' && std::isfinite(output);
  }

  bool consume_digits() {
    const std::size_t start = position_;
    while (current() >= '0' && current() <= '9') {
      ++position_;
    }
    return position_ > start;
  }

  bool consume_literal(const char* literal) {
    const std::size_t length = std::strlen(literal);
    if (input_.compare(position_, length, literal) != 0) {
      return false;
    }
    position_ += length;
    return true;
  }

  bool consume_composite() {
    const char opening = current();
    const char closing = opening == '[' ? ']' : opening == '{' ? '}' : '\0';
    if (closing == '\0') {
      return false;
    }
    int depth = 0;
    bool in_string = false;
    bool escaped = false;
    while (!at_end()) {
      const char character = input_[position_++];
      if (in_string) {
        if (escaped) {
          escaped = false;
        } else if (character == '\\') {
          escaped = true;
        } else if (character == '"') {
          in_string = false;
        }
        continue;
      }
      if (character == '"') {
        in_string = true;
      } else if (character == opening) {
        ++depth;
      } else if (character == closing && --depth == 0) {
        return true;
      }
    }
    return false;
  }

  void skip_whitespace() {
    while (current() == ' ' || current() == '\n' || current() == '\r' ||
           current() == '\t') {
      ++position_;
    }
  }

  bool take(char expected) {
    if (current() != expected) {
      return false;
    }
    ++position_;
    return true;
  }

  char current() const {
    return at_end() ? '\0' : input_[position_];
  }

  bool at_end() const { return position_ >= input_.size(); }

  const std::string& input_;
  std::size_t position_{0};
};

HttpResponse json_response(int status, std::string body,
                           bool bearer_challenge = false) {
  return {status, std::move(body), bearer_challenge};
}

HttpResponse error_response(int status, const char* code, const char* message,
                            bool bearer_challenge = false) {
  std::ostringstream output;
  output << "{\"error\":{\"code\":\"" << code << "\",\"message\":\""
         << message << "\"}}";
  return json_response(status, output.str(), bearer_challenge);
}

const char* mode_name(control::ControlMode mode) {
  return mode == control::ControlMode::kBrew ? "brew" : "steam";
}

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

std::string serialize_state(const control::ControlSnapshot& snapshot,
                            std::uint64_t uptime_ms) {
  std::ostringstream output;
  output.imbue(std::locale::classic());
  output << std::setprecision(6) << "{\"status\":\""
         << status_name(snapshot.status) << "\",\"activeMode\":\""
         << mode_name(snapshot.mode) << "\",\"brewTemperatureC\":"
         << json_temperature(snapshot.readings.brew.temperature_c)
         << ",\"steamTemperatureC\":"
         << json_temperature(snapshot.readings.steam.temperature_c)
         << ",\"brewTargetC\":"
         << snapshot.targets.brew_c << ",\"steamTargetC\":"
         << snapshot.targets.steam_c << ",\"heaterActive\":"
         << (snapshot.heater_enabled ? "true" : "false") << ",\"fault\":";
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

bool parse_temperatures(const std::string& body,
                        peripherals::TemperatureTargets current,
                        peripherals::TemperatureTargets& updated,
                        bool& constraint_violation) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.empty()) {
    return false;
  }
  updated = current;
  for (const auto& field : fields) {
    if ((field.key != "brewTargetC" && field.key != "steamTargetC") ||
        field.value.type != JsonValue::Type::kNumber) {
      return false;
    }
    if (std::floor(field.value.number) != field.value.number) {
      constraint_violation = true;
      continue;
    }
    if (field.key == "brewTargetC") {
      if (field.value.number < 85.0 || field.value.number > 95.0) {
        constraint_violation = true;
      } else {
        updated.brew_c = static_cast<std::int32_t>(field.value.number);
      }
    } else {
      if (field.value.number < 110.0 || field.value.number > 120.0) {
        constraint_violation = true;
      } else {
        updated.steam_c = static_cast<std::int32_t>(field.value.number);
      }
    }
  }
  if (!peripherals::targets_are_valid(updated)) {
    constraint_violation = true;
  }
  return true;
}

bool parse_mode(const std::string& body, control::ControlMode& mode) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 1 ||
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
    const unsigned supplied_byte = index < supplied_length
                                       ? static_cast<unsigned char>(supplied[index])
                                       : 0U;
    difference |= supplied_byte ^
                  static_cast<unsigned char>(expected_token[index]);
  }
  return valid_scheme && !expected_token.empty() && difference == 0U;
}

FirmwareApi::FirmwareApi(DeviceIdentity identity, std::string bearer_token,
                         control::TemperatureController& controller,
                         peripherals::TargetStorage& target_storage)
    : identity_(std::move(identity)),
      bearer_token_(std::move(bearer_token)),
      controller_(controller),
      target_storage_(target_storage) {}

HttpResponse FirmwareApi::handle(HttpMethod method, const std::string& path,
                                 const char* authorization,
                                 const std::string& body,
                                 std::uint64_t uptime_ms) {
  if (method == HttpMethod::kGet && path == "/healthz") {
    return health(uptime_ms);
  }
  if (method == HttpMethod::kGet && path == "/api/v1/device") {
    return device();
  }

  const bool protected_path =
      (method == HttpMethod::kGet && path == "/api/v1/state") ||
      (method == HttpMethod::kPatch &&
       path == "/api/v1/settings/temperatures") ||
      (method == HttpMethod::kPut && path == "/api/v1/mode");
  if (!protected_path) {
    return error_response(404, "internal_error", "The requested endpoint does not exist.");
  }
  if (!constant_time_bearer_matches(authorization, bearer_token_)) {
    return error_response(401, "unauthorized",
                          "A valid bearer token is required.", true);
  }
  if (method == HttpMethod::kGet) {
    return state(uptime_ms);
  }
  if (method == HttpMethod::kPatch) {
    return update_temperatures(body, uptime_ms);
  }
  return update_mode(body, uptime_ms);
}

HttpResponse FirmwareApi::health(std::uint64_t uptime_ms) const {
  std::ostringstream output;
  output << "{\"status\":\"ok\",\"uptimeMs\":" << uptime_ms << '}';
  return json_response(200, output.str());
}

HttpResponse FirmwareApi::device() const {
  std::ostringstream output;
  output << "{\"deviceId\":\"" << identity_.device_id << "\",\"name\":\""
         << identity_.name << "\",\"model\":\"" << identity_.model
         << "\",\"apiVersion\":\"" << kApiVersion
         << "\",\"firmwareVersion\":\"" << identity_.firmware_version
         << "\"}";
  return json_response(200, output.str());
}

HttpResponse FirmwareApi::state(std::uint64_t uptime_ms) const {
  return json_response(
      200, serialize_state(
               controller_.snapshot(static_cast<std::uint32_t>(uptime_ms)),
               uptime_ms));
}

HttpResponse FirmwareApi::update_temperatures(const std::string& body,
                                              std::uint64_t uptime_ms) {
  peripherals::TemperatureTargets updated{};
  bool constraint_violation = false;
  if (!parse_temperatures(body, controller_.targets(), updated,
                          constraint_violation)) {
    return error_response(400, "malformed_request", kMalformedMessage);
  }
  if (constraint_violation) {
    return error_response(
        400, "temperature_out_of_range",
        "Temperature targets must be whole values within their allowed ranges.");
  }
  if (!controller_.update_targets(updated, target_storage_,
                                  static_cast<std::uint32_t>(uptime_ms))) {
    return error_response(500, "persistence_failure",
                          "Temperature targets could not be persisted.");
  }
  std::ostringstream output;
  output << "{\"brewTargetC\":" << controller_.targets().brew_c
         << ",\"steamTargetC\":" << controller_.targets().steam_c << '}';
  return json_response(200, output.str());
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
  if (!controller_.set_mode(mode, static_cast<std::uint32_t>(uptime_ms))) {
    return error_response(500, "internal_error",
                          "The control mode could not be changed safely.");
  }
  std::ostringstream output;
  output << "{\"mode\":\"" << mode_name(controller_.mode()) << "\"}";
  return json_response(200, output.str());
}

}  // namespace philcoino::networking
