#include "philcoino/api.hpp"

#include <algorithm>
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
  enum class Type { kString, kNumber, kBoolean, kOther };
  Type type{Type::kOther};
  std::string string;
  double number{0.0};
  bool boolean{false};
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
    if (consume_literal("true")) {
      value.type = JsonValue::Type::kBoolean;
      value.boolean = true;
      return true;
    }
    if (consume_literal("false")) {
      value.type = JsonValue::Type::kBoolean;
      value.boolean = false;
      return true;
    }
    value.type = JsonValue::Type::kOther;
    const std::size_t start = position_;
    if (consume_literal("null") || consume_composite()) {
      value.string = input_.substr(start, position_ - start);
      return true;
    }
    return false;
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
         << mode_name(snapshot.mode) << "\",\"boilerTemperatureC\":"
         << json_temperature(snapshot.boiler_temperature.temperature_c)
         << ",\"brewTargetC\":"
         << snapshot.targets.brew_c << ",\"steamTargetC\":"
         << snapshot.targets.steam_c << ",\"heaterEnabled\":"
         << (snapshot.heater_enabled_permission ? "true" : "false")
         << ",\"heaterActive\":"
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

bool parse_heater_enabled(const std::string& body, bool& enabled) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 1 ||
      fields[0].key != "heaterEnabled" ||
      fields[0].value.type != JsonValue::Type::kBoolean) {
    return false;
  }
  enabled = fields[0].value.boolean;
  return true;
}

class ScopedApiLock {
 public:
  ScopedApiLock(ApiSynchronization& synchronization, ApiDomain domain)
      : synchronization_(synchronization), domain_(domain), locked_(synchronization_.lock(domain_)) {}
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

bool split_json_array(const std::string& input,
                      std::vector<std::string>& elements) {
  if (input.size() < 2U || input.front() != '[' || input.back() != ']') {
    return false;
  }
  std::size_t start = 1U;
  int depth = 0;
  bool in_string = false;
  bool escaped = false;
  for (std::size_t index = 1U; index + 1U < input.size(); ++index) {
    const char value = input[index];
    if (in_string) {
      if (escaped) {
        escaped = false;
      } else if (value == '\\') {
        escaped = true;
      } else if (value == '"') {
        in_string = false;
      }
      continue;
    }
    if (value == '"') {
      in_string = true;
    } else if (value == '{' || value == '[') {
      ++depth;
    } else if (value == '}' || value == ']') {
      --depth;
      if (depth < 0) {
        return false;
      }
    } else if (value == ',' && depth == 0) {
      elements.push_back(input.substr(start, index - start));
      start = index + 1U;
    }
  }
  if (in_string || depth != 0 || start >= input.size() - 1U) {
    return false;
  }
  elements.push_back(input.substr(start, input.size() - 1U - start));
  return true;
}

bool integer_seconds(const JsonValue& value, std::uint8_t& output) {
  if (value.type != JsonValue::Type::kNumber ||
      std::floor(value.number) != value.number || value.number < 0.0 ||
      value.number > 60.0) {
    return false;
  }
  output = static_cast<std::uint8_t>(value.number);
  return true;
}

bool parse_profile(const std::string& body,
                   peripherals::ExtractionProfile& profile) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 4U) {
    return false;
  }
  bool name_seen = false;
  bool pre_seen = false;
  bool soak_seen = false;
  bool main_seen = false;
  profile = {};
  profile.configured = true;
  for (const auto& field : fields) {
    if (field.key == "name" && field.value.type == JsonValue::Type::kString &&
        field.value.string.size() < profile.name.size()) {
      std::copy(field.value.string.begin(), field.value.string.end(),
                profile.name.begin());
      name_seen = true;
    } else if (field.key == "preInfusionSeconds") {
      pre_seen = integer_seconds(field.value, profile.pre_infusion_seconds);
    } else if (field.key == "soakSeconds") {
      soak_seen = integer_seconds(field.value, profile.soak_seconds);
    } else if (field.key == "mainExtractionSeconds") {
      main_seen = integer_seconds(field.value,
                                  profile.main_extraction_seconds);
    } else {
      return false;
    }
  }
  return name_seen && pre_seen && soak_seen && main_seen &&
         peripherals::extraction_profile_is_valid(profile);
}

