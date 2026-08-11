#include <cassert>
#include <cmath>
#include <string>
#include <vector>

#include "philcoino/api_codec.hpp"
#include "philcoino/api_json.hpp"
#include "philcoino/api_routes.hpp"
#include "philcoino/peripherals.hpp"

namespace {

using namespace philcoino::control;
using namespace philcoino::networking;
using namespace philcoino::networking::codec;
using namespace philcoino::peripherals;

void test_generic_json_syntax_boundary() {
  std::vector<json::Field> fields;
  const std::string simple = "{\"text\":\"a\"}";
  json::ObjectParser parser(simple);
  assert(parser.parse(fields));
  assert(fields.size() == 1U);
  assert(fields[0].value.string == "a");

  for (const std::string valid : {
           " {\"text\":\"a\\n\\u0041\"} ",
           "{\"number\":-1.25e+2}", "{\"flag\":true}",
           "{\"nested\":null}",
           "{\"nested\":[{\"x\":1}]}",
           "{\"text\":\"a\",\"number\":1,\"flag\":true,\"nested\":null}"}) {
    std::vector<json::Field> valid_fields;
    json::ObjectParser valid_parser(valid);
    assert(valid_parser.parse(valid_fields));
  }

  for (const std::string invalid : {
           "", "[]", "{\"x\":1,\"x\":2}", "{\"x\":01}",
           "{\"x\":1.}", "{\"x\":1e}", "{\"x\":\"\\u0000\"}",
           "{\"x\":\"\\u0080\"}", "{\"x\":1} trailing"}) {
    std::vector<json::Field> rejected;
    json::ObjectParser invalid_parser(invalid);
    assert(!invalid_parser.parse(rejected));
  }

  std::vector<std::string> elements;
  assert(json::split_array("[{\"x\":[1,2]},{\"y\":\"a,b\"}]",
                           elements));
  assert(elements.size() == 2U);
  assert(!json::split_array("[]", elements));

  const std::string oversized(json::kMaximumInputBytes + 1U, ' ');
  std::vector<json::Field> oversized_fields;
  json::ObjectParser oversized_parser(oversized);
  assert(!oversized_parser.parse(oversized_fields));
  assert(!json::split_array(oversized, elements));
}

void test_machine_request_codecs() {
  const TemperatureTargets current{93, 115};
  TemperatureTargets updated{};
  bool constraint = false;
  assert(parse_temperatures(" { \"steamTargetC\" : 135, \"brewTargetC\" : 85 } ",
                            current, updated, constraint));
  assert(!constraint && updated.brew_c == 85 && updated.steam_c == 135);

  constraint = false;
  assert(parse_temperatures("{\"brewTargetC\":85.5}", current, updated,
                            constraint));
  assert(constraint);
  constraint = false;
  updated = {90, 118};
  assert(!parse_temperatures("{\"brewTargetC\":90,\"extra\":1}", current,
                             updated, constraint));
  assert(updated.brew_c == 90 && updated.steam_c == 118);
  assert(!parse_temperatures("{\"brewTargetC\":90,\"brewTargetC\":91}",
                             current, updated, constraint));

  SteamControlSettings current_steam{12, 720000, 300000};
  SteamControlSettings updated_steam{};
  bool has_targets = false;
  bool has_steam = false;
  constraint = false;
  assert(parse_settings(
      "{\"brewTargetC\":94,\"steamTargetC\":121,"
      "\"steamControl\":{\"initialCompensationC\":10}}",
      current, current_steam, updated, updated_steam, has_targets,
      has_steam, constraint));
  assert(!constraint && has_targets && has_steam);
  assert(updated.brew_c == 94 && updated.steam_c == 121);
  assert(updated_steam.initial_compensation_c == 10);
  assert(!parse_settings(
      "{\"brewTargetC\":94,\"legacy\":true}", current, current_steam,
      updated, updated_steam, has_targets, has_steam, constraint));

  ControlMode mode{};
  assert(parse_mode("{\"mode\":\"brew\"}", mode) &&
         mode == ControlMode::kBrew);
  assert(!parse_mode("{\"mode\":\"cleaning\"}", mode));
  bool enabled = false;
  assert(parse_heater_enabled("{\"enabled\":true}", enabled) &&
         enabled);
  assert(!parse_heater_enabled("{\"enabled\":1}", enabled));

  bool calibration_id_supplied = false;
  std::string calibration_id;
  assert(parse_temperature_calibration_query(
      "", calibration_id_supplied, calibration_id));
  assert(!calibration_id_supplied && calibration_id.empty());
  assert(parse_temperature_calibration_query(
      "calibrationId=temp-cal-01J2ABCDEF",
      calibration_id_supplied, calibration_id));
  assert(calibration_id_supplied &&
         calibration_id == "temp-cal-01J2ABCDEF");
  assert(!parse_temperature_calibration_query(
      "other=temp-cal-01J2ABCDEF",
      calibration_id_supplied, calibration_id));

  std::int32_t candidate_raw_target_c = 0;
  assert(parse_temperature_calibration_candidate(
      "{\"calibrationId\":\"temp-cal-01J2ABCDEF\",\"candidateRawTargetC\":108}",
      calibration_id, candidate_raw_target_c));
  assert(calibration_id == "temp-cal-01J2ABCDEF" &&
         candidate_raw_target_c == 108);
  assert(!parse_temperature_calibration_candidate(
      "{\"calibrationId\":\"short\",\"candidateRawTargetC\":108}",
      calibration_id, candidate_raw_target_c));
  assert(!parse_temperature_calibration_candidate(
      "{\"calibrationId\":\"temp-cal-01J2ABCDEF\",\"candidateRawTargetC\":108.5}",
      calibration_id, candidate_raw_target_c));
  assert(parse_temperature_calibration_session(
      "{\"calibrationId\":\"temp-cal-01J2ABCDEF\"}", calibration_id));
  assert(!parse_temperature_calibration_session(
      "{\"calibrationId\":\"temp-cal-01J2ABCDEF\",\"extra\":true}",
      calibration_id));

  TemperatureCalibrationSnapshot calibration{};
  calibration.status = TemperatureCalibrationStatus::kCalibrating;
  calibration.saved_offset_c = 0;
  calibration.temperature_available = true;
  calibration.raw_temperature_c = 108.0F;
  calibration.effective_temperature_c = 108.0F;
  calibration.calibration_id = "temp-cal-01J2ABCDEF";
  calibration.candidate_raw_target_c = 108;
  calibration.offset_preview_c = -8;
  calibration.advisory_stable_ms = 42000;
  calibration.session_lease_remaining_ms = 15000;
  calibration.safe_target_bounds = {85, 95, 110, 135};
  calibration.preview_safe_target_bounds = {85, 95, 110, 127};
  const auto serialized = serialize_temperature_calibration(calibration);
  assert(serialized.find("\"status\":\"calibrating\"") !=
         std::string::npos);
  assert(serialized.find("\"candidateRawTargetC\":108") !=
         std::string::npos);
  assert(serialized.find("\"offsetPreviewC\":-8") !=
         std::string::npos);
}

void test_workflow_codecs() {
  std::string key;
  ExtractionSelection selection{};
  assert(parse_start(
      "{\"selection\":{\"kind\":\"manual\"},\"idempotencyKey\":\"abcdefghijklmnop\"}",
      key, selection));
  assert(key == "abcdefghijklmnop" &&
         selection.kind == ExtractionSelectionKind::kManual);
  assert(parse_start(
      "{\"idempotencyKey\":\"abcdefghijklmnop\",\"selection\":{\"profileId\":\"profile-4\",\"profile\":{\"name\":\"Classic30\",\"preInfusionSeconds\":0,\"soakSeconds\":0,\"mainExtractionSeconds\":30},\"kind\":\"profile\"}}",
      key, selection));
  assert(selection.kind == ExtractionSelectionKind::kProfile &&
         selection.profile_index == 3U &&
         selection.profile.main_extraction_seconds == 30U);
  assert(!parse_start(
      "{\"idempotencyKey\":\"abcdefghijklmnop\",\"selection\":{\"kind\":\"manual\",\"extra\":true}}",
      key, selection));

  WeightControl weight_control{};
  bool weighted = false;
  assert(parse_start(
      "{\"idempotencyKey\":\"weighted-shot-1\",\"selection\":{\"kind\":\"profile\",\"profileId\":\"profile-2\",\"profile\":{\"name\":\"Pre5Soak5\",\"preInfusionSeconds\":5,\"soakSeconds\":5,\"mainExtractionSeconds\":25}},\"weightControl\":{\"targetWeightDecigrams\":350,\"compensationDecigrams\":20}}",
      key, selection, weight_control, weighted));
  assert(weighted && selection.profile_index == 1U &&
         weight_control.target_decigrams == 350 &&
         weight_control.compensation_decigrams == 20);
  assert(!parse_start(
      "{\"idempotencyKey\":\"weighted-manual\",\"selection\":{\"kind\":\"manual\"},\"weightControl\":{\"targetWeightDecigrams\":350,\"compensationDecigrams\":20}}",
      key, selection, weight_control, weighted));
  assert(!parse_start(
      "{\"idempotencyKey\":\"weighted-invalid\",\"selection\":{\"kind\":\"profile\",\"profileId\":\"profile-2\",\"profile\":{\"name\":\"Pre5Soak5\",\"preInfusionSeconds\":5,\"soakSeconds\":5,\"mainExtractionSeconds\":25}},\"weightControl\":{\"targetWeightDecigrams\":100,\"compensationDecigrams\":100}}",
      key, selection, weight_control, weighted));

  std::int32_t reference_decigrams = 0;
  assert(parse_scale_calibration_complete(
      "{\"referenceWeightDecigrams\":1000}", reference_decigrams));
  assert(reference_decigrams == 1000);
  assert(!parse_scale_calibration_complete(
      "{\"referenceWeightDecigrams\":499}", reference_decigrams));

  key = "unchanged";
  selection = {ExtractionSelectionKind::kProfile, 2U};
  assert(!parse_start(
      "{\"idempotencyKey\":\"abcdefghijklmnop\",\"selection\":{\"kind\":\"invalid\",\"profileId\":\"profile-1\"}}",
      key, selection));
  assert(key == "unchanged" &&
         selection.kind == ExtractionSelectionKind::kProfile &&
         selection.profile_index == 2U);

  assert(parse_cooldown_start(
      "{\"idempotencyKey\":\"abcdefghijklmnop\"}", key));
  key = "unchanged";
  assert(!parse_cooldown_start(
      "{\"idempotencyKey\":\"abcdefghijklmnop\",\"extra\":true}", key));
  assert(key == "unchanged");

  assert(serialize_extraction({}) ==
         "{\"status\":\"idle\",\"extractionId\":null,\"selection\":null,\"phase\":\"idle\",\"elapsedMs\":0,\"remainingMs\":null,\"pumpCommand\":\"off\"}");
  assert(serialize_cooldown({}) ==
         "{\"status\":\"idle\",\"cooldownId\":null,\"brewTargetC\":null,\"elapsedMs\":0,\"remainingMs\":null,\"pumpCommand\":\"off\",\"heaterInhibited\":false,\"outcome\":null}");
  assert(serialize_compensation(false, {}) ==
         "{\"status\":\"inactive\",\"phase\":null}");
}

void test_authoritative_route_matrix() {
  assert(kApiRoutes.size() == 22U);
  std::size_t protected_count = 0;
  for (std::size_t index = 0; index < kApiRoutes.size(); ++index) {
    const auto& route = kApiRoutes[index];
    const std::string concrete_path =
        route.id == ApiRouteId::kPairingSessionAction
            ? "/api/v3/pairing/sessions/0123456789abcdef0123456789abcdef/proof"
            : route.path;
    assert(find_api_route(route.method, concrete_path) == &route);
    protected_count += route.requires_authentication ? 1U : 0U;
    for (std::size_t other = index + 1U; other < kApiRoutes.size(); ++other) {
      assert(route.method != kApiRoutes[other].method ||
             std::string(route.path) != kApiRoutes[other].path);
    }
  }
  assert(protected_count == 19U);
  assert(!request_requires_auth(HttpMethod::kGet, "/healthz"));
  assert(request_requires_auth(HttpMethod::kDelete,
                               "/api/v3/cooldowns/current"));
  assert(request_requires_auth(HttpMethod::kGet, "/api/v3/state"));
  assert(request_requires_auth(
      HttpMethod::kPut, "/api/v3/temperature-calibrations/current"));
  assert(request_requires_auth(
      HttpMethod::kPatch, "/api/v3/settings"));
  assert(find_api_route(HttpMethod::kGet, "/api/v3/state?ignored=true") ==
         find_api_route(HttpMethod::kGet, "/api/v3/state"));
  assert(find_api_route(HttpMethod::kGet, "/api/v1/state") == nullptr);
  assert(find_api_route(HttpMethod::kGet, "/api/v2/state") == nullptr);
  assert(find_api_route(HttpMethod::kPost, "/healthz") == nullptr);
  assert(find_api_route(
             HttpMethod::kPost,
             "/api/v3/pairing/sessions/0123456789abcdef0123456789abcdef/complete") !=
         nullptr);
  assert(find_api_route(
             HttpMethod::kPost,
             "/api/v3/pairing/sessions/not-a-session/proof") == nullptr);
  assert(find_api_route(HttpMethod::kGet, "/unknown") == nullptr);
}

}  // namespace

int main() {
  test_generic_json_syntax_boundary();
  test_machine_request_codecs();
  test_workflow_codecs();
  test_authoritative_route_matrix();
  return 0;
}
