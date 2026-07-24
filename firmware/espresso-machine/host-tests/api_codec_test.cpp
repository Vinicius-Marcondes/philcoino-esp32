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
  assert(parse_temperatures(" { \"steamTargetC\" : 120, \"brewTargetC\" : 85 } ",
                            current, updated, constraint));
  assert(!constraint && updated.brew_c == 85 && updated.steam_c == 120);

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

  ControlMode mode{};
  assert(parse_mode("{\"mode\":\"brew\"}", mode) &&
         mode == ControlMode::kBrew);
  assert(!parse_mode("{\"mode\":\"cleaning\"}", mode));
  bool enabled = false;
  assert(parse_heater_enabled("{\"heaterEnabled\":true}", enabled) &&
         enabled);
  assert(!parse_heater_enabled("{\"heaterEnabled\":1}", enabled));
}

void test_workflow_codecs() {
  const auto profiles = default_extraction_profiles();
  const std::string body = serialize_profiles(profiles);
  ExtractionProfiles parsed{};
  assert(parse_profiles(body, parsed));
  assert(serialize_profiles(parsed) == body);

  std::string key;
  ExtractionSelection selection{};
  assert(parse_start(
      "{\"selection\":{\"kind\":\"manual\"},\"idempotencyKey\":\"abcdefghijklmnop\"}",
      key, selection));
  assert(key == "abcdefghijklmnop" &&
         selection.kind == ExtractionSelectionKind::kManual);
  assert(parse_start(
      "{\"idempotencyKey\":\"abcdefghijklmnop\",\"selection\":{\"profileId\":\"profile-4\",\"kind\":\"profile\"}}",
      key, selection));
  assert(selection.kind == ExtractionSelectionKind::kProfile &&
         selection.profile_index == 3U);
  assert(!parse_start(
      "{\"idempotencyKey\":\"abcdefghijklmnop\",\"selection\":{\"kind\":\"manual\",\"extra\":true}}",
      key, selection));

  WeightControl weight_control{};
  bool weighted = false;
  assert(parse_start(
      "{\"idempotencyKey\":\"weighted-shot-1\",\"selection\":{\"kind\":\"profile\",\"profileId\":\"profile-2\"},\"weightControl\":{\"targetWeightDecigrams\":350,\"compensationDecigrams\":20}}",
      key, selection, weight_control, weighted));
  assert(weighted && selection.profile_index == 1U &&
         weight_control.target_decigrams == 350 &&
         weight_control.compensation_decigrams == 20);
  assert(!parse_start(
      "{\"idempotencyKey\":\"weighted-manual\",\"selection\":{\"kind\":\"manual\"},\"weightControl\":{\"targetWeightDecigrams\":350,\"compensationDecigrams\":20}}",
      key, selection, weight_control, weighted));
  assert(!parse_start(
      "{\"idempotencyKey\":\"weighted-invalid\",\"selection\":{\"kind\":\"profile\",\"profileId\":\"profile-2\"},\"weightControl\":{\"targetWeightDecigrams\":100,\"compensationDecigrams\":100}}",
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
  assert(kApiRoutes.size() == 20U);
  std::size_t protected_count = 0;
  for (std::size_t index = 0; index < kApiRoutes.size(); ++index) {
    const auto& route = kApiRoutes[index];
    assert(find_api_route(route.method, route.path) == &route);
    protected_count += route.requires_authentication ? 1U : 0U;
    for (std::size_t other = index + 1U; other < kApiRoutes.size(); ++other) {
      assert(route.method != kApiRoutes[other].method ||
             std::string(route.path) != kApiRoutes[other].path);
    }
  }
  assert(protected_count == 18U);
  assert(!request_requires_auth(HttpMethod::kGet, "/healthz"));
  assert(request_requires_auth(HttpMethod::kPost,
                               "/api/v2/cooldowns/stop"));
  assert(request_requires_auth(HttpMethod::kGet, "/api/v2/scale"));
  assert(find_api_route(HttpMethod::kPost, "/healthz") == nullptr);
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
