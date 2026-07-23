#include "philcoino/api_codec.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <sstream>
#include <vector>

#include "philcoino/api_json.hpp"
#include "philcoino/config.hpp"

namespace philcoino::networking::codec {
namespace {

using JsonField = json::Field;
using JsonObjectParser = json::ObjectParser;
using JsonValue = json::Value;

bool integer_seconds(const JsonValue& value, std::uint8_t& output) {
  if (value.type != JsonValue::Type::kNumber ||
      std::floor(value.number) != value.number || value.number < 0.0 ||
      value.number > 60.0) {
    return false;
  }
  output = static_cast<std::uint8_t>(value.number);
  return true;
}

bool integer_in_range(const JsonValue& value, std::int32_t minimum,
                      std::int32_t maximum, std::int32_t& output) {
  if (value.type != JsonValue::Type::kNumber ||
      std::floor(value.number) != value.number ||
      value.number < static_cast<double>(minimum) ||
      value.number > static_cast<double>(maximum)) {
    return false;
  }
  output = static_cast<std::int32_t>(value.number);
  return true;
}

bool parse_weight_control(const std::string& body,
                          control::WeightControl& control) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 2U) {
    return false;
  }
  bool target_seen = false;
  bool compensation_seen = false;
  control::WeightControl candidate{};
  for (const auto& field : fields) {
    if (field.key == "targetWeightDecigrams") {
      target_seen = integer_in_range(
          field.value, config::kScaleTargetMinimumDecigrams,
          config::kScaleTargetMaximumDecigrams,
          candidate.target_decigrams);
    } else if (field.key == "compensationDecigrams") {
      compensation_seen = integer_in_range(
          field.value, 0, config::kScaleCompensationMaximumDecigrams,
          candidate.compensation_decigrams);
    } else {
      return false;
    }
  }
  if (!target_seen || !compensation_seen ||
      !control::weight_control_is_valid(candidate)) {
    return false;
  }
  control = candidate;
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
      main_seen =
          integer_seconds(field.value, profile.main_extraction_seconds);
    } else {
      return false;
    }
  }
  return name_seen && pre_seen && soak_seen && main_seen &&
         peripherals::extraction_profile_is_valid(profile);
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

}  // namespace

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
  if (!json::split_array(root[0].value.string, slots) ||
      slots.size() != profiles.size()) {
    return false;
  }
  peripherals::ExtractionProfiles candidate{};
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
          candidate[index] = {};
          profile_seen = true;
        } else {
          profile_seen = parse_profile(field.value.string, candidate[index]);
        }
      } else {
        return false;
      }
    }
    if (!id_seen || !profile_seen) {
      return false;
    }
  }
  if (!peripherals::extraction_profiles_are_valid(candidate)) {
    return false;
  }
  profiles = candidate;
  return true;
}

bool parse_start(const std::string& body, std::string& idempotency_key,
                 control::ExtractionSelection& selection) {
  control::WeightControl ignored{};
  bool weighted = false;
  return parse_start(body, idempotency_key, selection, ignored, weighted) &&
         !weighted;
}

bool parse_start(const std::string& body, std::string& idempotency_key,
                 control::ExtractionSelection& selection,
                 control::WeightControl& weight_control,
                 bool& weighted) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) ||
      (fields.size() != 2U && fields.size() != 3U)) {
    return false;
  }
  std::string candidate_key;
  std::string selection_body;
  std::string weight_body;
  for (const auto& field : fields) {
    if (field.key == "idempotencyKey" &&
        field.value.type == JsonValue::Type::kString) {
      candidate_key = field.value.string;
    } else if (field.key == "selection" &&
               field.value.type == JsonValue::Type::kOther) {
      selection_body = field.value.string;
    } else if (field.key == "weightControl" &&
               field.value.type == JsonValue::Type::kOther) {
      weight_body = field.value.string;
    } else {
      return false;
    }
  }
  std::vector<JsonField> selection_fields;
  JsonObjectParser selection_parser(selection_body);
  if (candidate_key.empty() || !selection_parser.parse(selection_fields)) {
    return false;
  }
  if (selection_fields.size() == 1U && selection_fields[0].key == "kind" &&
      selection_fields[0].value.type == JsonValue::Type::kString &&
      selection_fields[0].value.string == "manual") {
    if (!weight_body.empty()) {
      return false;
    }
    idempotency_key = candidate_key;
    selection = {control::ExtractionSelectionKind::kManual, 0};
    weighted = false;
    return true;
  }
  if (selection_fields.size() != 2U) {
    return false;
  }
  bool kind_seen = false;
  bool id_seen = false;
  control::ExtractionSelection candidate_selection{};
  for (const auto& field : selection_fields) {
    if (field.key == "kind" && field.value.type == JsonValue::Type::kString) {
      kind_seen = field.value.string == "profile";
    } else if (field.key == "profileId" &&
               field.value.type == JsonValue::Type::kString &&
               field.value.string.size() == 9U &&
               field.value.string.compare(0, 8, "profile-") == 0 &&
               field.value.string[8] >= '1' && field.value.string[8] <= '4') {
      candidate_selection = {
          control::ExtractionSelectionKind::kProfile,
          static_cast<std::size_t>(field.value.string[8] - '1')};
      id_seen = true;
    } else {
      return false;
    }
  }
  if (!kind_seen || !id_seen) {
    return false;
  }
  idempotency_key = candidate_key;
  selection = candidate_selection;
  weighted = !weight_body.empty();
  if (weighted && !parse_weight_control(weight_body, weight_control)) {
    return false;
  }
  return true;
}

