#include <cassert>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <limits>
#include <string>
#include <utility>
#include <vector>

#include "philcoino/api.hpp"
#include "philcoino/config.hpp"
#include "philcoino/history.hpp"
#include "philcoino/weighted_trace.hpp"

namespace {

using namespace philcoino::control;
using namespace philcoino::networking;
using namespace philcoino::peripherals;

struct MemoryState {
  TemperatureTargets targets{};
  bool fail_save{false};
};

class MemoryBackend final : public TargetBackend {
 public:
  explicit MemoryBackend(MemoryState& state) : state_(state) {}

  BackendLoadResult load(TemperatureTargets& targets) override {
    targets = state_.targets;
    return BackendLoadResult::kOk;
  }

  bool save(const TemperatureTargets& targets) override {
    if (state_.fail_save) {
      return false;
    }
    state_.targets = targets;
    return true;
  }

 private:
  MemoryState& state_;
};

class TemperatureCalibrationMemoryBackend final
    : public TemperatureCalibrationBackend {
 public:
  explicit TemperatureCalibrationMemoryBackend(
      TemperatureCalibration calibration)
      : saved(calibration), present(calibration.calibrated) {}

  BackendLoadResult load(TemperatureCalibration& calibration) override {
    if (!present) {
      return BackendLoadResult::kNotFound;
    }
    calibration = saved;
    return BackendLoadResult::kOk;
  }

  bool save(const TemperatureCalibration& calibration) override {
    assert(lock_held == nullptr || !*lock_held);
    ++save_count;
    if (fail_save) {
      return false;
    }
    saved = calibration;
    present = true;
    return true;
  }

  TemperatureCalibration saved{};
  bool present{false};
  bool fail_save{false};
  int save_count{0};
  const bool* lock_held{nullptr};
};

class ProfileMemoryBackend final : public ProfileBackend {
 public:
  BackendLoadResult load(ExtractionProfiles& profiles) override {
    profiles = saved;
    return BackendLoadResult::kOk;
  }
  bool save(const ExtractionProfiles& profiles) override {
    if (fail_save) {
      return false;
    }
    saved = profiles;
    return true;
  }

  ExtractionProfiles saved{default_extraction_profiles()};
  bool fail_save{false};
};

class ScaleMemoryBackend final : public ScaleCalibrationBackend {
 public:
  BackendLoadResult load(ScaleCalibration& calibration) override {
    calibration = saved;
    return BackendLoadResult::kOk;
  }
  bool save(const ScaleCalibration& calibration) override {
    assert(lock_held == nullptr || !*lock_held);
    ++save_count;
    if (fail_save) return false;
    saved = calibration;
    return true;
  }
  ScaleCalibration saved{0, 100000, 1000};
  const bool* lock_held{nullptr};
  bool fail_save{false};
  int save_count{0};
};

class FakeApiSynchronization final : public ApiSynchronization {
 public:
  bool lock(ApiDomain) override {
    assert(!held);
    ++lock_count;
    if (fail_lock || lock_count == fail_on_lock) return false;
    held = true;
    return true;
  }
  void unlock(ApiDomain) override {
    assert(held);
    held = false;
    ++unlock_count;
  }
  bool fail_lock{false};
  int fail_on_lock{0};
  int lock_count{0};
  int unlock_count{0};
  bool held{false};
};

class FakeDigitalOutput final : public DigitalOutput {
 public:
  bool set_level(bool high) override {
    if ((high && fail_high) || (!high && fail_low)) {
      return false;
    }
    level = high;
    return true;
  }

  bool configure_output() override { return true; }

  bool level{false};
  bool fail_high{false};
  bool fail_low{false};
};

class FakeSafetyLease final : public SsrSafetyLease {
 public:
  bool initialize() override {
    tripped_ = false;
    return true;
  }
  bool arm(std::uint32_t) override { return !tripped_; }
  bool disarm() override { return true; }
  bool tripped() const override { return tripped_; }

 private:
  bool tripped_{false};
};

class FakeOutputCriticalSection final : public OutputCriticalSection {
 public:
  void enter() override { assert(!entered_); entered_ = true; }
  void exit() override { assert(entered_); entered_ = false; }

 private:
  bool entered_{false};
};

ThermocoupleReading ok(float temperature_c) {
  return {ThermocoupleStatus::kOk, temperature_c, 0};
}

struct ApiHarness {
  explicit ApiHarness(TemperatureCalibration calibration = {},
                      TemperatureTargets targets = {})
      : memory{targets, false},
        backend(memory),
        storage(backend),
        temperature_calibration_backend(calibration),
        temperature_calibration_storage(temperature_calibration_backend),
        ssr(output, safety_lease, ssr_critical_section),
        controller(memory.targets, calibration, ssr),
        profile_storage(profile_backend),
        pump(pump_output, pump_critical_section),
        extraction(profile_backend.saved, pump),
        cooldown(controller, pump),
        scale_storage(scale_backend),
        scale(scale_backend.saved, true),
        api({"philcoino-0102AF", "PhilcoINO", "ESP32-C3 Super Mini", "0.2.0"},
            "test-secret", controller, storage,
            temperature_calibration_storage, extraction, cooldown,
            profile_storage, scale_storage, synchronization, &history,
            &scale, &weighted_trace) {
    assert(ssr.initialize());
    assert(pump.initialize());
    scale_backend.lock_held = &synchronization.held;
    temperature_calibration_backend.lock_held =
        &synchronization.held;
    controller.update(ok(87.5F), 1000);
    for (std::int32_t index = 0; index < 10; ++index) {
      scale.update({Hx711Status::kOk, 80000}, 1000U + index);
    }
  }

  HttpResponse request(HttpMethod method, const char* path,
                       const char* authorization = nullptr,
                       const char* body = "", std::uint64_t now_ms = 184220) {
    auto response = api.handle(method, path, authorization, body, now_ms);
    assert(!synchronization.held);
    return response;
  }

