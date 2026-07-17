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

class FakeApiSynchronization final : public ApiSynchronization {
 public:
  bool lock(ApiDomain) override {
    ++lock_count;
    return !fail_lock && lock_count != fail_on_lock;
  }
  void unlock(ApiDomain) override {}
  bool fail_lock{false};
  int fail_on_lock{0};
  int lock_count{0};
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
  ApiHarness()
      : backend(memory),
        storage(backend),
        ssr(output, safety_lease, ssr_critical_section),
        controller(memory.targets, ssr),
        profile_storage(profile_backend),
        pump(pump_output, pump_critical_section),
        extraction(profile_backend.saved, pump),
        cooldown(controller, pump),
        api({"philcoino-0102AF", "PhilcoINO", "ESP32-C3 Super Mini", "0.2.0"},
            "test-secret", controller, storage, extraction, cooldown,
            profile_storage, synchronization) {
    assert(ssr.initialize());
    assert(pump.initialize());
    controller.update(ok(87.5F), 1000);
  }

  HttpResponse request(HttpMethod method, const char* path,
                       const char* authorization = nullptr,
                       const char* body = "", std::uint64_t now_ms = 184220) {
    return api.handle(method, path, authorization, body, now_ms);
  }

  MemoryState memory{};
  MemoryBackend backend;
  TargetStorage storage;
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
  FakeApiSynchronization synchronization;
  FirmwareApi api;
};

void expect_error(const HttpResponse& response, int status,
                  const char* code) {
  assert(response.status == status);
  assert(response.body.find(std::string("\"code\":\"") + code + "\"") !=
         std::string::npos);
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

  for (const auto& request :
       std::vector<std::pair<HttpMethod, const char*>>{
           {HttpMethod::kGet, "/api/v1/state"},
           {HttpMethod::kPatch, "/api/v1/settings/temperatures"},
           {HttpMethod::kPut, "/api/v1/mode"},
           {HttpMethod::kPut, "/api/v1/heater"},
           {HttpMethod::kPost, "/api/v1/faults/over-temperature/dismiss"},
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
  assert(!constant_time_bearer_matches("Bearer test-secreu", "test-secret"));
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

  ApiHarness steam;
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

  ApiHarness brew;
  brew.controller.update(ok(115.0F), 2500);
  response = brew.request(HttpMethod::kGet, "/api/v1/state", authorization,
                          "", 2500);
  assert(response.status == 200);
  assert(response.body.find("\"activeMode\":\"brew\"") !=
         std::string::npos);
  assert(response.body.find("\"boilerTemperatureC\":115") !=
         std::string::npos);

  ApiHarness switching;
  response = switching.request(HttpMethod::kGet, "/api/v1/state",
                               authorization, "", 3000);
  assert(response.body.find("\"boilerTemperatureC\":87.5") !=
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
  assert(response.body.find("\"boilerTemperatureC\":87.5") !=
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
                           "{\"steamTargetC\":121}",
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

  ApiHarness fault_harness;
  fault_harness.controller.update(
      ok(std::numeric_limits<float>::quiet_NaN()), 2000);
  write_capture(directory, "state-fault.json",
                fault_harness.request(HttpMethod::kGet, "/api/v1/state",
                                      authorization).body);
}

}  // namespace

int main(int argc, char** argv) {
  test_public_contract_and_authentication();
  test_state_and_mutations_delegate_to_control();
  test_effective_temperature_serializes_once_across_v1_v2_and_modes();
  test_over_temperature_dismissal_endpoint_is_guarded();
  test_malformed_and_domain_failures_do_not_bypass_validation();
  test_api_v2_profiles_and_extraction_contract();
  test_api_v2_rejects_malformed_nested_shapes_and_lock_failure();
  test_target_adoption_lock_failure_retains_the_heater_inhibit();
  test_workflow_mode_coordination_is_authoritative();
  test_api_v2_cooldown_and_compensation_contract();
  if (argc == 2) {
    capture_contract_payloads(argv[1]);
  }
  return 0;
}