bool parse_scale_calibration_complete(const std::string& body,
                                      std::int32_t& reference_decigrams) {
  std::vector<JsonField> fields;
  JsonObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 1U ||
      fields[0].key != "referenceWeightDecigrams") {
    return false;
  }
  return integer_in_range(
      fields[0].value,
      config::kScaleCalibrationReferenceMinimumDecigrams,
      config::kScaleCalibrationReferenceMaximumDecigrams,
      reference_decigrams);
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
  if (fields[0].value.string.empty()) {
    return false;
  }
  idempotency_key = fields[0].value.string;
  return true;
}

std::string serialize_extraction(const control::ExtractionSnapshot& snapshot) {
  if (snapshot.status == control::ExtractionStatus::kIdle &&
      snapshot.extraction_id.empty()) {
    return "{\"status\":\"idle\",\"extractionId\":null,\"selection\":null,\"phase\":\"idle\",\"elapsedMs\":0,\"remainingMs\":null,\"pumpCommand\":\"off\"}";
  }
  std::ostringstream output;
  output << "{\"status\":\""
         << (snapshot.status == control::ExtractionStatus::kRunning
                 ? "running"
                 : "idle")
         << "\",\"extractionId\":\"" << snapshot.extraction_id
         << "\",\"selection\":{";
  if (snapshot.selection.kind == control::ExtractionSelectionKind::kManual) {
    output << "\"kind\":\"manual\"";
  } else {
    output << "\"kind\":\"profile\",\"profileId\":\"profile-"
           << snapshot.selection.profile_index + 1U << "\"";
  }
  output << "},\"phase\":\"" << phase_name(snapshot.phase)
         << "\",\"elapsedMs\":" << snapshot.elapsed_ms
         << ",\"remainingMs\":";
  if (snapshot.status == control::ExtractionStatus::kIdle) {
    output << "null";
  } else {
    output << snapshot.remaining_ms;
  }
  output << ",\"pumpCommand\":\""
         << (snapshot.pump_command == peripherals::PumpCommand::kRunning
                 ? "running"
                 : "off")
         << "\"";
  if (snapshot.status == control::ExtractionStatus::kIdle) {
    const char* outcome = "failed";
    switch (snapshot.outcome) {
      case control::ExtractionOutcome::kCompleted: outcome = "completed"; break;
      case control::ExtractionOutcome::kStopped: outcome = "stopped"; break;
      case control::ExtractionOutcome::kFailed: outcome = "failed"; break;
      case control::ExtractionOutcome::kNone: outcome = "failed"; break;
    }
    output << ",\"outcome\":\"" << outcome << "\"";
  }
  output << '}';
  return output.str();
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
    bool compensation_active,
    const control::ExtractionSnapshot& extraction) {
  const bool supported_phase =
      extraction.phase == control::ExtractionPhase::kManual ||
      extraction.phase == control::ExtractionPhase::kMainExtraction;
  if (!compensation_active || !supported_phase) {
    return "{\"status\":\"inactive\",\"phase\":null}";
  }
  const char* phase = extraction.phase == control::ExtractionPhase::kManual
                          ? "manual"
                          : "main-extraction";
  return std::string("{\"status\":\"active\",\"phase\":\"") + phase +
         "\"}";
}