  MemoryState memory{};
  MemoryBackend backend;
  TargetStorage storage;
  TemperatureCalibrationMemoryBackend
      temperature_calibration_backend;
  TemperatureCalibrationStorage temperature_calibration_storage;
  FakeDigitalOutput output{};
  FakeSafetyLease safety_lease;
  FakeOutputCriticalSection ssr_critical_section;
  FailOffSsr ssr;
  TemperatureController controller;
  ProfileMemoryBackend profile_backend;
  ProfileStorage profile_storage;
  FakeDigitalOutput pump_output{};
  FakeOutputCriticalSection pump_critical_section;
  FailOffPump pump;
  ExtractionController extraction;
  CooldownController cooldown;
  ScaleMemoryBackend scale_backend;
  ScaleCalibrationStorage scale_storage;
  ScaleController scale;
  FakeApiSynchronization synchronization;
  HistoryBuffer history{"00112233445566778899aabbccddeeff"};
  WeightedTraceBuffer weighted_trace{"00112233445566778899aabbccddeeff"};
  FirmwareApi api;
};

void expect_error(const HttpResponse& response, int status,
                  const char* code) {
  assert(response.status == status);
  assert(response.body.find(std::string("\"code\":\"") + code + "\"") !=
         std::string::npos);
}

std::string json_string_field(const std::string& body,
                              const char* field) {
  const std::string prefix =
      std::string("\"") + field + "\":\"";
  const auto start = body.find(prefix);
  assert(start != std::string::npos);
  const auto value_start = start + prefix.size();
  const auto end = body.find('"', value_start);
  assert(end != std::string::npos);
  return body.substr(value_start, end - value_start);
}

void write_capture(const std::filesystem::path& directory, const char* name,
                   const std::string& body) {
  std::filesystem::create_directories(directory);
  std::ofstream output(directory / name);
  assert(output.good());
  output << body;
  assert(output.good());
}

void test_public_contract_and_authentication() {
  ApiHarness harness;
  const DeviceIdentity identity{"philcoino-0102AF", "PhilcoINO",
                                "ESP32-C3 Super Mini", "0.2.0"};
  const auto txt = discovery_txt(identity);
  assert(std::string(kMdnsServiceType) == "_philcoino");
  assert(std::string(kMdnsProtocol) == "_tcp");
  assert(kHttpPort == 80);
  assert(txt[0].key == "deviceId" && txt[0].value == identity.device_id);
  assert(txt[1].key == "name" && txt[1].value == identity.name);
  assert(txt[2].key == "apiVersion" && txt[2].value == "1");
  assert(txt[3].key == "firmwareVersion" &&
         txt[3].value == identity.firmware_version);
  assert(txt[4].key == "model" && txt[4].value == identity.model);

  const auto health = harness.request(HttpMethod::kGet, "/healthz");
  assert(health.status == 200);
  assert(health.body == "{\"status\":\"ok\",\"uptimeMs\":184220}");
  assert(harness.request(HttpMethod::kGet, "/healthz", nullptr, "",
                         4294967305ULL).body ==
         "{\"status\":\"ok\",\"uptimeMs\":4294967305}");

  const auto device = harness.request(HttpMethod::kGet, "/api/v1/device");
  assert(device.status == 200);
  assert(device.body.find("\"deviceId\":\"philcoino-0102AF\"") !=
         std::string::npos);
  assert(device.body.find("test-secret") == std::string::npos);

  for (const auto& unsupported :
       std::vector<std::pair<HttpMethod, const char*>>{
           {HttpMethod::kPost, "/healthz"},
           {HttpMethod::kGet, "/unknown"},
       }) {
    const auto missing_route =
        harness.request(unsupported.first, unsupported.second);
    assert(missing_route.status == 404);
    assert(missing_route.body ==
           "{\"error\":{\"code\":\"internal_error\",\"message\":\"The requested endpoint does not exist.\"}}");
    assert(!missing_route.bearer_challenge);
  }

  for (const auto& request :
       std::vector<std::pair<HttpMethod, const char*>>{
           {HttpMethod::kGet, "/api/v1/state"},
           {HttpMethod::kPatch, "/api/v1/settings/temperatures"},
           {HttpMethod::kPut, "/api/v1/mode"},
           {HttpMethod::kPut, "/api/v1/heater"},
           {HttpMethod::kPost, "/api/v1/faults/over-temperature/dismiss"},
           {HttpMethod::kPost, "/api/v2/temperature-calibration/start"},
       }) {
    const auto missing = harness.request(request.first, request.second);
    expect_error(missing, 401, "unauthorized");
    assert(missing.bearer_challenge);
  }

  auto response = harness.request(HttpMethod::kGet, "/api/v1/state",
                                  "Bearer incorrect");
  expect_error(response, 401, "unauthorized");
  response = harness.request(HttpMethod::kGet, "/api/v1/state",
                             "bEaReR test-secret");
  assert(response.status == 200);

  assert(constant_time_bearer_matches("Bearer test-secret", "test-secret"));
  assert(constant_time_bearer_matches("Bearer\ttest-secret", "test-secret"));
  assert(!constant_time_bearer_matches("Bearer test-secreu", "test-secret"));
  assert(!constant_time_bearer_matches("Basic test-secret", "test-secret"));
  assert(!constant_time_bearer_matches("Bearertest-secret", "test-secret"));
  assert(!constant_time_bearer_matches("Bearer ", "test-secret"));
  assert(!constant_time_bearer_matches(nullptr, "test-secret"));
}

void test_state_and_mutations_delegate_to_control() {
  ApiHarness harness;
  const char* authorization = "Bearer test-secret";
  auto response = harness.request(HttpMethod::kGet, "/api/v1/state",
                                  authorization);
  assert(response.status == 200);
  assert(response.body.find("\"status\":\"heating\"") != std::string::npos);
  assert(response.body.find("\"activeMode\":\"brew\"") != std::string::npos);
  assert(response.body.find("\"heaterEnabled\":true") != std::string::npos);
  assert(response.body.find("\"heaterActive\":true") != std::string::npos);

  response = harness.request(HttpMethod::kPatch,
                             "/api/v1/settings/temperatures", authorization,
                             "{\"brewTargetC\":95}");
  assert(response.status == 200);
  assert(response.body == "{\"brewTargetC\":95,\"steamTargetC\":115}");
  assert(harness.controller.targets().brew_c == 95);
  assert(harness.memory.targets.brew_c == 95);

  response = harness.request(HttpMethod::kPatch,
                             "/api/v1/settings/temperatures", authorization,
                             "{\"steamTargetC\":134}");
  assert(response.status == 200);
  assert(response.body == "{\"brewTargetC\":95,\"steamTargetC\":134}");
  assert(harness.controller.targets().steam_c == 134);
  assert(harness.memory.targets.steam_c == 134);

  response = harness.request(HttpMethod::kPatch,
                             "/api/v1/settings/temperatures", authorization,
                             "{\"steamTargetC\":135}");
  assert(response.status == 200);
  assert(response.body == "{\"brewTargetC\":95,\"steamTargetC\":135}");
  assert(harness.controller.targets().steam_c == 135);
  assert(harness.memory.targets.steam_c == 135);

  response = harness.request(HttpMethod::kPut, "/api/v1/mode", authorization,
                             "{\"mode\":\"steam\"}");
  assert(response.status == 200);
  assert(response.body == "{\"mode\":\"steam\"}");
  assert(harness.controller.mode() == ControlMode::kSteam);
  response = harness.request(HttpMethod::kPut, "/api/v1/mode", authorization,
                             "{\"mode\":\"steam\"}");
  assert(response.status == 200);

  response = harness.request(HttpMethod::kPut, "/api/v1/heater", authorization,
                             "{\"heaterEnabled\":false}");
  assert(response.status == 200);
  assert(response.body == "{\"heaterEnabled\":false}");
  assert(!harness.controller.heater_enabled_permission());
  response = harness.request(HttpMethod::kGet, "/api/v1/state", authorization);
  assert(response.status == 200);
  assert(response.body.find("\"heaterEnabled\":false") != std::string::npos);
  assert(response.body.find("\"heaterActive\":false") != std::string::npos);

  harness.controller.latch_fault(FaultCode::kSensorFailure);
  response = harness.request(HttpMethod::kPut, "/api/v1/heater", authorization,
                             "{\"heaterEnabled\":true}");
  assert(response.status == 200);
  assert(response.body == "{\"heaterEnabled\":true}");
  assert(harness.controller.heater_enabled_permission());
}

void test_effective_temperature_serializes_once_across_v1_v2_and_modes() {
  const char* authorization = "Bearer test-secret";

  ApiHarness steam({5, true});
  assert(steam.controller.set_mode(ControlMode::kSteam, 2000));
  steam.controller.update(ok(115.0F), 2500);
  auto response = steam.request(HttpMethod::kGet, "/api/v1/state",
                                authorization, "", 2500);
  assert(response.status == 200);
  assert(response.body.find("\"activeMode\":\"steam\"") !=
         std::string::npos);
  assert(response.body.find("\"boilerTemperatureC\":120") !=
         std::string::npos);
  assert(response.body.find("\"boilerTemperatureC\":125") ==
         std::string::npos);

  response = steam.request(HttpMethod::kGet, "/api/v2/state", authorization,
                           "", 2500);
  assert(response.status == 200);
  assert(response.body.find("\"boilerTemperatureC\":120") !=
         std::string::npos);
  assert(response.body.find("\"boilerTemperatureC\":125") ==
         std::string::npos);

  ApiHarness brew({5, true});
  brew.controller.update(ok(115.0F), 2500);
  response = brew.request(HttpMethod::kGet, "/api/v1/state", authorization,
                          "", 2500);
  assert(response.status == 200);
  assert(response.body.find("\"activeMode\":\"brew\"") !=
         std::string::npos);
  assert(response.body.find("\"boilerTemperatureC\":120") !=
         std::string::npos);

  ApiHarness switching({5, true});
  response = switching.request(HttpMethod::kGet, "/api/v1/state",
                               authorization, "", 3000);
  assert(response.body.find("\"boilerTemperatureC\":92.5") !=
         std::string::npos);
  assert(switching.request(HttpMethod::kPut, "/api/v1/mode", authorization,
                           "{\"mode\":\"steam\"}", 3000)
             .status == 200);
  response = switching.request(HttpMethod::kGet, "/api/v1/state",
                               authorization, "", 3000);
  assert(response.body.find("\"boilerTemperatureC\":92.5") !=
         std::string::npos);
  assert(response.body.find("\"heaterActive\":false") !=
         std::string::npos);
  assert(switching.request(HttpMethod::kPut, "/api/v1/mode", authorization,
                           "{\"mode\":\"brew\"}", 3000)
             .status == 200);
  response = switching.request(HttpMethod::kGet, "/api/v1/state",
                               authorization, "", 3000);
  assert(response.body.find("\"boilerTemperatureC\":92.5") !=
         std::string::npos);
}

void test_over_temperature_dismissal_endpoint_is_guarded() {
  ApiHarness harness;
  const char* authorization = "Bearer test-secret";

  auto response = harness.request(
      HttpMethod::kPost, "/api/v1/faults/over-temperature/dismiss",
      authorization);
  expect_error(response, 409, "sensor_unavailable");

  harness.controller.update(
      ok(static_cast<float>(philcoino::config::kBrewOverTemperatureC)), 2000);
  response = harness.request(
      HttpMethod::kPost, "/api/v1/faults/over-temperature/dismiss",
      authorization, "", 3000);
  expect_error(response, 409, "sensor_unavailable");

  harness.controller.update(ok(93.0F), 4000);
  response = harness.request(
      HttpMethod::kPost, "/api/v1/faults/over-temperature/dismiss",
      authorization, "", 5000);
  assert(response.status == 200);
  assert(response.body.find("\"status\":\"heating\"") != std::string::npos);
  assert(response.body.find("\"fault\":null") != std::string::npos);
}

void test_malformed_and_domain_failures_do_not_bypass_validation() {
  ApiHarness harness;
  const char* authorization = "Bearer test-secret";
  for (const char* body : {"{", "{}", "{\"brewTargetC\":93,\"extra\":1}",
                           "{\"brewTargetC\":\"93\"}"}) {
    expect_error(harness.request(HttpMethod::kPatch,
                                 "/api/v1/settings/temperatures",
                                 authorization, body),
                 400, "malformed_request");
  }
  for (const char* body : {"{\"brewTargetC\":84}",
                           "{\"steamTargetC\":136}",
                           "{\"brewTargetC\":92.5}"}) {
    expect_error(harness.request(HttpMethod::kPatch,
                                 "/api/v1/settings/temperatures",
                                 authorization, body),
                 400, "temperature_out_of_range");
  }
  assert(harness.controller.targets().brew_c == 93);

  harness.memory.fail_save = true;
  expect_error(harness.request(HttpMethod::kPatch,
                               "/api/v1/settings/temperatures", authorization,
                               "{\"steamTargetC\":116}"),
               500, "persistence_failure");
  assert(harness.controller.targets().steam_c == 115);

  expect_error(harness.request(HttpMethod::kPut, "/api/v1/mode",
                               authorization, "{\"mode\":\"cleaning\"}"),
               400, "malformed_request");
  for (const char* body : {"{", "{}", "{\"heaterEnabled\":\"false\"}",
                           "{\"heaterEnabled\":false,\"extra\":true}"}) {
    expect_error(harness.request(HttpMethod::kPut, "/api/v1/heater",
                                 authorization, body),
                 400, "malformed_request");
  }
  harness.controller.latch_fault(FaultCode::kSensorFailure);
  expect_error(harness.request(HttpMethod::kPut, "/api/v1/mode",
                               authorization, "{\"mode\":\"steam\"}"),
               409, "sensor_unavailable");
}

void test_api_v2_profiles_and_extraction_contract() {
  ApiHarness harness;
  const char* authorization = "Bearer test-secret";
  const char* profiles =
      "{\"profiles\":[{\"id\":\"profile-1\",\"profile\":{\"name\":\"Short20\",\"preInfusionSeconds\":0,\"soakSeconds\":0,\"mainExtractionSeconds\":20}},{\"id\":\"profile-2\",\"profile\":{\"name\":\"Pre5Soak5\",\"preInfusionSeconds\":5,\"soakSeconds\":5,\"mainExtractionSeconds\":25}},{\"id\":\"profile-3\",\"profile\":null},{\"id\":\"profile-4\",\"profile\":null}]}";

  for (const auto& endpoint :
       std::vector<std::pair<HttpMethod, const char*>>{
           {HttpMethod::kGet, "/api/v2/state"},
           {HttpMethod::kGet, "/api/v2/history"},
           {HttpMethod::kGet, "/api/v2/scale/trace"},
           {HttpMethod::kGet, "/api/v2/profiles"},
           {HttpMethod::kPut, "/api/v2/profiles"},
           {HttpMethod::kPost, "/api/v2/extractions/start"},
           {HttpMethod::kPost, "/api/v2/extractions/stop"},
           {HttpMethod::kPost, "/api/v2/cooldowns/start"},
           {HttpMethod::kPost, "/api/v2/cooldowns/stop"},
       }) {
    expect_error(harness.request(endpoint.first, endpoint.second), 401,
                 "unauthorized");
  }

  auto response = harness.request(HttpMethod::kGet, "/api/v2/state",
                                  authorization);
  assert(response.status == 200);
  assert(response.body.find("\"machine\":") != std::string::npos);
  assert(response.body.find("\"status\":\"idle\"") != std::string::npos);
  assert(response.body.find("\"controllerDiagnostics\":") ==
         std::string::npos);

  expect_error(harness.request(HttpMethod::kGet,
                               "/api/v2/state?include=prediction",
                               authorization),
               400, "malformed_request");
  expect_error(harness.request(HttpMethod::kGet,
                               "/api/v2/state?include=unknown",
                               authorization),
               400, "malformed_request");

  response = harness.request(HttpMethod::kPut, "/api/v2/profiles",
                             authorization, profiles);
  assert(response.status == 200);
  assert(response.body == profiles);
  assert(harness.extraction.profiles()[0].main_extraction_seconds == 20U);

  response = harness.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-01J2ABCDEF1234\",\"selection\":{\"kind\":\"profile\",\"profileId\":\"profile-2\"}}",
      1000);
  assert(response.status == 200);
  const auto original = response.body;
  assert(original.find("\"phase\":\"pre-infusion\"") != std::string::npos);
  assert(original.find("\"pumpCommand\":\"running\"") != std::string::npos);