bool parse_profiles(const std::string& body,
                    peripherals::ExtractionProfiles& profiles) {
  std::vector<JsonField> root;
  JsonObjectParser parser(body);
  if (!parser.parse(root) || root.size() != 1U ||
      root[0].key != "profiles" ||
      root[0].value.type != JsonValue::Type::kOther) {
    return false;
  }
  std::vector<std::string> slots;
  if (!split_json_array(root[0].value.string, slots) ||
      slots.size() != profiles.size()) {
    return false;
  }
  for (std::size_t index = 0; index < slots.size(); ++index) {
    std::vector<JsonField> fields;
    JsonObjectParser slot_parser(slots[index]);
    if (!slot_parser.parse(fields) || fields.size() != 2U) {
      return false;
    }
    bool id_seen = false;
    bool profile_seen = false;
    for (const auto& field : fields) {
      if (field.key == "id" && field.value.type == JsonValue::Type::kString) {
        id_seen = field.value.string ==
                  (std::string("profile-") + std::to_string(index + 1U));
      } else if (field.key == "profile" &&
                 field.value.type == JsonValue::Type::kOther) {
        if (field.value.string == "null") {
          profiles[index] = {};
          profile_seen = true;
        } else {
          profile_seen = parse_profile(field.value.string, profiles[index]);
        }
      } else {
        return false;
      }
    }
    if (!id_seen || !profile_seen) {
      return false;
    }
  }
  return peripherals::extraction_profiles_are_valid(profiles);
}

bool parse_start(const std::string& body, std::string& idempotency_key,
                 control::ExtractionSelection& selection) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 2U) {
    return false;
  }
  std::string selection_body;
  for (const auto& field : fields) {
    if (field.key == "idempotencyKey" &&
        field.value.type == JsonValue::Type::kString) {
      idempotency_key = field.value.string;
    } else if (field.key == "selection" &&
               field.value.type == JsonValue::Type::kOther) {
      selection_body = field.value.string;
    } else {
      return false;
    }
  }
  std::vector<JsonField> selection_fields;
  JsonObjectParser selection_parser(selection_body);
  if (idempotency_key.empty() || !selection_parser.parse(selection_fields)) {
    return false;
  }
  if (selection_fields.size() == 1U && selection_fields[0].key == "kind" &&
      selection_fields[0].value.type == JsonValue::Type::kString &&
      selection_fields[0].value.string == "manual") {
    selection = {control::ExtractionSelectionKind::kManual, 0};
    return true;
  }
  if (selection_fields.size() != 2U) {
    return false;
  }
  bool kind_seen = false;
  bool id_seen = false;
  for (const auto& field : selection_fields) {
    if (field.key == "kind" && field.value.type == JsonValue::Type::kString) {
      kind_seen = field.value.string == "profile";
    } else if (field.key == "profileId" &&
               field.value.type == JsonValue::Type::kString &&
               field.value.string.size() == 9U &&
               field.value.string.compare(0, 8, "profile-") == 0 &&
               field.value.string[8] >= '1' && field.value.string[8] <= '4') {
      selection = {control::ExtractionSelectionKind::kProfile,
                   static_cast<std::size_t>(field.value.string[8] - '1')};
      id_seen = true;
    } else {
      return false;
    }
  }
  return kind_seen && id_seen;
}

bool parse_cooldown_start(const std::string& body,
                          std::string& idempotency_key) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 1U ||
      fields[0].key != "idempotencyKey" ||
      fields[0].value.type != JsonValue::Type::kString) {
    return false;
  }
  idempotency_key = fields[0].value.string;
  return !idempotency_key.empty();
}

const char* phase_name(control::ExtractionPhase phase) {
  switch (phase) {
    case control::ExtractionPhase::kIdle: return "idle";
    case control::ExtractionPhase::kManual: return "manual";
    case control::ExtractionPhase::kPreInfusion: return "pre-infusion";
    case control::ExtractionPhase::kSoak: return "soak";
    case control::ExtractionPhase::kMainExtraction: return "main-extraction";
  }
  return "idle";
}

