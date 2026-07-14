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
  bool lock(ApiDomain) override { return !fail_lock; }
  void unlock(ApiDomain) override {}
  bool fail_lock{false};
};

class FakeDigitalOutput final : public DigitalOutput {
 public:
  bool set_level(bool high) override {
    level = high;
    return true;
  }

  bool configure_output() override { return true; }

  bool level{false};
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

ThermocoupleReading ok(float temperature_c) {
  return {ThermocoupleStatus::kOk, temperature_c, 0};
}

struct ApiHarness {
  ApiHarness()
      : backend(memory),
        storage(backend),
        ssr(output, safety_lease),
        controller(memory.targets, ssr),
        profile_storage(profile_backend),
        pump(pump_output),
        extraction(profile_backend.saved, pump),
        api({"philcoino-0102AF", "PhilcoINO", "ESP32-C3 Super Mini", "0.1.0"},
            "test-secret", controller, storage, extraction, profile_storage,
            synchronization) {
    assert(ssr.initialize());
    assert(pump.initialize());
    controller.update({ok(87.5F), ok(103.75F)}, 1000);
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
  FailOffSsr ssr;
  TemperatureController controller;
  ProfileMemoryBackend profile_backend;
  ProfileStorage profile_storage;
  FakeDigitalOutput pump_output{};
  FailOffPump pump;
  ExtractionController extraction;
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
                                "ESP32-C3 Super Mini", "0.1.0"};
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

void test_over_temperature_dismissal_endpoint_is_guarded() {
  ApiHarness harness;
  const char* authorization = "Bearer test-secret";

  auto response = harness.request(
      HttpMethod::kPost, "/api/v1/faults/over-temperature/dismiss",
      authorization);
  expect_error(response, 409, "sensor_unavailable");

  harness.controller.update(
      {ok(static_cast<float>(philcoino::config::kBrewOverTemperatureC)),
       ok(100.0F)},
      2000);
  response = harness.request(
      HttpMethod::kPost, "/api/v1/faults/over-temperature/dismiss",
      authorization, "", 3000);
  expect_error(response, 409, "sensor_unavailable");

  harness.controller.update({ok(93.0F), ok(100.0F)}, 4000);
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
  assert(response.status == 200);
  assert(response.body.find("\"extractionId\":\"run-1\"") !=
         std::string::npos);
  assert(response.body.find("\"elapsedMs\":1000") != std::string::npos);

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
  assert(harness.request(HttpMethod::kPost, "/api/v2/extractions/stop",
                         authorization).status == 200);

  response = harness.request(
      HttpMethod::kPost, "/api/v2/extractions/start", authorization,
      "{\"idempotencyKey\":\"start-01J2EMPTYKEY999\",\"selection\":{\"kind\":\"profile\",\"profileId\":\"profile-3\"}}",
      7000);
  expect_error(response, 409, "profile_not_configured");

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
  write_capture(directory, "profiles-v2.json",
                harness.request(HttpMethod::kGet, "/api/v2/profiles",
                                authorization).body);
  write_capture(directory, "extraction-running-v2.json",
                harness.request(
                    HttpMethod::kPost, "/api/v2/extractions/start",
                    authorization,
                    "{\"idempotencyKey\":\"start-01J2ABCDEF1234\",\"selection\":{\"kind\":\"manual\"}}",
                    2000)
                    .body);
  write_capture(directory, "extraction-conflict-v2.json",
                harness.request(
                    HttpMethod::kPost, "/api/v2/extractions/start",
                    authorization,
                    "{\"idempotencyKey\":\"start-01J2OTHERKEY99\",\"selection\":{\"kind\":\"manual\"}}",
                    2000)
                    .body);
  write_capture(directory, "extraction-idle-v2.json",
                harness.request(HttpMethod::kPost,
                                "/api/v2/extractions/stop", authorization,
                                "", 2000)
                    .body);

  ApiHarness fault_harness;
  fault_harness.controller.update(
      {ok(std::numeric_limits<float>::quiet_NaN()), ok(100.0F)}, 2000);
  write_capture(directory, "state-fault.json",
                fault_harness.request(HttpMethod::kGet, "/api/v1/state",
                                      authorization).body);
}

}  // namespace

int main(int argc, char** argv) {
  test_public_contract_and_authentication();
  test_state_and_mutations_delegate_to_control();
  test_over_temperature_dismissal_endpoint_is_guarded();
  test_malformed_and_domain_failures_do_not_bypass_validation();
  test_api_v2_profiles_and_extraction_contract();
  test_api_v2_rejects_malformed_nested_shapes_and_lock_failure();
  if (argc == 2) {
    capture_contract_payloads(argv[1]);
  }
  return 0;
}