  response = harness.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-01J2ABCDEF1234\",\"selection\":{\"kind\":\"manual\"}}",
      2000);
  expect_error(response, 409, "idempotency_mismatch");

  response = harness.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-01J2OTHERKEY99\",\"selection\":{\"kind\":\"manual\"}}",
      2000);
  expect_error(response, 409, "extraction_active");
  assert(response.body.find("\"activeExtraction\":") != std::string::npos);

  response = harness.request(HttpMethod::kPut, "/api/v2/profiles",
                             authorization, profiles, 2000);
  expect_error(response, 409, "extraction_active");
  assert(harness.extraction.update(6000) == ExtractionUpdateResult::kOk);
  response = harness.request(HttpMethod::kGet, "/api/v2/state", authorization,
                             "", 6000);
  assert(response.body.find("\"phase\":\"soak\"") != std::string::npos);
  assert(response.body.find("\"pumpCommand\":\"off\"") != std::string::npos);

  response = harness.request(HttpMethod::kPost, "/api/v2/extractions/stop",
                             authorization, "", 6000);
  assert(response.status == 200);
  assert(response.body.find("\"status\":\"idle\"") != std::string::npos);
  assert(response.body.find("\"extractionId\":\"run-1\"") !=
         std::string::npos);
  assert(response.body.find("\"outcome\":\"stopped\"") !=
         std::string::npos);
  assert(harness.request(HttpMethod::kPost, "/api/v2/extractions/stop",
                         authorization).status == 200);

  response = harness.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-01J2ABCDEF1234\",\"selection\":{\"kind\":\"profile\",\"profileId\":\"profile-2\"}}",
      6500);
  assert(response.status == 200);
  assert(response.body.find("\"extractionId\":\"run-1\"") !=
         std::string::npos);
  assert(response.body.find("\"outcome\":\"stopped\"") !=
         std::string::npos);

  response = harness.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-01J2EMPTYKEY999\",\"selection\":{\"kind\":\"profile\",\"profileId\":\"profile-3\"}}",
      7000);
  expect_error(response, 409, "profile_not_configured");
  response = harness.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-01J2ABCDEF1234\",\"selection\":{\"kind\":\"profile\",\"profileId\":\"profile-2\"}}",
      7000);
  assert(response.status == 200);
  assert(response.body.find("\"extractionId\":\"run-1\"") !=
         std::string::npos);

  harness.profile_backend.fail_save = true;
  response = harness.request(HttpMethod::kPut, "/api/v2/profiles",
                             authorization, profiles);
  expect_error(response, 500, "persistence_failure");
}

void test_api_v2_rejects_malformed_nested_shapes_and_lock_failure() {
  ApiHarness harness;
  const char* authorization = "Bearer test-secret";
  for (const char* body : {
           "{}",
           "{\"idempotencyKey\":\"short\",\"selection\":{\"kind\":\"manual\"}}",
           "{\"idempotencyKey\":\"start-01J2ABCDEF1234\",\"selection\":{\"kind\":\"manual\",\"extra\":1}}",
           "{\"idempotencyKey\":\"start-01J2ABCDEF1234\",\"selection\":{\"kind\":\"profile\",\"profileId\":\"profile-5\"}}",
       }) {
    expect_error(harness.request(HttpMethod::kPost,
                                 "/api/v2/extractions/start", authorization,
                                 body),
                 400, "malformed_request");
  }
  expect_error(harness.request(
                   HttpMethod::kPut, "/api/v2/profiles", authorization,
                   "{\"profiles\":[{\"id\":\"profile-1\",\"profile\":null}]}"),
               400, "malformed_request");
  harness.synchronization.fail_lock = true;
  expect_error(harness.request(HttpMethod::kGet, "/api/v2/state",
                               authorization),
               500, "internal_error");
}

void test_target_adoption_lock_failure_retains_the_heater_inhibit() {
  ApiHarness harness;
  harness.synchronization.fail_on_lock = 3;
  const auto response = harness.request(
      HttpMethod::kPatch, "/api/v1/settings/temperatures",
      "Bearer test-secret", "{\"brewTargetC\":94}", 2000);

  expect_error(response, 500, "internal_error");
  assert(harness.controller.target_update_in_progress());
  assert(harness.controller.targets().brew_c == 93);
  const auto snapshot = harness.controller.update(ok(80.0F), 2001);
  assert(!snapshot.heater_enabled);
  assert(!harness.output.level);
}

void test_unsafe_target_is_rejected_without_persistence_or_clamping() {
  ApiHarness harness({-20, true}, {93, 115});
  const auto response = harness.request(
      HttpMethod::kPatch, "/api/v1/settings/temperatures",
      "Bearer test-secret", "{\"steamTargetC\":116}", 2000);

  expect_error(response, 400, "temperature_target_unsafe");
  assert(harness.controller.targets().steam_c == 115);
  assert(harness.memory.targets.steam_c == 115);
  assert(!harness.controller.target_update_in_progress());
}

void test_temperature_calibration_api_transaction_and_persistence() {
  ApiHarness harness;
  const char* authorization = "Bearer test-secret";

  auto response = harness.request(
      HttpMethod::kGet, "/api/v2/temperature-calibration",
      authorization, "", 1500);
  assert(response.status == 200);
  assert(response.body.find("\"status\":\"uncalibrated\"") !=
         std::string::npos);
  assert(response.body.find("\"savedOffsetC\":0") !=
         std::string::npos);

  response = harness.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 2000);
  assert(response.status == 200);
  assert(response.body.find("\"status\":\"calibrating\"") !=
         std::string::npos);
  assert(response.body.find("\"candidateRawTargetC\":100") !=
         std::string::npos);
  assert(response.body.find("\"sessionLeaseRemainingMs\":15000") !=
         std::string::npos);
  assert(harness.pump.command() == PumpCommand::kOff);
  const auto calibration_id =
      json_string_field(response.body, "calibrationId");

  response = harness.request(
      HttpMethod::kGet, "/api/v2/temperature-calibration",
      authorization, "", 2001);
  expect_error(response, 409,
               "temperature_calibration_session_mismatch");

  const std::string candidate =
      std::string("{\"calibrationId\":\"") + calibration_id +
      "\",\"candidateRawTargetC\":108}";
  response = harness.request(
      HttpMethod::kPut, "/api/v2/temperature-calibration/candidate",
      authorization, candidate.c_str(), 2500);
  assert(response.status == 200);
  assert(response.body.find("\"candidateRawTargetC\":108") !=
         std::string::npos);
  assert(response.body.find("\"offsetPreviewC\":-8") !=
         std::string::npos);
  assert(harness.pump.command() == PumpCommand::kOff);

  const std::string session =
      std::string("{\"calibrationId\":\"") + calibration_id + "\"}";
  response = harness.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/save",
      authorization, session.c_str(), 3000);
  assert(response.status == 200);
  assert(response.body.find("\"status\":\"calibrated\"") !=
         std::string::npos);
  assert(response.body.find("\"savedOffsetC\":-8") !=
         std::string::npos);
  assert(harness.temperature_calibration_backend.save_count == 1);
  assert(harness.temperature_calibration_backend.saved.offset_c == -8);
  assert(harness.controller.temperature_calibration().offset_c == -8);
  assert(harness.controller.targets().brew_c == 93);
  assert(harness.controller.targets().steam_c == 115);
  assert(harness.controller.mode() == ControlMode::kBrew);
  assert(harness.pump.command() == PumpCommand::kOff);
}

