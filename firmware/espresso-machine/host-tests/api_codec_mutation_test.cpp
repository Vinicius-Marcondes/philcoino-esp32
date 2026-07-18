#include <cassert>
#include <cstddef>
#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

#include "philcoino/api_codec.hpp"
#include "philcoino/api_json.hpp"
#include "philcoino/peripherals.hpp"

namespace {

using namespace philcoino::control;
using namespace philcoino::networking;
using namespace philcoino::networking::codec;
using namespace philcoino::peripherals;

struct Classification {
  bool json{false};
  bool temperatures{false};
  bool mode{false};
  bool heater{false};
  bool profiles{false};
  bool extraction_start{false};
  bool cooldown_start{false};
};

Classification classify(const std::string& body) {
  Classification result;
  std::vector<json::Field> fields;
  json::ObjectParser parser(body);
  result.json = parser.parse(fields);

  TemperatureTargets targets{90, 118};
  const TemperatureTargets original_targets = targets;
  bool constraint = false;
  const bool temperatures_parsed =
      parse_temperatures(body, {93, 115}, targets, constraint);
  result.temperatures = temperatures_parsed && !constraint;
  if (!temperatures_parsed || constraint) {
    assert(targets.brew_c == original_targets.brew_c &&
           targets.steam_c == original_targets.steam_c);
  }
  ControlMode mode = ControlMode::kSteam;
  const ControlMode original_mode = mode;
  result.mode = parse_mode(body, mode);
  if (!result.mode) {
    assert(mode == original_mode);
  }
  bool enabled = true;
  const bool original_enabled = enabled;
  result.heater = parse_heater_enabled(body, enabled);
  if (!result.heater) {
    assert(enabled == original_enabled);
  }
  ExtractionProfiles profiles = default_extraction_profiles();
  const std::string original_profiles = serialize_profiles(profiles);
  result.profiles = parse_profiles(body, profiles);
  if (!result.profiles) {
    assert(serialize_profiles(profiles) == original_profiles);
  }
  std::string key = "unchanged";
  ExtractionSelection selection{ExtractionSelectionKind::kProfile, 2U};
  result.extraction_start = parse_start(body, key, selection);
  if (!result.extraction_start) {
    assert(key == "unchanged" &&
           selection.kind == ExtractionSelectionKind::kProfile &&
           selection.profile_index == 2U);
  }
  key = "unchanged";
  result.cooldown_start = parse_cooldown_start(body, key);
  if (!result.cooldown_start) {
    assert(key == "unchanged");
  }
  return result;
}

bool same(const Classification& left, const Classification& right) {
  return left.json == right.json &&
         left.temperatures == right.temperatures && left.mode == right.mode &&
         left.heater == right.heater && left.profiles == right.profiles &&
         left.extraction_start == right.extraction_start &&
         left.cooldown_start == right.cooldown_start;
}

void exercise(const std::string& body) {
  const Classification first = classify(body);
  assert(same(first, classify(body)));
  if (body.size() > json::kMaximumInputBytes) {
    assert(!first.json && !first.temperatures && !first.mode &&
           !first.heater && !first.profiles && !first.extraction_start &&
           !first.cooldown_start);
  }
}

std::vector<std::string> seeds() {
  std::ifstream input(PHILCOINO_CODEC_CORPUS_PATH);
  assert(input.good());
  std::vector<std::string> result;
  std::string line;
  while (std::getline(input, line)) {
    if (line.empty() || line.front() == '#') {
      continue;
    }
    assert(line.size() <= json::kMaximumInputBytes);
    result.push_back(line);
  }
  assert(!result.empty());
  return result;
}

void run_deterministic_mutations(const std::string& seed) {
  exercise(seed);
  for (std::size_t length = 0; length < seed.size(); ++length) {
    exercise(seed.substr(0, length));
  }
  for (std::size_t index = 0; index < seed.size(); ++index) {
    std::string changed = seed;
    changed[index] = static_cast<char>((static_cast<unsigned char>(changed[index]) +
                                        17U) &
                                       0x7FU);
    exercise(changed);
  }
  exercise(" \n\t" + seed + " \r");
  if (seed.size() >= 2U && seed.front() == '{' && seed.back() == '}') {
    exercise(seed.substr(0, seed.size() - 1U) + ",\"unknown\":true}");
  }
}

void run_structured_mutation_classes() {
  for (const std::string body : {
           "{\"steamTargetC\":120,\"brewTargetC\":85}",
           " { \"brewTargetC\" : 85 , \"steamTargetC\" : 120 } ",
           "{\"brewTargetC\":85,\"brewTargetC\":86}",
           "{\"brewTargetC\":85,\"unknown\":true}",
           "{\"brewTargetC\":true}",
           "{\"brewTargetC\":\"85\"}",
           "{\"brewTargetC\":null}",
           "{\"brewTargetC\":[]}",
           "{\"brewTargetC\":{}}",
           "{\"brewTargetC\":01}",
           "{\"brewTargetC\":1.}",
           "{\"brewTargetC\":1e}",
           "{\"brewTargetC\":1e999}",
           "{\"mode\":\"br\\x65w\"}",
           "{\"mode\":\"\\u0080\"}",
           "{\"mode\":\"brew}",
           "{\"selection\":{\"kind\":\"manual\"},\"idempotencyKey\":\"abcdefghijklmnop\"}",
           "{\"idempotencyKey\":\"abcdefghijklmnop\",\"selection\":{\"kind\":\"manual\"}} trailing",
           "{\"idempotencyKey\":\"abcdefghijklmnop\",\"selection\":[\"manual\"]}",
           "{\"profiles\":[{}]}",
           "{\"profiles\":{}}",
       }) {
    exercise(body);
  }
  exercise(std::string(json::kMaximumInputBytes + 1U, ' '));
}

}  // namespace

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data,
                                      std::size_t size) {
  if (data == nullptr || size > 1024U) {
    return 0;
  }
  exercise(std::string(reinterpret_cast<const char*>(data), size));
  return 0;
}

int main() {
  for (const auto& seed : seeds()) {
    run_deterministic_mutations(seed);
  }
  run_structured_mutation_classes();
  return 0;
}
