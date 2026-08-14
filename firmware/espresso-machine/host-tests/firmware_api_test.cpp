#include <algorithm>
#include <cassert>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <limits>
#include <string>
#include <utility>
#include <vector>

#include "philcoino/api.hpp"
#include "philcoino/pairing.hpp"
#include "philcoino/config.hpp"

namespace {

using namespace philcoino::control;
using namespace philcoino::networking;
using namespace philcoino::peripherals;

constexpr char kTestAccessToken[] =
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
constexpr char kTestAuthorization[] =
    "Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

class FakePairingCrypto final : public PairingCrypto {
 public:
  bool random(Secret256& output) override {
    output.fill(static_cast<std::uint8_t>(++sequence));
    return true;
  }
  bool sha256(const std::uint8_t* data, std::size_t length,
              Secret256& output) override {
    output = {};
    for (std::size_t index = 0; index < length; ++index) {
      output[index % output.size()] ^=
          static_cast<std::uint8_t>(data[index] + index);
    }
    return true;
  }
  unsigned sequence{0};
};

class UnusedSrpFactory final : public PairingSrpFactory {
 public:
  std::unique_ptr<PairingSrpSession> create() override { return nullptr; }
};

class FakePairingStorage final : public PairingStorage {
 public:
  explicit FakePairingStorage(PairingCrypto& crypto) {
    Secret256 token{};
    Secret256 hash{};
    assert(base64url_decode(kTestAccessToken, token));
    assert(crypto.sha256(token.data(), token.size(), hash));
    assert(crypto.sha256(
        reinterpret_cast<const std::uint8_t*>("12345678"), 8U,
        state.pairing_code_fingerprint));
    state.clients[0].occupied = true;
    state.clients[0].token_hash = hash;
    state.clients[0].issued_sequence = 1;
    state.next_issued_sequence = 2;
  }
  bool load(PairingPersistentState& output) override {
    output = state;
    return true;
  }
  bool save(const PairingPersistentState& input) override {
    state = input;
    return true;
  }
  PairingPersistentState state{};
};

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

class SteamControlMemoryBackend final : public SteamControlSettingsBackend {
 public:
  BackendLoadResult load(SteamControlSettings& settings) override {
    settings = saved;
    return BackendLoadResult::kOk;
  }
  bool save(const SteamControlSettings& settings) override {
    assert(lock_held == nullptr || !*lock_held);
    ++save_count;
    if (fail_save) return false;
    saved = settings;
    return true;
  }