void test_temperature_calibration_api_failure_expiry_and_conflicts() {
  const char* authorization = "Bearer test-secret";

  ApiHarness persistence;
  auto response = persistence.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 2000);
  const auto persistence_id =
      json_string_field(response.body, "calibrationId");
  const std::string positive_candidate =
      std::string("{\"calibrationId\":\"") + persistence_id +
      "\",\"candidateRawTargetC\":95}";
  assert(persistence.request(
             HttpMethod::kPut,
             "/api/v2/temperature-calibration/candidate",
             authorization, positive_candidate.c_str(), 2500)
             .status == 200);
  persistence.temperature_calibration_backend.fail_save = true;
  const std::string persistence_session =
      std::string("{\"calibrationId\":\"") + persistence_id + "\"}";
  response = persistence.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/save",
      authorization, persistence_session.c_str(), 3000);
  expect_error(response, 500, "persistence_failure");
  assert(persistence.controller.temperature_calibration().offset_c == 0);
  assert(persistence.controller.temperature_calibration_active());
  assert(!persistence.output.level);

  ApiHarness unsafe({}, {93, 135});
  response = unsafe.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 2000);
  const auto unsafe_id = json_string_field(response.body, "calibrationId");
  const std::string unsafe_candidate =
      std::string("{\"calibrationId\":\"") + unsafe_id +
      "\",\"candidateRawTargetC\":120}";
  assert(unsafe.request(
             HttpMethod::kPut,
             "/api/v2/temperature-calibration/candidate",
             authorization, unsafe_candidate.c_str(), 2500)
             .status == 200);
  const std::string unsafe_session =
      std::string("{\"calibrationId\":\"") + unsafe_id + "\"}";
  response = unsafe.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/save",
      authorization, unsafe_session.c_str(), 3000);
  expect_error(response, 409, "temperature_target_unsafe");
  assert(unsafe.temperature_calibration_backend.save_count == 0);
  assert(unsafe.controller.targets().steam_c == 135);

  ApiHarness expired;
  response = expired.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 1000);
  const auto expired_id =
      json_string_field(response.body, "calibrationId");
  const std::string expired_path =
      std::string("/api/v2/temperature-calibration?calibrationId=") +
      expired_id;
  response = expired.request(
      HttpMethod::kGet, expired_path.c_str(), authorization, "",
      1000 + philcoino::config::kTemperatureCalibrationSessionLeaseMs);
  expect_error(response, 409, "temperature_calibration_expired");
  assert(!expired.controller.temperature_calibration_active());
  assert(expired.controller.mode() == ControlMode::kBrew);

  ApiHarness target_conflict;
  response = target_conflict.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 2000);
  assert(response.status == 200);
  response = target_conflict.request(
      HttpMethod::kPatch, "/api/v1/settings/temperatures",
      authorization, "{\"brewTargetC\":94}", 2500);
  expect_error(response, 409, "temperature_calibration_active");
  assert(!target_conflict.controller.temperature_calibration_active());
  assert(target_conflict.controller.targets().brew_c == 93);

  ApiHarness extraction_conflict;
  assert(extraction_conflict.request(
             HttpMethod::kPost,
             "/api/v2/temperature-calibration/start",
             authorization, "", 2000)
             .status == 200);
  response = extraction_conflict.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-after-temp-cal\",\"selection\":{\"kind\":\"manual\"}}",
      2500);
  expect_error(response, 409, "temperature_calibration_active");
  assert(!extraction_conflict.extraction.active());
  assert(extraction_conflict.pump.command() == PumpCommand::kOff);
}

void test_temperature_calibration_api_start_guards_and_session_ownership() {
  const char* authorization = "Bearer test-secret";

  ApiHarness active;
  auto response = active.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 2000);
  assert(response.status == 200);
  const auto active_id = json_string_field(response.body, "calibrationId");
  response = active.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 2001);
  expect_error(response, 409, "temperature_calibration_active");
  response = active.request(
      HttpMethod::kPut, "/api/v2/temperature-calibration/candidate",
      authorization,
      "{\"calibrationId\":\"temp-cal-wrong-0000\",\"candidateRawTargetC\":101}",
      2002);
  expect_error(response, 409,
               "temperature_calibration_session_mismatch");
  const std::string active_session =
      std::string("{\"calibrationId\":\"") + active_id + "\"}";
  response = active.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/cancel",
      authorization, active_session.c_str(), 2003);
  assert(response.status == 200);
  assert(response.body.find("\"status\":\"uncalibrated\"") !=
         std::string::npos);
  response = active.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/cancel",
      authorization, active_session.c_str(), 2004);
  expect_error(response, 409, "temperature_calibration_inactive");

  ApiHarness disabled;
  assert(disabled.controller.set_heater_enabled(false, 1500));
  response = disabled.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 2000);
  expect_error(response, 409, "heater_disabled");

  ApiHarness steam;
  assert(steam.controller.set_mode(ControlMode::kSteam, 1500));
  response = steam.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 2000);
  expect_error(response, 409, "brew_mode_required");

  ApiHarness fault;
  fault.controller.latch_fault(FaultCode::kSensorFailure);
  response = fault.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 2000);
  expect_error(response, 409, "machine_faulted");

  ApiHarness extracting;
  assert(extracting.request(
             HttpMethod::kPost, "/api/v2/extractions/start",
             authorization,
             "{\"idempotencyKey\":\"temp-cal-extract-1\",\"selection\":{\"kind\":\"manual\"}}",
             2000)
             .status == 200);
  response = extracting.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 2001);
  expect_error(response, 409, "extraction_active");

  ApiHarness cooling;
  cooling.controller.update(ok(96.0F), 2000);
  assert(cooling.request(
             HttpMethod::kPost, "/api/v2/cooldowns/start",
             authorization,
             "{\"idempotencyKey\":\"temp-cal-cooldown\"}", 2000)
             .status == 200);
  response = cooling.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 2001);
  expect_error(response, 409, "cooldown_active");

  ApiHarness scale_calibrating;
  assert(scale_calibrating.request(
             HttpMethod::kPost, "/api/v2/scale/calibration/start",
             authorization, "", 1100)
             .status == 200);
  response = scale_calibrating.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 1101);
  expect_error(response, 409, "calibration_in_progress");
}

void test_workflow_mode_coordination_is_authoritative() {
  const char* authorization = "Bearer test-secret";

  ApiHarness extracting;
  auto response = extracting.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-01J2MODELOCK01\",\"selection\":{\"kind\":\"manual\"}}",
      2000);
  assert(response.status == 200);
  response = extracting.request(HttpMethod::kPut, "/api/v1/mode",
                                authorization, "{\"mode\":\"steam\"}", 2000);
  expect_error(response, 409, "sensor_unavailable");
  assert(extracting.controller.mode() == ControlMode::kBrew);

  ApiHarness steam;
  assert(steam.request(HttpMethod::kPut, "/api/v1/mode", authorization,
                       "{\"mode\":\"steam\"}", 2000)
             .status == 200);
  response = steam.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-01J2STEAMLOCK1\",\"selection\":{\"kind\":\"manual\"}}",
      2000);
  expect_error(response, 409, "brew_mode_required");
  assert(!steam.extraction.active());

  ApiHarness cooling;
  cooling.controller.update(ok(96.0F), 2000);
  const CooldownInput input{true, false, false, 96.0F};
  assert(cooling.cooldown.start("cooldown-01J2MODELOCK", input, 2000) ==
         StartCooldownResult::kStarted);
  response = cooling.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-01J2COOLLOCK01\",\"selection\":{\"kind\":\"manual\"}}",
      2000);
  expect_error(response, 409, "cooldown_active");
  response = cooling.request(HttpMethod::kPut, "/api/v1/mode", authorization,
                             "{\"mode\":\"steam\"}", 2000);
  expect_error(response, 409, "sensor_unavailable");
  assert(cooling.controller.mode() == ControlMode::kBrew);
}

