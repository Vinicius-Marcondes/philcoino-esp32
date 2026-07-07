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

class FakeDigitalOutput final : public DigitalOutput {
 public:
  bool set_level(bool high) override {
    level = high;
    return true;
  }

  bool configure_output() override { return true; }

  bool level{false};
};

ThermocoupleReading ok(float temperature_c) {
  return {ThermocoupleStatus::kOk, temperature_c, 0};
}

struct ApiHarness {
  ApiHarness()
      : backend(memory),
        storage(backend),
        ssr(output),
        controller(memory.targets, ssr),
        api({"philcoino-0102AF", "PhilcoINO", "ESP32-C3 Super Mini", "0.1.0"},
            "test-secret", controller, storage) {
    assert(ssr.initialize());
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
  FailOffSsr ssr;
  TemperatureController controller;
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
  harness.controller.latch_fault(FaultCode::kSensorFailure);
  expect_error(harness.request(HttpMethod::kPut, "/api/v1/mode",
                               authorization, "{\"mode\":\"steam\"}"),
               409, "sensor_unavailable");
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
  write_capture(directory, "error.json",
                harness.request(HttpMethod::kGet, "/api/v1/state").body);

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
  if (argc == 2) {
    capture_contract_payloads(argv[1]);
  }
  return 0;
}