std::string serialize_extraction(const control::ExtractionSnapshot& snapshot) {
  if (snapshot.status == control::ExtractionStatus::kIdle) {
    return "{\"status\":\"idle\",\"extractionId\":null,\"selection\":null,\"phase\":\"idle\",\"elapsedMs\":0,\"remainingMs\":null,\"pumpCommand\":\"off\"}";
  }
  std::ostringstream output;
  output << "{\"status\":\"running\",\"extractionId\":\""
         << snapshot.extraction_id << "\",\"selection\":{";
  if (snapshot.selection.kind == control::ExtractionSelectionKind::kManual) {
    output << "\"kind\":\"manual\"";
  } else {
    output << "\"kind\":\"profile\",\"profileId\":\"profile-"
           << snapshot.selection.profile_index + 1U << "\"";
  }
  output << "},\"phase\":\"" << phase_name(snapshot.phase)
         << "\",\"elapsedMs\":" << snapshot.elapsed_ms
         << ",\"remainingMs\":" << snapshot.remaining_ms
         << ",\"pumpCommand\":\""
         << (snapshot.pump_command == peripherals::PumpCommand::kRunning
                 ? "running"
                 : "off")
         << "\"}";
  return output.str();
}

const char* cooldown_status_name(control::CooldownStatus status) {
  switch (status) {
    case control::CooldownStatus::kIdle: return "idle";
    case control::CooldownStatus::kPumping: return "pumping";
    case control::CooldownStatus::kStabilizing: return "stabilizing";
  }
  return "idle";
}

const char* cooldown_outcome_name(control::CooldownOutcome outcome) {
  switch (outcome) {
    case control::CooldownOutcome::kTargetReached: return "target-reached";
    case control::CooldownOutcome::kCutoff: return "cutoff";
    case control::CooldownOutcome::kStopped: return "stopped";
    case control::CooldownOutcome::kFailed: return "failed";
    case control::CooldownOutcome::kNone: return "";
  }
  return "";
}

std::string serialize_cooldown(const control::CooldownSnapshot& snapshot) {
  std::ostringstream output;
  output << "{\"status\":\"" << cooldown_status_name(snapshot.status)
         << "\",\"cooldownId\":";
  if (snapshot.cooldown_id.empty()) {
    output << "null,\"brewTargetC\":null";
  } else {
    output << '"' << snapshot.cooldown_id << "\",\"brewTargetC\":"
           << snapshot.brew_target_c;
  }
  output << ",\"elapsedMs\":" << snapshot.elapsed_ms
         << ",\"remainingMs\":";
  if (snapshot.status == control::CooldownStatus::kIdle) {
    output << "null";
  } else {
    output << snapshot.remaining_ms;
  }
  output << ",\"pumpCommand\":\""
         << (snapshot.pump_command == peripherals::PumpCommand::kRunning
                 ? "running"
                 : "off")
         << "\",\"heaterInhibited\":"
         << (snapshot.heater_inhibited ? "true" : "false")
         << ",\"outcome\":";
  if (snapshot.outcome == control::CooldownOutcome::kNone) {
    output << "null";
  } else {
    output << '"' << cooldown_outcome_name(snapshot.outcome) << '"';
  }
  output << '}';
  return output.str();
}

std::string serialize_compensation(
    const control::TemperatureController& controller,
    const control::ExtractionSnapshot& extraction) {
  const bool supported_phase =
      extraction.phase == control::ExtractionPhase::kManual ||
      extraction.phase == control::ExtractionPhase::kMainExtraction;
  if (!controller.extraction_compensation_active() || !supported_phase) {
    return "{\"status\":\"inactive\",\"phase\":null}";
  }
  const char* phase = extraction.phase == control::ExtractionPhase::kManual
                          ? "manual"
                          : "main-extraction";
  return std::string("{\"status\":\"active\",\"phase\":\"") + phase +
         "\"}";
}