void test_api_v2_cooldown_and_compensation_contract() {
  const char* authorization = "Bearer test-secret";
  constexpr char kCooldownStart[] =
      "{\"idempotencyKey\":\"cooldown-01J2APIROUTE1\"}";
  constexpr char kProfiles[] =
      "{\"profiles\":[{\"id\":\"profile-1\",\"profile\":null},{\"id\":\"profile-2\",\"profile\":null},{\"id\":\"profile-3\",\"profile\":null},{\"id\":\"profile-4\",\"profile\":null}]}";

  ApiHarness initial;
  auto response = initial.request(HttpMethod::kGet, "/api/v2/state",
                                  authorization, "", 2000);
  assert(response.status == 200);
  assert(response.body.find(
             "\"compensation\":{\"status\":\"inactive\",\"phase\":null}") !=
         std::string::npos);
  assert(response.body.find(
             "\"cooldown\":{\"status\":\"idle\",\"cooldownId\":null") !=
         std::string::npos);
  response = initial.request(HttpMethod::kPost, "/api/v2/cooldowns/stop",
                             authorization, "", 2000);
  assert(response.status == 200);
  assert(response.body.find("\"status\":\"idle\"") != std::string::npos);

  ApiHarness compensation;
  assert(compensation.request(
             HttpMethod::kPost, "/api/v2/extractions/start", authorization,
             "{\"idempotencyKey\":\"start-01J2COMPSTATE1\",\"selection\":{\"kind\":\"manual\"}}",
             2000)
             .status == 200);
  compensation.controller.set_extraction_phase(
      compensation.extraction.snapshot(2000U).phase, 2000U);
  response = compensation.request(HttpMethod::kGet, "/api/v2/state",
                                  authorization, "", 2000);
  assert(response.body.find(
             "\"compensation\":{\"status\":\"active\",\"phase\":\"manual\"}") !=
         std::string::npos);

  ApiHarness cooling;
  cooling.controller.update(ok(96.0F), 2000);
  response = cooling.request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                             authorization, kCooldownStart, 2000);
  assert(response.status == 200);
  assert(response.body.find("\"status\":\"pumping\"") !=
         std::string::npos);
  assert(response.body.find("\"cooldownId\":\"cooldown-1\"") !=
         std::string::npos);
  assert(response.body.find("\"elapsedMs\":0,\"remainingMs\":45000") !=
         std::string::npos);
  assert(response.body.find("\"pumpCommand\":\"running\"") !=
         std::string::npos);
  assert(!cooling.controller.heater_enabled());

  response = cooling.request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                             authorization, kCooldownStart, 3000);
  assert(response.status == 200);
  assert(response.body.find("\"cooldownId\":\"cooldown-1\"") !=
         std::string::npos);
  assert(response.body.find("\"elapsedMs\":1000,\"remainingMs\":44000") !=
         std::string::npos);

  response = cooling.request(
      HttpMethod::kPost, "/api/v2/cooldowns/start", authorization,
      "{\"idempotencyKey\":\"cooldown-01J2OTHERKEY2\"}", 3000);
  expect_error(response, 409, "cooldown_active");
  assert(response.body.find("\"activeCooldown\":") != std::string::npos);
  response = cooling.request(HttpMethod::kPut, "/api/v2/profiles",
                             authorization, kProfiles, 3000);
  expect_error(response, 409, "cooldown_active");
  assert(response.body.find("\"activeCooldown\":") != std::string::npos);
  response = cooling.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-01J2COOLAPI001\",\"selection\":{\"kind\":\"manual\"}}",
      3000);
  expect_error(response, 409, "cooldown_active");
  assert(response.body.find("\"activeCooldown\":") != std::string::npos);
  response = cooling.request(HttpMethod::kPost, "/api/v2/extractions/stop",
                             authorization, "", 3000);
  assert(response.status == 200);
  assert(cooling.pump.command() == PumpCommand::kRunning);

  response = cooling.request(HttpMethod::kPost, "/api/v2/cooldowns/stop",
                             authorization, "", 3000);
  assert(response.status == 200);
  assert(response.body.find("\"status\":\"stabilizing\"") !=
         std::string::npos);
  assert(response.body.find("\"remainingMs\":5000") != std::string::npos);
  assert(response.body.find("\"outcome\":\"stopped\"") !=
         std::string::npos);
  response = cooling.request(HttpMethod::kPost, "/api/v2/cooldowns/stop",
                             authorization, "", 3500);
  assert(response.status == 200);
  assert(response.body.find("\"remainingMs\":4500") != std::string::npos);
  response = cooling.request(HttpMethod::kPost, "/api/v2/cooldowns/stop",
                             authorization, "", 8000);
  assert(response.status == 200);
  assert(response.body.find("\"status\":\"idle\"") != std::string::npos);
  assert(response.body.find("\"cooldownId\":\"cooldown-1\"") !=
         std::string::npos);
  assert(response.body.find("\"outcome\":\"stopped\"") !=
         std::string::npos);
  response = cooling.request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                             authorization, kCooldownStart, 9000);
  assert(response.status == 200);
  assert(response.body.find("\"status\":\"idle\"") != std::string::npos);
  assert(response.body.find("\"cooldownId\":\"cooldown-1\"") !=
         std::string::npos);

  ApiHarness workflow_handoff;
  assert(workflow_handoff
             .request(
                 HttpMethod::kPost, "/api/v2/extractions/start", authorization,
                 "{\"idempotencyKey\":\"start-before-cooldown-01\",\"selection\":{\"kind\":\"manual\"}}",
                 2000)
             .status == 200);
  assert(workflow_handoff
             .request(HttpMethod::kPost, "/api/v2/extractions/stop",
                      authorization, "", 3000)
             .status == 200);
  workflow_handoff.controller.update(ok(96.0F), 3000);
  assert(workflow_handoff
             .request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                      authorization, kCooldownStart, 4000)
             .status == 200);
  response = workflow_handoff.request(HttpMethod::kGet, "/api/v2/state",
                                      authorization, "", 4000);
  assert(response.status == 200);
  assert(response.body.find(
             "\"extraction\":{\"status\":\"idle\",\"extractionId\":\"run-1\"") !=
         std::string::npos);
  assert(response.body.find(
             "\"remainingMs\":null,\"pumpCommand\":\"off\",\"outcome\":\"stopped\"") !=
         std::string::npos);
  assert(response.body.find(
             "\"cooldown\":{\"status\":\"pumping\"") !=
         std::string::npos);

  assert(workflow_handoff
             .request(HttpMethod::kPost, "/api/v2/cooldowns/stop",
                      authorization, "", 5000)
             .status == 200);
  assert(workflow_handoff
             .request(HttpMethod::kPost, "/api/v2/cooldowns/stop",
                      authorization, "", 10000)
             .status == 200);
  assert(workflow_handoff
             .request(
                 HttpMethod::kPost, "/api/v2/extractions/start", authorization,
                 "{\"idempotencyKey\":\"start-after-cooldown-001\",\"selection\":{\"kind\":\"manual\"}}",
                 11000)
             .status == 200);
  response = workflow_handoff.request(HttpMethod::kPost,
                                      "/api/v2/cooldowns/stop", authorization,
                                      "", 11001);
  assert(response.status == 200);
  assert(workflow_handoff.extraction.active());
  assert(workflow_handoff.pump.command() == PumpCommand::kRunning);
  response = workflow_handoff.request(HttpMethod::kGet, "/api/v2/state",
                                      authorization, "", 11001);
  assert(response.status == 200);
  assert(response.body.find(
             "\"extraction\":{\"status\":\"running\"") !=
         std::string::npos);
  assert(response.body.find(
             "\"cooldown\":{\"status\":\"idle\",\"cooldownId\":\"cooldown-1\"") !=
         std::string::npos);
  assert(response.body.find(
             "\"remainingMs\":null,\"pumpCommand\":\"off\",\"heaterInhibited\":false") !=
         std::string::npos);
  response = workflow_handoff.request(HttpMethod::kPost,
                                      "/api/v2/cooldowns/start", authorization,
                                      kCooldownStart, 11002);
  assert(response.status == 200);
  assert(workflow_handoff.extraction.active());
  assert(workflow_handoff.pump.command() == PumpCommand::kRunning);

  ApiHarness failed_off;
  failed_off.controller.update(ok(96.0F), 2000);
  assert(failed_off
             .request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                      authorization, kCooldownStart, 2000)
             .status == 200);
  failed_off.pump_output.fail_low = true;
  expect_error(failed_off.request(HttpMethod::kPost,
                                  "/api/v2/cooldowns/stop", authorization,
                                  "", 3000),
               500, "internal_error");
  response = failed_off.request(HttpMethod::kGet, "/api/v2/state",
                                authorization, "", 3000);
  assert(response.status == 200);
  assert(response.body.find("\"status\":\"fault\"") != std::string::npos);
  assert(response.body.find("\"pumpCommand\":\"running\"") !=
         std::string::npos);
  assert(response.body.find("\"outcome\":\"failed\"") !=
         std::string::npos);

  ApiHarness extraction_conflict_harness;
  assert(extraction_conflict_harness
             .request(
                 HttpMethod::kPost, "/api/v2/extractions/start", authorization,
                 "{\"idempotencyKey\":\"start-01J2COOLBLOCK1\",\"selection\":{\"kind\":\"manual\"}}",
                 2000)
             .status == 200);
  response = extraction_conflict_harness.request(
      HttpMethod::kPost, "/api/v2/cooldowns/start", authorization,
      kCooldownStart, 2000);
  expect_error(response, 409, "extraction_active");
  assert(response.body.find("\"activeExtraction\":") != std::string::npos);

  ApiHarness not_required;
  not_required.controller.update(ok(93.0F), 2000);
  expect_error(not_required.request(HttpMethod::kPost,
                                    "/api/v2/cooldowns/start", authorization,
                                    kCooldownStart, 2000),
               409, "cooldown_not_required");

  ApiHarness unavailable;
  unavailable.controller.update(
      {ThermocoupleStatus::kOpenCircuit, 0.0F, 0}, 2000);
  expect_error(unavailable.request(HttpMethod::kPost,
                                   "/api/v2/cooldowns/start", authorization,
                                   kCooldownStart, 2000),
               409, "sensor_unavailable");

  ApiHarness faulted;
  faulted.controller.latch_fault(FaultCode::kInternalError);
  expect_error(faulted.request(HttpMethod::kPost,
                               "/api/v2/cooldowns/start", authorization,
                               kCooldownStart, 2000),
               409, "machine_faulted");

  ApiHarness steam;
  steam.controller.update(ok(96.0F), 2000);
  assert(steam.controller.set_mode(ControlMode::kSteam, 2000));
  response = steam.request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                           authorization, kCooldownStart, 2000);
  assert(response.status == 200);
  assert(steam.controller.mode() == ControlMode::kBrew);

  ApiHarness output_failure;
  output_failure.controller.update(ok(96.0F), 2000);
  output_failure.pump_output.fail_high = true;
  expect_error(output_failure.request(HttpMethod::kPost,
                                      "/api/v2/cooldowns/start",
                                      authorization, kCooldownStart, 2000),
               500, "internal_error");
  response = output_failure.request(HttpMethod::kGet, "/api/v2/state",
                                    authorization, "", 2000);
  assert(response.body.find("\"status\":\"fault\"") != std::string::npos);
  assert(response.body.find("\"outcome\":\"failed\"") !=
         std::string::npos);

  for (const char* body : {
           "{}",
           "{\"idempotencyKey\":\"short\"}",
           "{\"idempotencyKey\":\"cooldown-01J2APIROUTE1\",\"extra\":true}",
           "{\"idempotencyKey\":1}",
       }) {
    expect_error(initial.request(HttpMethod::kPost,
                                 "/api/v2/cooldowns/start", authorization,
                                 body),
                 400, "malformed_request");
  }
}