  SteamControlSettings saved{};
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
                      TemperatureTargets targets = {93, 115})
      : memory{targets, false},
        backend(memory),
        storage(backend),
        temperature_calibration_backend(calibration),
        temperature_calibration_storage(temperature_calibration_backend),
        ssr(output, safety_lease, ssr_critical_section),
        controller(memory.targets, calibration, ssr),
        pump(pump_output, pump_critical_section),
        extraction(pump),
        cooldown(controller, pump),
        steam_control_storage(steam_control_backend),
        scale_storage(scale_backend),
        scale(scale_backend.saved, true),
        pairing_storage(pairing_crypto),
        pairing({"philcoino-0102AF", "PhilcoINO", "ESP32-C3 Super Mini",
                 "0.3.0"},
                "12345678", {}, pairing_crypto, pairing_storage,
                srp_factory),
        api({"philcoino-0102AF", "PhilcoINO", "ESP32-C3 Super Mini", "0.2.0"},
            pairing, controller, storage,
            temperature_calibration_storage, extraction, cooldown,
            scale_storage, synchronization, &scale,
            &steam_control_storage) {
    assert(pairing.initialize());
    assert(ssr.initialize());
    assert(pump.initialize());
    scale_backend.lock_held = &synchronization.held;
    temperature_calibration_backend.lock_held =
        &synchronization.held;
    steam_control_backend.lock_held = &synchronization.held;
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
  FakeDigitalOutput pump_output{};
  FakeOutputCriticalSection pump_critical_section;
  FailOffPump pump;
  ExtractionController extraction;
  CooldownController cooldown;
  SteamControlMemoryBackend steam_control_backend;
  SteamControlSettingsStorage steam_control_storage;
  ScaleMemoryBackend scale_backend;
  ScaleCalibrationStorage scale_storage;
  ScaleController scale;
  FakeApiSynchronization synchronization;
  FakePairingCrypto pairing_crypto;
  FakePairingStorage pairing_storage;
  UnusedSrpFactory srp_factory;
  PairingService pairing;
  FirmwareApi api;
};

void expect_error(const HttpResponse& response, int status,
                  const char* code) {
  assert(response.status == status);
  assert(response.body.find(std::string("\"code\":\"") + code + "\"") !=
         std::string::npos);
}

void test_v3_route_and_authentication_boundary() {
  ApiHarness harness;
  const auto health = harness.request(HttpMethod::kGet, "/healthz");
  assert(health.status == 200);
  assert(health.body.find("\"status\":\"ok\"") != std::string::npos);

  for (const char* removed : {"/api/v1/device", "/api/v1/state",
                              "/api/v2/state", "/api/v2/scale/trace"}) {
    expect_error(harness.request(HttpMethod::kGet, removed), 404,
                 "internal_error");
  }

  auto response = harness.request(HttpMethod::kGet, "/api/v3/state");
  expect_error(response, 401, "unauthorized");
  assert(response.bearer_challenge);
  response = harness.request(HttpMethod::kGet, "/api/v3/state",
                             "Bearer invalid");
  expect_error(response, 401, "unauthorized");
  response = harness.request(HttpMethod::kGet, "/api/v3/state",
                             kTestAuthorization);
  assert(response.status == 200);
  assert(response.body.find("\"apiVersion\":\"3\"") !=
         std::string::npos);
  assert(response.body.find("\"revision\":") != std::string::npos);
  assert(response.body.find("\"capturedAtUptimeMs\":") !=
         std::string::npos);
}

void test_combined_settings_are_atomic_and_acknowledged_as_state() {
  ApiHarness harness;
  const auto response = harness.request(
      HttpMethod::kPatch, "/api/v3/settings", kTestAuthorization,
      "{\"brewTargetC\":94,\"steamTargetC\":121,"
      "\"steamControl\":{\"initialCompensationC\":10,"
      "\"decayDurationMs\":600000,\"readyTimeoutMs\":420000}}");
  assert(response.status == 200);
  assert(response.body.find("\"apiVersion\":\"3\"") !=
         std::string::npos);
  assert(response.body.find("\"brewTargetC\":94") != std::string::npos);
  assert(response.body.find("\"steamTargetC\":121") != std::string::npos);
  assert(response.body.find("\"initialCompensationC\":10") !=
         std::string::npos);
  assert(harness.memory.targets.brew_c == 94);
  assert(harness.memory.targets.steam_c == 121);
  assert(harness.steam_control_backend.saved.initial_compensation_c == 10);

  ApiHarness failed;
  failed.steam_control_backend.fail_save = true;
  const auto rejected = failed.request(
      HttpMethod::kPatch, "/api/v3/settings", kTestAuthorization,
      "{\"brewTargetC\":94,"
      "\"steamControl\":{\"initialCompensationC\":10}}");
  expect_error(rejected, 500, "persistence_failure");
  assert(failed.memory.targets.brew_c == 93);
  assert(failed.controller.targets().brew_c == 93);
  assert(failed.controller.steam_control_settings().initial_compensation_c ==
         12);
}

void test_mutations_return_complete_state_and_stream_is_transport_owned() {
  ApiHarness harness;
  auto response = harness.request(HttpMethod::kPut,
                                  "/api/v3/heater-permission",
                                  kTestAuthorization,
                                  "{\"enabled\":false}");
  assert(response.status == 200);
  assert(response.body.find("\"heaterEnabled\":false") !=
         std::string::npos);
  assert(response.body.find("\"scale\":") != std::string::npos);
  assert(response.body.find("\"temperatureCalibration\":") !=
         std::string::npos);

  response = harness.request(HttpMethod::kGet,
                             "/api/v3/extractions/current/stream",
                             kTestAuthorization);
  expect_error(response, 409, "stream_unavailable");
}

void test_extraction_start_and_stop_apply_output_before_acknowledgement() {
  ApiHarness harness;
  auto response = harness.request(
      HttpMethod::kPost, "/api/v3/extractions", kTestAuthorization,
      "{\"idempotencyKey\":\"instant-command-1\","
      "\"selection\":{\"kind\":\"manual\"}}", 1200);
  assert(response.status == 200);
  assert(harness.pump_output.level);
  assert(response.body.find("\"apiVersion\":\"3\"") != std::string::npos);
  assert(response.body.find("\"status\":\"running\"") !=
         std::string::npos);
  assert(response.body.find("\"pumpCommand\":\"running\"") !=
         std::string::npos);

  response = harness.request(HttpMethod::kDelete,
                             "/api/v3/extractions/current",
                             kTestAuthorization, "", 1250);
  assert(response.status == 200);
  assert(!harness.pump_output.level);
  assert(response.body.find("\"apiVersion\":\"3\"") != std::string::npos);
  assert(response.body.find("\"pumpCommand\":\"off\"") !=
         std::string::npos);
}

void test_scale_calibration_acknowledges_live_weight() {
  ApiHarness harness;
  auto response = harness.request(
      HttpMethod::kPost, "/api/v3/scale-calibrations/current",
      kTestAuthorization, "", 1100);
  assert(response.status == 200);
  assert(response.body.find("\"calibrationStatus\":\"calibrating\"") !=
         std::string::npos);

  for (std::int32_t index = 0; index < 10; ++index) {
    harness.scale.update({Hx711Status::kOk, 180000}, 1200U + index);
  }
  response = harness.request(
      HttpMethod::kPut, "/api/v3/scale-calibrations/current",
      kTestAuthorization, "{\"referenceWeightDecigrams\":1000}", 1250);
  assert(response.status == 200);
  assert(response.body.find("\"apiVersion\":\"3\"") != std::string::npos);
  assert(response.body.find("\"calibrationStatus\":\"calibrated\"") !=
         std::string::npos);
  assert(response.body.find("\"grossWeightDecigrams\":1000") !=
         std::string::npos);
  assert(harness.scale_backend.save_count == 1);
}

void test_settings_reject_unknown_and_fragmented_legacy_shapes() {
  ApiHarness harness;
  for (const char* body : {
           "{}",
           "{\"heaterEnabled\":false}",
           "{\"brewTargetC\":93,\"extra\":true}",
           "{\"steamControl\":{}}",
           "{\"steamControl\":{\"initialCompensationC\":10,\"extra\":1}}",
       }) {
    expect_error(harness.request(HttpMethod::kPatch, "/api/v3/settings",
                                 kTestAuthorization, body),
                 400, "malformed_request");
  }
}

}  // namespace

int main() {
  test_v3_route_and_authentication_boundary();
  test_combined_settings_are_atomic_and_acknowledged_as_state();
  test_mutations_return_complete_state_and_stream_is_transport_owned();
  test_extraction_start_and_stop_apply_output_before_acknowledgement();
  test_scale_calibration_acknowledges_live_weight();
  test_settings_reject_unknown_and_fragmented_legacy_shapes();
  return 0;
}