HttpResponse cooldown_conflict(const control::CooldownSnapshot& cooldown,
                               const char* message) {
  return json_response(
      409,
      std::string("{\"error\":{\"code\":\"cooldown_active\",\"message\":\"") +
          message + "\"},\"activeCooldown\":" + serialize_cooldown(cooldown) +
          '}');
}

HttpResponse extraction_conflict(
    const control::ExtractionSnapshot& extraction, const char* message) {
  return json_response(
      409,
      std::string("{\"error\":{\"code\":\"extraction_active\",\"message\":\"") +
          message + "\"},\"activeExtraction\":" +
          serialize_extraction(extraction) + '}');
}

std::string serialize_profiles(
    const peripherals::ExtractionProfiles& profiles) {
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

std::string serialize_scale(
    const control::ScaleSnapshot& scale,
    const control::WeightExtractionSnapshot& weight) {
  const char* availability =
      scale.availability == control::ScaleAvailability::kReady
          ? "ready"
          : scale.availability == control::ScaleAvailability::kUnstable
                ? "unstable"
                : "unavailable";
  const char* calibration =
      scale.calibration_status == control::ScaleCalibrationStatus::kCalibrated
          ? "calibrated"
          : scale.calibration_status ==
                    control::ScaleCalibrationStatus::kCalibrating
                ? "calibrating"
                : "uncalibrated";
  std::ostringstream output;
  output << "{\"availability\":\"" << availability
         << "\",\"calibrationStatus\":\"" << calibration
         << "\",\"stable\":" << (scale.stable ? "true" : "false")
         << ",\"grossWeightDecigrams\":";
  if (scale.gross_weight_available) {
    output << scale.gross_weight_decigrams;
  } else {
    output << "null";
  }
  output << ",\"netWeightDecigrams\":";
  if (weight.net_weight_available) {
    output << weight.net_weight_decigrams;
  } else {
    output << "null";
  }
  output << ",\"activeExtraction\":";
  if (!weight.active) {
    output << "null";
  } else {
    output << "{\"extractionId\":\"" << weight.extraction_id
           << "\",\"mode\":\""
           << (weight.fallback ? "timer-fallback" : "weight")
           << "\",\"targetWeightDecigrams\":"
           << weight.control.target_decigrams
           << ",\"compensationDecigrams\":"
           << weight.control.compensation_decigrams
           << ",\"cutoffWeightDecigrams\":" << weight.cutoff_decigrams
           << ",\"netWeightDecigrams\":";
    if (weight.net_weight_available) {
      output << weight.net_weight_decigrams;
    } else {
      output << "null";
    }
    output << '}';
  }
  output << ",\"terminalExtraction\":";
  if (!weight.terminal) {
    output << "null";
  } else {
    const char* reason =
        weight.completion_reason ==
                control::WeightCompletionReason::kWeightReached
            ? "weight-reached"
            : weight.completion_reason ==
                      control::WeightCompletionReason::kTimerFallback
                  ? "timer-fallback"
                  : weight.completion_reason ==
                            control::WeightCompletionReason::kStopped
                        ? "stopped"
                        : "safety-cutoff";
    output << "{\"extractionId\":\"" << weight.extraction_id
           << "\",\"targetWeightDecigrams\":"
           << weight.control.target_decigrams
           << ",\"compensationDecigrams\":"
           << weight.control.compensation_decigrams
           << ",\"cutoffWeightDecigrams\":" << weight.cutoff_decigrams
           << ",\"finalWeightDecigrams\":";
    if (weight.net_weight_available) {
      output << weight.net_weight_decigrams;
    } else {
      output << "null";
    }
    output << ",\"settled\":" << (weight.settled ? "true" : "false")
           << ",\"completionReason\":\"" << reason
           << "\",\"fallbackOccurred\":"
           << (weight.fallback ? "true" : "false") << '}';
  }
  output << ",\"warning\":";
  if (weight.warning_active) {
    output << "{\"code\":\"scale_fallback\",\"extractionId\":\""
           << weight.extraction_id << "\",\"acknowledged\":false}";
  } else {
    output << "null";
  }
  output << '}';
  return output.str();
}

}  // namespace philcoino::networking::codec