void capture_contract_payloads(const std::filesystem::path& directory) {
  ApiHarness harness;
  const char* authorization = "Bearer test-secret";
  write_capture(directory, "health.json",
                harness.request(HttpMethod::kGet, "/healthz").body);
  write_capture(directory, "device.json",
                harness.request(HttpMethod::kGet, "/api/v1/device").body);
  write_capture(directory, "state.json",
                harness.request(HttpMethod::kGet, "/api/v1/state",
                                authorization).body);
  write_capture(directory, "temperatures-response.json",
                harness.request(HttpMethod::kPatch,
                                "/api/v1/settings/temperatures", authorization,
                                "{\"brewTargetC\":95}").body);
  write_capture(directory, "mode-response.json",
                harness.request(HttpMethod::kPut, "/api/v1/mode",
                                authorization, "{\"mode\":\"steam\"}").body);
  write_capture(directory, "heater-response.json",
                harness.request(HttpMethod::kPut, "/api/v1/heater",
                                authorization,
                                "{\"heaterEnabled\":false}").body);
  write_capture(directory, "error.json",
                harness.request(HttpMethod::kGet, "/api/v1/state").body);
  write_capture(directory, "state-v2.json",
                harness.request(HttpMethod::kGet, "/api/v2/state",
                                authorization).body);
  ApiHarness temperature_calibration;
  write_capture(
      directory, "temperature-calibration-uncalibrated-v2.json",
      temperature_calibration
          .request(HttpMethod::kGet,
                   "/api/v2/temperature-calibration",
                   authorization, "", 2000)
          .body);
  const auto calibration_started = temperature_calibration.request(
      HttpMethod::kPost, "/api/v2/temperature-calibration/start",
      authorization, "", 2000);
  write_capture(directory, "temperature-calibration-active-v2.json",
                calibration_started.body);
  const auto calibration_id =
      json_string_field(calibration_started.body, "calibrationId");
  const std::string calibration_candidate =
      std::string("{\"calibrationId\":\"") + calibration_id +
      "\",\"candidateRawTargetC\":108}";
  temperature_calibration.request(
      HttpMethod::kPut,
      "/api/v2/temperature-calibration/candidate",
      authorization, calibration_candidate.c_str(), 2500);
  const std::string calibration_session =
      std::string("{\"calibrationId\":\"") + calibration_id + "\"}";
  write_capture(
      directory, "temperature-calibration-calibrated-v2.json",
      temperature_calibration
          .request(HttpMethod::kPost,
                   "/api/v2/temperature-calibration/save",
                   authorization, calibration_session.c_str(), 3000)
          .body);
  harness.history.record(184000, harness.controller.snapshot(184000),
                         harness.pump.command());
  write_capture(directory, "history-v2.json",
                harness.request(HttpMethod::kGet, "/api/v2/history",
                                authorization).body);
  ApiHarness steam_harness;
  assert(steam_harness.controller.set_mode(ControlMode::kSteam, 2000));
  steam_harness.controller.update(ok(115.0F), 2500);
  write_capture(directory, "state-steam.json",
                steam_harness
                    .request(HttpMethod::kGet, "/api/v1/state",
                             authorization, "", 2500)
                    .body);
  write_capture(directory, "profiles-v2.json",
                harness.request(HttpMethod::kGet, "/api/v2/profiles",
                                authorization).body);
  write_capture(directory, "scale-v2.json",
                harness.request(HttpMethod::kGet, "/api/v2/scale",
                                authorization).body);
  ApiHarness trace_harness;
  const auto trace_start = trace_harness.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"trace-capture-0001\",\"selection\":{\"kind\":\"profile\",\"profileId\":\"profile-1\"},\"weightControl\":{\"targetWeightDecigrams\":350,\"compensationDecigrams\":20}}",
      1100U);
  assert(trace_start.status == 200);
  for (std::uint32_t now_ms = 1100U; now_ms <= 1600U; now_ms += 250U) {
    const auto scale = trace_harness.scale.snapshot(now_ms);
    trace_harness.weighted_trace.record(
        now_ms, trace_harness.controller.snapshot(now_ms),
        trace_harness.extraction.snapshot(now_ms), scale,
        trace_harness.extraction.weight_snapshot(scale, now_ms));
  }
  write_capture(
      directory, "scale-trace-v2.json",
      trace_harness
          .request(HttpMethod::kGet, "/api/v2/scale/trace", authorization, "",
                   1600U)
          .body);
  ApiHarness extraction_harness;
  write_capture(directory, "extraction-running-v2.json",
                extraction_harness.request(
                    HttpMethod::kPost, "/api/v2/extractions/start",
                    authorization,
                    "{\"idempotencyKey\":\"start-01J2ABCDEF1234\",\"selection\":{\"kind\":\"manual\"}}",
                    2000)
                    .body);
  write_capture(directory, "state-compensation-v2.json",
                extraction_harness
                    .request(HttpMethod::kGet, "/api/v2/state",
                             authorization, "", 2000)
                    .body);
  write_capture(directory, "extraction-conflict-v2.json",
                extraction_harness.request(
                    HttpMethod::kPost, "/api/v2/extractions/start",
                    authorization,
                    "{\"idempotencyKey\":\"start-01J2OTHERKEY99\",\"selection\":{\"kind\":\"manual\"}}",
                    2000)
                    .body);
  write_capture(directory, "extraction-idle-v2.json",
                extraction_harness
                    .request(HttpMethod::kPost,
                             "/api/v2/extractions/stop", authorization,
                             "", 2000)
                    .body);

  constexpr char kCooldownStart[] =
      "{\"idempotencyKey\":\"cooldown-01J2CAPTURE01\"}";
  ApiHarness cooldown_harness;
  cooldown_harness.controller.update(ok(96.0F), 2000);
  write_capture(directory, "cooldown-start-v2.json",
                cooldown_harness
                    .request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                             authorization, kCooldownStart, 2000)
                    .body);
  write_capture(directory, "cooldown-replay-v2.json",
                cooldown_harness
                    .request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                             authorization, kCooldownStart, 3000)
                    .body);
  write_capture(
      directory, "cooldown-conflict-v2.json",
      cooldown_harness
          .request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                   authorization,
                   "{\"idempotencyKey\":\"cooldown-01J2CAPTURE02\"}", 3000)
          .body);
  write_capture(directory, "cooldown-stop-v2.json",
                cooldown_harness
                    .request(HttpMethod::kPost, "/api/v2/cooldowns/stop",
                             authorization, "", 3000)
                    .body);
  write_capture(directory, "state-cooldown-v2.json",
                cooldown_harness
                    .request(HttpMethod::kGet, "/api/v2/state",
                             authorization, "", 3000)
                    .body);
  cooldown_harness.request(HttpMethod::kPost, "/api/v2/cooldowns/stop",
                           authorization, "", 8000);
  write_capture(directory, "cooldown-terminal-v2.json",
                cooldown_harness
                    .request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                             authorization, kCooldownStart, 9000)
                    .body);

  ApiHarness handoff_harness;
  handoff_harness.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-capture-before-cool\",\"selection\":{\"kind\":\"manual\"}}",
      2000);
  handoff_harness.request(HttpMethod::kPost, "/api/v2/extractions/stop",
                          authorization, "", 3000);
  handoff_harness.controller.update(ok(96.0F), 3000);
  handoff_harness.request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                          authorization, kCooldownStart, 4000);
  write_capture(directory, "state-cooldown-after-extraction-v2.json",
                handoff_harness
                    .request(HttpMethod::kGet, "/api/v2/state",
                             authorization, "", 4000)
                    .body);
  handoff_harness.request(HttpMethod::kPost, "/api/v2/cooldowns/stop",
                          authorization, "", 5000);
  handoff_harness.request(HttpMethod::kPost, "/api/v2/cooldowns/stop",
                          authorization, "", 10000);
  handoff_harness.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-capture-after-cool-1\",\"selection\":{\"kind\":\"manual\"}}",
      11000);
  write_capture(directory, "state-extraction-after-cooldown-v2.json",
                handoff_harness
                    .request(HttpMethod::kGet, "/api/v2/state",
                             authorization, "", 11000)
                    .body);

  ApiHarness not_required;
  not_required.controller.update(ok(93.0F), 2000);
  write_capture(directory, "cooldown-not-required-v2.json",
                not_required
                    .request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                             authorization, kCooldownStart, 2000)
                    .body);
  ApiHarness unavailable;
  unavailable.controller.update(
      {ThermocoupleStatus::kOpenCircuit, 0.0F, 0}, 2000);
  write_capture(directory, "cooldown-sensor-unavailable-v2.json",
                unavailable
                    .request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                             authorization, kCooldownStart, 2000)
                    .body);
  ApiHarness machine_faulted;
  machine_faulted.controller.latch_fault(FaultCode::kInternalError);
  write_capture(directory, "cooldown-machine-faulted-v2.json",
                machine_faulted
                    .request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                             authorization, kCooldownStart, 2000)
                    .body);
  ApiHarness brew_required;
  assert(brew_required.controller.set_mode(ControlMode::kSteam, 2000));
  write_capture(
      directory, "brew-mode-required-v2.json",
      brew_required
          .request(
              HttpMethod::kPost, "/api/v2/extractions/start", authorization,
              "{\"idempotencyKey\":\"start-01J2BREWCAP01\",\"selection\":{\"kind\":\"manual\"}}",
              2000)
          .body);
  ApiHarness output_failure;
  output_failure.controller.update(ok(96.0F), 2000);
  output_failure.pump_output.fail_high = true;
  output_failure.request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                         authorization, kCooldownStart, 2000);
  write_capture(directory, "state-cooldown-failed-v2.json",
                output_failure
                    .request(HttpMethod::kGet, "/api/v2/state",
                             authorization, "", 2000)
                    .body);

  ApiHarness off_failure;
  off_failure.controller.update(ok(96.0F), 2000);
  off_failure.request(HttpMethod::kPost, "/api/v2/cooldowns/start",
                      authorization, kCooldownStart, 2000);
  off_failure.pump_output.fail_low = true;
  off_failure.request(HttpMethod::kPost, "/api/v2/cooldowns/stop",
                      authorization, "", 3000);
  write_capture(directory, "state-cooldown-failed-running-v2.json",
                off_failure
                    .request(HttpMethod::kGet, "/api/v2/state",
                             authorization, "", 3000)
                    .body);

  ApiHarness fault_harness;
  fault_harness.controller.update(
      ok(std::numeric_limits<float>::quiet_NaN()), 2000);
  write_capture(directory, "state-fault.json",
                fault_harness.request(HttpMethod::kGet, "/api/v1/state",
                                      authorization).body);
}