control::CooldownInput current_cooldown_input(
    const control::TemperatureController& controller,
    const control::ExtractionController& extraction) {
  float temperature_c = 0.0F;
  const bool sensor_valid =
      controller.brew_effective_temperature(temperature_c);
  return {sensor_valid, controller.has_fault(), extraction.active(),
          temperature_c};
}

HttpResponse cooldown_conflict(const control::CooldownSnapshot& cooldown,
                               const char* message) {
  return json_response(
      409,
      std::string("{\"error\":{\"code\":\"cooldown_active\",\"message\":\"") +
          message + "\"},\"activeCooldown\":" +
          serialize_cooldown(cooldown) + '}');
}

HttpResponse extraction_conflict(
    const control::ExtractionSnapshot& extraction, const char* message) {
  return json_response(
      409,
      std::string("{\"error\":{\"code\":\"extraction_active\",\"message\":\"") +
          message + "\"},\"activeExtraction\":" +
          serialize_extraction(extraction) + '}');
}

std::string serialize_profiles(const peripherals::ExtractionProfiles& profiles) {
  std::ostringstream output;
  output << "{\"profiles\":[";
  for (std::size_t index = 0; index < profiles.size(); ++index) {
    if (index != 0U) {
      output << ',';
    }
    output << "{\"id\":\"profile-" << index + 1U << "\",\"profile\":";
    const auto& profile = profiles[index];
    if (!profile.configured) {
      output << "null";
    } else {
      output << "{\"name\":\"" << profile.name.data()
             << "\",\"preInfusionSeconds\":"
             << static_cast<unsigned>(profile.pre_infusion_seconds)
             << ",\"soakSeconds\":"
             << static_cast<unsigned>(profile.soak_seconds)
             << ",\"mainExtractionSeconds\":"
             << static_cast<unsigned>(profile.main_extraction_seconds) << '}';
    }
    output << '}';
  }
  output << "]}";
  return output.str();
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
                         peripherals::TargetStorage& target_storage,
                         control::ExtractionController& extraction_controller,
                         control::CooldownController& cooldown_controller,
                         peripherals::ProfileStorage& profile_storage,
                         ApiSynchronization& synchronization)
    : identity_(std::move(identity)),
      bearer_token_(std::move(bearer_token)),
      controller_(controller),
      target_storage_(target_storage),
      extraction_controller_(extraction_controller),
      cooldown_controller_(cooldown_controller),
      profile_storage_(profile_storage),
      synchronization_(synchronization) {}

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
      (method == HttpMethod::kPut && path == "/api/v1/mode") ||
      (method == HttpMethod::kPut && path == "/api/v1/heater") ||
      (method == HttpMethod::kPost &&
       path == "/api/v1/faults/over-temperature/dismiss") ||
      (method == HttpMethod::kGet && path == "/api/v2/state") ||
      (method == HttpMethod::kGet && path == "/api/v2/profiles") ||
      (method == HttpMethod::kPut && path == "/api/v2/profiles") ||
      (method == HttpMethod::kPost &&
       path == "/api/v2/extractions/start") ||
      (method == HttpMethod::kPost &&
       path == "/api/v2/extractions/stop") ||
      (method == HttpMethod::kPost &&
       path == "/api/v2/cooldowns/start") ||
      (method == HttpMethod::kPost && path == "/api/v2/cooldowns/stop");
  if (!protected_path) {
    return error_response(404, "internal_error", "The requested endpoint does not exist.");
  }
  if (!constant_time_bearer_matches(authorization, bearer_token_)) {
    return error_response(401, "unauthorized",
                          "A valid bearer token is required.", true);
  }
  if (path == "/api/v2/state") {
    return state_v2(uptime_ms);
  }
  if (path == "/api/v2/profiles" && method == HttpMethod::kGet) {
    return profiles();
  }
  if (path == "/api/v2/profiles") {
    return replace_profiles(body, uptime_ms);
  }
  if (path == "/api/v2/extractions/start") {
    return start_extraction(body, uptime_ms);
  }
  if (path == "/api/v2/extractions/stop") {
    return stop_extraction(uptime_ms);
  }
  if (path == "/api/v2/cooldowns/start") {
    return start_cooldown(body, uptime_ms);
  }
  if (path == "/api/v2/cooldowns/stop") {
    return stop_cooldown(uptime_ms);
  }
  if (method == HttpMethod::kPatch) {
    return update_temperatures(body, uptime_ms);
  }
  ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
  if (!lock.locked()) {
    return error_response(500, "internal_error",
                          "Temperature control synchronization failed.");
  }
  if (method == HttpMethod::kGet) {
    return state(uptime_ms);
  }
  if (method == HttpMethod::kPut && path == "/api/v1/mode") {
    return update_mode(body, uptime_ms);
  }
  if (method == HttpMethod::kPut) {
    return update_heater(body, uptime_ms);
  }
  return dismiss_over_temperature(uptime_ms);
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
  {
    ScopedApiLock lock(synchronization_, ApiDomain::kTemperature);
    if (!lock.locked() || !controller_.prepare_target_update(updated)) {
      return error_response(500, "internal_error",
                            "Temperature control synchronization failed.");
    }
  }
  if (!target_storage_.save(updated)) {
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
  std::ostringstream output;
  output << "{\"brewTargetC\":" << updated.brew_c
         << ",\"steamTargetC\":" << updated.steam_c << '}';
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
  std::ostringstream output;
  output << "{\"mode\":\"" << mode_name(controller_.mode()) << "\"}";
  return json_response(200, output.str());
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
  std::ostringstream output;
  output << "{\"heaterEnabled\":"
         << (controller_.heater_enabled_permission() ? "true" : "false")
         << '}';
  return json_response(200, output.str());
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
      extraction_controller_.update(now_ms);
    }
    extraction = extraction_controller_.snapshot(
        now_ms);
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
    compensation = serialize_compensation(controller_, extraction);
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
    extraction_controller_.update(static_cast<std::uint32_t>(uptime_ms));
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
  if (cooldown_controller_.active()) {
    return cooldown_conflict(
        cooldown_controller_.snapshot(
            static_cast<std::uint32_t>(uptime_ms)),
        "Extraction cannot start while cooldown is active.");
  }
  extraction_controller_.update(static_cast<std::uint32_t>(uptime_ms));
  if (controller_.mode() != control::ControlMode::kBrew) {
    return error_response(
        409, "brew_mode_required",
        "Extraction can start only while Brew mode is acknowledged.");
  }
  const auto result = extraction_controller_.start(
      key, selection, static_cast<std::uint32_t>(uptime_ms));
  const auto snapshot = extraction_controller_.snapshot(
      static_cast<std::uint32_t>(uptime_ms));
  switch (result) {
    case control::StartExtractionResult::kStarted:
    case control::StartExtractionResult::kReplay:
      return json_response(200, serialize_extraction(snapshot));
    case control::StartExtractionResult::kConflict:
      return extraction_conflict(snapshot,
                                 "A different extraction is already active.");
    case control::StartExtractionResult::kProfileNotConfigured:
      return error_response(409, "profile_not_configured",
                            "The selected custom profile slot is empty.");
    case control::StartExtractionResult::kInvalidRequest:
      return error_response(400, "malformed_request", kMalformedMessage);
    case control::StartExtractionResult::kOutputFailure:
      return error_response(500, "internal_error",
                            "The pump command could not be started safely.");
  }
  return error_response(500, "internal_error",
                        "The extraction command failed.");
}

HttpResponse FirmwareApi::stop_extraction(std::uint64_t) {
  ScopedApiLock lock(synchronization_, ApiDomain::kExtraction);
  if (!lock.locked()) {
    return error_response(500, "internal_error",
                          "Extraction control synchronization failed.");
  }
  if (cooldown_controller_.active()) {
    return json_response(200, serialize_extraction({}));
  }
  if (!extraction_controller_.stop()) {
    return error_response(500, "internal_error",
                          "The pump off command could not be completed.");
  }
  return json_response(200, serialize_extraction({}));
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