void test_bounded_history_contract() {
  ApiHarness harness;
  const char* authorization = "Bearer test-secret";
  for (std::uint64_t second = 1; second <= 605; ++second) {
    const auto now = second * 1000U;
    assert(harness.history.record(now,
                                  harness.controller.snapshot(
                                      static_cast<std::uint32_t>(now)),
                                  harness.pump.command()));
  }

  auto response = harness.request(HttpMethod::kGet, "/api/v2/history",
                                  authorization, "", 605000);
  assert(response.status == 200);
  assert(response.body.size() <= kMaximumSerializedHistoryPageBytes);
  assert(response.body.find("\"continuity\":\"initial\"") !=
         std::string::npos);
  assert(response.body.find("\"oldestSequence\":6") != std::string::npos);
  assert(response.body.find("\"sequence\":6") != std::string::npos);
  assert(response.body.find("\"hasMore\":true") != std::string::npos);
  assert(response.body.find("\"controllerConfiguration\":{") !=
         std::string::npos);
  assert(response.body.find("\"selectedController\":\"legacy_curve\"") !=
         std::string::npos);
  assert(response.body.find("\"controllerDiagnostics\":{") !=
         std::string::npos);
  assert(response.body.find("\"predictedTemperature5sC\"") ==
         std::string::npos);

  response = harness.request(
      HttpMethod::kGet,
      "/api/v2/history?bootId=00112233445566778899aabbccddeeff&afterSequence=1",
      authorization, "", 605000);
  assert(response.status == 200);
  assert(response.body.find("\"continuity\":\"truncated\"") !=
         std::string::npos);

  response = harness.request(
      HttpMethod::kGet,
      "/api/v2/history?bootId=ffeeddccbbaa99887766554433221100&afterSequence=1",
      authorization, "", 605000);
  assert(response.status == 200);
  assert(response.body.find("\"continuity\":\"reset\"") !=
         std::string::npos);

  expect_error(harness.request(HttpMethod::kGet,
                               "/api/v2/history?afterSequence=1",
                               authorization),
               400, "malformed_request");
  expect_error(harness.request(
                   HttpMethod::kGet,
                   "/api/v2/history?bootId=00112233445566778899aabbccddeeff&afterSequence=9999",
                   authorization),
               400, "malformed_request");
}

void test_api_v2_state_reads_are_observational() {
  const char* authorization = "Bearer test-secret";
  ApiHarness extraction;
  auto response = extraction.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"observational-manual-1\",\"selection\":{\"kind\":\"manual\"}}",
      1000U);
  assert(response.status == 200);
  assert(!extraction.controller.extraction_compensation_active());

  const auto first = extraction.request(
      HttpMethod::kGet, "/api/v2/state", authorization, "", 5000U);
  const auto repeated = extraction.request(
      HttpMethod::kGet, "/api/v2/state", authorization, "", 5000U);
  assert(first.status == 200);
  assert(first.body == repeated.body);
  assert(first.body.find("\"phase\":\"manual\"") != std::string::npos);
  assert(first.body.find("\"pumpCommand\":\"running\"") != std::string::npos);
  assert(!extraction.controller.extraction_compensation_active());

  assert(extraction.extraction.update(5000U) ==
         ExtractionUpdateResult::kOk);
  extraction.controller.set_extraction_phase(
      extraction.extraction.snapshot(5000U).phase, 5000U);
  assert(extraction.controller.extraction_compensation_active());
  response = extraction.request(
      HttpMethod::kPost, "/api/v2/extractions/stop", authorization, "",
      5100U);
  assert(response.status == 200);
  extraction.controller.update(ok(96.0F), 5200U);
  response = extraction.request(
      HttpMethod::kPost, "/api/v2/cooldowns/start", authorization,
      "{\"idempotencyKey\":\"observational-handoff-1\"}", 5200U);
  assert(response.status == 200);
  extraction.request(HttpMethod::kGet, "/api/v2/state", authorization, "",
                     5300U);
  assert(extraction.controller.extraction_compensation_active());
  extraction.controller.set_extraction_phase(ExtractionPhase::kIdle, 5300U);
  assert(!extraction.controller.extraction_compensation_active());

  ApiHarness cooldown;
  cooldown.controller.update(ok(96.0F), 2000U);
  response = cooldown.request(
      HttpMethod::kPost, "/api/v2/cooldowns/start", authorization,
      "{\"idempotencyKey\":\"observational-cooldown-1\"}", 2000U);
  assert(response.status == 200);
  const auto before_deadline = cooldown.request(
      HttpMethod::kGet, "/api/v2/state", authorization, "", 48000U);
  const auto repeated_deadline = cooldown.request(
      HttpMethod::kGet, "/api/v2/state", authorization, "", 48000U);
  assert(before_deadline.body == repeated_deadline.body);
  assert(before_deadline.body.find("\"status\":\"pumping\"") !=
         std::string::npos);
  assert(cooldown.pump.command() == PumpCommand::kRunning);

  assert(cooldown.cooldown.update(
             {true, false, false, 96.0F}, 48000U) ==
         CooldownUpdateResult::kOk);
  const auto advanced = cooldown.request(
      HttpMethod::kGet, "/api/v2/state", authorization, "", 48000U);
  assert(advanced.body.find("\"status\":\"stabilizing\"") !=
         std::string::npos);
  assert(cooldown.pump.command() == PumpCommand::kOff);
}

void test_scale_api_and_weighted_start_contract() {
  ApiHarness harness;
  const char* authorization = "Bearer test-secret";
  auto response =
      harness.request(HttpMethod::kGet, "/api/v2/scale", authorization, "",
                      1100);
  assert(response.status == 200);
  assert(response.body.find("\"availability\":\"ready\"") !=
         std::string::npos);
  assert(response.body.find("\"grossWeightDecigrams\":800") !=
         std::string::npos);

  response = harness.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"weighted-api-start-1\",\"selection\":{\"kind\":\"profile\",\"profileId\":\"profile-2\"},\"weightControl\":{\"targetWeightDecigrams\":350,\"compensationDecigrams\":20}}",
      1100);
  assert(response.status == 200);
  assert(harness.pump.command() == PumpCommand::kRunning);

  for (std::int32_t index = 0; index < 10; ++index) {
    harness.scale.update({Hx711Status::kOk, 113000}, 2000U + index);
  }
  const auto scale = harness.scale.snapshot(2010U);
  assert(harness.extraction.update(2010U, &scale) ==
         ExtractionUpdateResult::kCompleted);
  response = harness.request(HttpMethod::kGet, "/api/v2/state",
                             authorization, "", 2010);
  assert(response.status == 200);
  assert(harness.pump.command() == PumpCommand::kOff);
  response =
      harness.request(HttpMethod::kGet, "/api/v2/scale", authorization, "",
                      2010);
  assert(response.body.find("\"completionReason\":\"weight-reached\"") !=
         std::string::npos);
  assert(response.body.find("\"finalWeightDecigrams\":330") !=
         std::string::npos);

  ApiHarness calibration;
  response = calibration.request(
      HttpMethod::kPost, "/api/v2/scale/calibration/start", authorization,
      "", 1100);
  assert(response.status == 200);
  for (std::int32_t index = 0; index < 10; ++index) {
    calibration.scale.update({Hx711Status::kOk, 90000}, 1200U + index);
  }
  response = calibration.request(
      HttpMethod::kPost, "/api/v2/scale/calibration/complete", authorization,
      "{\"referenceWeightDecigrams\":1000}", 1300);
  assert(response.status == 200);
  assert(response.body.find("\"calibrationStatus\":\"calibrated\"") !=
         std::string::npos);
  assert(calibration.scale_backend.save_count == 1);

  ApiHarness retry_calibration;
  response = retry_calibration.request(
      HttpMethod::kPost, "/api/v2/scale/calibration/start", authorization,
      "", 1100);
  assert(response.status == 200);
  for (std::int32_t index = 0; index < 10; ++index) {
    retry_calibration.scale.update({Hx711Status::kOk, 90000}, 1200U + index);
  }
  retry_calibration.scale_backend.fail_save = true;
  expect_error(
      retry_calibration.request(
          HttpMethod::kPost, "/api/v2/scale/calibration/complete",
          authorization, "{\"referenceWeightDecigrams\":1000}", 1300),
      500, "persistence_failure");
  assert(retry_calibration.scale_backend.save_count == 1);
  retry_calibration.scale_backend.fail_save = false;
  response = retry_calibration.request(
      HttpMethod::kPost, "/api/v2/scale/calibration/complete", authorization,
      "{\"referenceWeightDecigrams\":1000}", 1310);
  assert(response.status == 200);
  assert(retry_calibration.scale_backend.save_count == 2);

  ApiHarness adoption_retry;
  response = adoption_retry.request(
      HttpMethod::kPost, "/api/v2/scale/calibration/start", authorization,
      "", 1100);
  assert(response.status == 200);
  for (std::int32_t index = 0; index < 10; ++index) {
    adoption_retry.scale.update({Hx711Status::kOk, 90000}, 1200U + index);
  }
  adoption_retry.synchronization.fail_on_lock =
      adoption_retry.synchronization.lock_count + 2;
  expect_error(
      adoption_retry.request(
          HttpMethod::kPost, "/api/v2/scale/calibration/complete",
          authorization, "{\"referenceWeightDecigrams\":1000}", 1300),
      500, "internal_error");
  assert(adoption_retry.scale_backend.save_count == 1);
  response = adoption_retry.request(
      HttpMethod::kPost, "/api/v2/scale/calibration/cancel", authorization,
      "", 1310);
  assert(response.status == 200);
  assert(response.body.find("\"calibrationStatus\":\"calibrating\"") !=
         std::string::npos);
  expect_error(
      adoption_retry.request(
          HttpMethod::kPost, "/api/v2/scale/calibration/start",
          authorization, "", 1310),
      409, "calibration_in_progress");
  expect_error(
      adoption_retry.request(
          HttpMethod::kPost, "/api/v2/extractions/start", authorization,
          "{\"idempotencyKey\":\"pending-adoption-weighted\",\"selection\":{\"kind\":\"profile\",\"profileId\":\"profile-2\"},\"weightControl\":{\"targetWeightDecigrams\":350,\"compensationDecigrams\":20}}",
          1310),
      409, "scale_not_calibrated");
  assert(adoption_retry.pump.command() == PumpCommand::kOff);
  response = adoption_retry.request(
      HttpMethod::kPost, "/api/v2/scale/calibration/complete", authorization,
      "{\"referenceWeightDecigrams\":1000}", 1320);
  assert(response.status == 200);
  assert(response.body.find("\"calibrationStatus\":\"calibrated\"") !=
         std::string::npos);
  assert(adoption_retry.scale_backend.save_count == 2);

  ApiHarness stale_calibration;
  for (std::int32_t index = 0; index < 10; ++index) {
    stale_calibration.scale.update(
        {Hx711Status::kOk, 2000000 + index * 75}, 2000U + index * 10U);
  }
  response = stale_calibration.request(
      HttpMethod::kGet, "/api/v2/scale", authorization, "", 2100);
  assert(response.status == 200);
  assert(response.body.find("\"availability\":\"unavailable\"") !=
         std::string::npos);
  response = stale_calibration.request(
      HttpMethod::kPost, "/api/v2/scale/calibration/start", authorization,
      "", 2100);
  assert(response.status == 200);
  assert(response.body.find("\"availability\":\"ready\"") !=
         std::string::npos);
  assert(response.body.find("\"calibrationStatus\":\"calibrating\"") !=
         std::string::npos);
}

void test_history_capture_deadline_does_not_accumulate_jitter() {
  ApiHarness harness;
  HistoryBuffer history("00112233445566778899aabbccddeeff");
  const auto snapshot = harness.controller.snapshot(1000U);

  assert(history.record(1067U, snapshot, PumpCommand::kOff));
  assert(!history.record(1999U, snapshot, PumpCommand::kOff));
  assert(history.record(2000U, snapshot, PumpCommand::kOff));
  assert(!history.record(2999U, snapshot, PumpCommand::kOff));
  assert(history.record(3000U, snapshot, PumpCommand::kOff));
}

void test_weighted_trace_is_bounded_paginated_and_observational() {
  ApiHarness harness;
  const auto scale = harness.scale.snapshot(1100U);
  const ExtractionSelection selection{ExtractionSelectionKind::kProfile, 0U};
  const WeightControl control{350, 60};
  assert(harness.extraction.start("weighted-trace-0001", selection, 1100U,
                                  &control, &scale) ==
         StartExtractionResult::kStarted);

  for (std::uint32_t index = 0; index < 20U; ++index) {
    const auto now_ms = 1100U + index * kWeightedTraceIntervalMs;
    const auto extraction = harness.extraction.snapshot(now_ms);
    const auto current_scale = harness.scale.snapshot(now_ms);
    const auto weight =
        harness.extraction.weight_snapshot(current_scale, now_ms);
    assert(harness.weighted_trace.record(
        now_ms, harness.controller.snapshot(now_ms), extraction,
        current_scale, weight));
  }

  auto response = harness.request(HttpMethod::kGet, "/api/v2/scale/trace",
                                  "Bearer test-secret", "", 6000U);
  assert(response.status == 200);
  assert(response.body.find("\"trace\":{\"deviceId\":\"philcoino-0102AF\"") !=
         std::string::npos);
  assert(response.body.find("\"hasMore\":true") != std::string::npos);
  assert(response.body.find("\"sequence\":16") != std::string::npos);
  assert(response.body.find("\"sequence\":17") == std::string::npos);

  response = harness.request(
      HttpMethod::kGet,
      "/api/v2/scale/trace?extractionId=run-1&bootId=00112233445566778899aabbccddeeff&afterSequence=16",
      "Bearer test-secret", "", 6000U);
  assert(response.status == 200);
  assert(response.body.find("\"continuity\":\"continuous\"") !=
         std::string::npos);
  assert(response.body.find("\"sequence\":17") != std::string::npos);
  assert(response.body.find("\"hasMore\":false") != std::string::npos);

  response = harness.request(
      HttpMethod::kGet,
      "/api/v2/scale/trace?extractionId=run-1&afterSequence=16",
      "Bearer test-secret", "", 6000U);
  expect_error(response, 400, "malformed_request");
}

void test_controller_diagnostics_history_page_stays_within_transport_budget() {
  ApiHarness harness;
  for (std::uint32_t now_ms = 1500U; now_ms <= 42000U; now_ms += 500U) {
    const float temperature_c =
        88.0F + static_cast<float>(now_ms - 1500U) / 20000.0F;
    const auto snapshot = harness.controller.update(
        ok(temperature_c), harness.pump.command(), now_ms);
    harness.history.record(now_ms, snapshot, harness.pump.command());
  }

  const auto response = harness.request(
      HttpMethod::kGet,
      "/api/v2/history?bootId=00112233445566778899aabbccddeeff&afterSequence=31",
      "Bearer test-secret", "", 42000U);
  assert(response.status == 200);
  assert(response.body.find("\"controllerDiagnostics\":{") !=
         std::string::npos);
  assert(response.body.find("\"piRequestedDuty\":") != std::string::npos);
  assert(response.body.size() <= kMaximumSerializedHistoryPageBytes);
}

}  // namespace

int main(int argc, char** argv) {
  test_public_contract_and_authentication();
  test_state_and_mutations_delegate_to_control();
  test_effective_temperature_serializes_once_across_v1_v2_and_modes();
  test_over_temperature_dismissal_endpoint_is_guarded();
  test_malformed_and_domain_failures_do_not_bypass_validation();
  test_api_v2_profiles_and_extraction_contract();
  test_api_v2_state_reads_are_observational();
  test_api_v2_rejects_malformed_nested_shapes_and_lock_failure();
  test_target_adoption_lock_failure_retains_the_heater_inhibit();
  test_unsafe_target_is_rejected_without_persistence_or_clamping();
  test_temperature_calibration_api_transaction_and_persistence();
  test_temperature_calibration_api_failure_expiry_and_conflicts();
  test_temperature_calibration_api_start_guards_and_session_ownership();
  test_workflow_mode_coordination_is_authoritative();
  test_api_v2_cooldown_and_compensation_contract();
  test_bounded_history_contract();
  test_scale_api_and_weighted_start_contract();
  test_history_capture_deadline_does_not_accumulate_jitter();
  test_weighted_trace_is_bounded_paginated_and_observational();
  test_controller_diagnostics_history_page_stays_within_transport_budget();
  if (argc == 2) {
    capture_contract_payloads(argv[1]);
  }
  return 0;
}
