#include <algorithm>
#include <cassert>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "philcoino/pairing.hpp"

namespace {

using namespace philcoino::networking;

class DeterministicCrypto final : public PairingCrypto {
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

class MockSrpSession final : public PairingSrpSession {
 public:
  bool start(const std::vector<std::uint8_t>& client_public_key,
             std::vector<std::uint8_t>& server_public_key,
             std::vector<std::uint8_t>& salt) override {
    if (client_public_key.size() != kSrpPublicKeyBytes) return false;
    server_public_key.assign(kSrpPublicKeyBytes, 0x42U);
    salt.assign(16U, 0x53U);
    started = true;
    return true;
  }

  bool verify(const SrpProof& client_proof,
              SrpProof& server_proof) override {
    if (!started || !std::all_of(client_proof.begin(), client_proof.end(),
                                 [](std::uint8_t byte) {
                                   return byte == 0xA5U;
                                 })) {
      return false;
    }
    server_proof.fill(0x5AU);
    verified = true;
    return true;
  }

  bool encrypt(const PairingNonce&, const std::string& plaintext,
               std::vector<std::uint8_t>& ciphertext) override {
    if (!verified) return false;
    ciphertext.assign(plaintext.begin(), plaintext.end());
    ciphertext.insert(ciphertext.end(), 16U, 0U);
    return true;
  }

  bool decrypt(const PairingNonce&,
               const std::vector<std::uint8_t>& ciphertext,
               std::string& plaintext) override {
    if (!verified || ciphertext.size() <= 16U ||
        !std::all_of(ciphertext.end() - 16, ciphertext.end(),
                     [](std::uint8_t byte) { return byte == 0U; })) {
      return false;
    }
    plaintext.assign(ciphertext.begin(), ciphertext.end() - 16);
    return true;
  }

  bool started{false};
  bool verified{false};
};

class MockSrpFactory final : public PairingSrpFactory {
 public:
  std::unique_ptr<PairingSrpSession> create() override {
    return std::make_unique<MockSrpSession>();
  }
};

class MemoryStorage final : public PairingStorage {
 public:
  bool load(PairingPersistentState& output) override {
    if (!present) return false;
    output = state;
    return true;
  }
  bool save(const PairingPersistentState& input) override {
    if (fail_save) return false;
    state = input;
    present = true;
    return true;
  }

  PairingPersistentState state{};
  bool present{false};
  bool fail_save{false};
};

std::string field(const std::string& json, const char* name) {
  const std::string prefix = std::string("\"") + name + "\":\"";
  const auto start = json.find(prefix);
  assert(start != std::string::npos);
  const auto value_start = start + prefix.size();
  const auto end = json.find('"', value_start);
  assert(end != std::string::npos);
  return json.substr(value_start, end - value_start);
}

std::string client_id(unsigned index) {
  constexpr char digits[] = "0123456789abcdef";
  return std::string(31U, '0') + digits[index & 0xFU];
}

std::string start_body(const Secret256& client_nonce) {
  const std::vector<std::uint8_t> public_key(kSrpPublicKeyBytes, 0x41U);
  return std::string("{\"clientName\":\"test-client\",\"clientNonce\":\"") +
         base64url_encode(client_nonce) + "\",\"clientPublicKey\":\"" +
         base64url_encode(public_key.data(), public_key.size()) + "\"}";
}

std::string encrypted_binding(const std::string& session_id,
                              const std::string& client_id_value,
                              const Secret256& client_nonce,
                              const DeviceIdentity& identity,
                              const Secret256& pin) {
  const std::string plaintext =
      std::string("{\"domain\":\"philcoino:v4:client-binding\",\"sessionId\":\"") +
      session_id + "\",\"clientId\":\"" + client_id_value +
      "\",\"clientNonce\":\"" + base64url_encode(client_nonce) +
      "\",\"deviceId\":\"" + identity.device_id +
      "\",\"certificateSpkiSha256\":\"" + base64url_encode(pin) +
      "\"}";
  std::vector<std::uint8_t> ciphertext(plaintext.begin(), plaintext.end());
  ciphertext.insert(ciphertext.end(), 16U, 0U);
  return base64url_encode(ciphertext.data(), ciphertext.size());
}

struct Transcript {
  HttpResponse complete;
  std::string token;
};

Transcript pair(PairingService& service, const DeviceIdentity& identity,
                const Secret256& pin, unsigned index,
                std::uint64_t now_ms) {
  Secret256 client_nonce{};
  client_nonce.fill(static_cast<std::uint8_t>(0x40U + index));
  const auto started = service.start_session(start_body(client_nonce), now_ms);
  assert(started.status == 200);
  assert(started.body.find("\"apiVersion\":\"4\"") !=
         std::string::npos);
  const auto session_id = field(started.body, "sessionId");
  SrpProof client_proof{};
  client_proof.fill(0xA5U);
  const auto proved = service.verify_proof(
      session_id,
      std::string("{\"clientProof\":\"") +
          base64url_encode(client_proof.data(), client_proof.size()) + "\"}",
      now_ms + 1U);
  assert(proved.status == 200);
  const auto encrypted_device_binding =
      field(proved.body, "encryptedDeviceBinding");
  assert(!encrypted_device_binding.empty());
  std::vector<std::uint8_t> encoded_binding;
  assert(base64url_decode(encrypted_device_binding, encoded_binding, 1024U));
  assert(encoded_binding.size() > 16U);
  const std::string device_binding(encoded_binding.begin(),
                                   encoded_binding.end() - 16);
  assert(device_binding.find("\"domain\":\"philcoino:v4:device-binding\"") !=
         std::string::npos);
  const auto id = client_id(index);
  const auto completed = service.complete_session(
      session_id,
      std::string("{\"clientId\":\"") + id +
          "\",\"encryptedClientBinding\":\"" +
          encrypted_binding(session_id, id, client_nonce, identity, pin) +
          "\"}",
      now_ms + 2U);
  assert(completed.status == 200);
  assert(completed.body.find("\"apiVersion\":\"4\"") !=
         std::string::npos);
  return {completed, field(completed.body, "accessToken")};
}

void test_pairing_rotation_replay_and_code_change() {
  DeterministicCrypto crypto;
  MemoryStorage storage;
  MockSrpFactory factory;
  Secret256 pin{};
  pin.fill(0x5AU);
  const DeviceIdentity identity{
      "philcoino-test", "PhilcoINO", "ESP32-S3-WROOM-1-N16R8", "0.5.0"};
  PairingService service(identity, "12345678", pin, crypto, storage, factory);
  assert(service.initialize());

  std::array<std::string, 5> tokens{};
  for (unsigned index = 0; index < tokens.size(); ++index) {
    tokens[index] = pair(service, identity, pin, index, index * 10U).token;
  }
  assert(!service.authorized((std::string("Bearer ") + tokens[0]).c_str()));
  for (std::size_t index = 1; index < tokens.size(); ++index) {
    assert(service.authorized(
        (std::string("Bearer ") + tokens[index]).c_str()));
  }

  MockSrpFactory same_factory;
  PairingService same_code(identity, "12345678", pin, crypto, storage,
                           same_factory);
  assert(same_code.initialize());
  assert(same_code.authorized(
      (std::string("Bearer ") + tokens.back()).c_str()));

  MockSrpFactory changed_factory;
  PairingService changed_code(identity, "87654321", pin, crypto, storage,
                              changed_factory);
  assert(changed_code.initialize());
  assert(!changed_code.authorized(
      (std::string("Bearer ") + tokens.back()).c_str()));
}

void test_bounded_sessions_wrong_proof_and_expiry() {
  DeterministicCrypto crypto;
  MemoryStorage storage;
  MockSrpFactory factory;
  Secret256 pin{};
  PairingService service(
      {"philcoino-test", "PhilcoINO", "ESP32-S3-WROOM-1-N16R8", "0.5.0"}, "01234567",
      pin, crypto, storage, factory);
  assert(service.initialize());
  Secret256 nonce{};
  const auto first = service.start_session(start_body(nonce), 1U);
  const auto second = service.start_session(start_body(nonce), 2U);
  assert(first.status == 200 && second.status == 200);
  const auto busy = service.start_session(start_body(nonce), 3U);
  assert(busy.status == 409);
  assert(busy.body.find("pairing_busy") != std::string::npos);

  SrpProof wrong{};
  const auto first_id = field(first.body, "sessionId");
  const std::string wrong_body =
      std::string("{\"clientProof\":\"") +
      base64url_encode(wrong.data(), wrong.size()) + "\"}";
  const auto rejected = service.verify_proof(first_id, wrong_body, 4U);
  assert(rejected.status == 401);
  assert(rejected.body.find("invalid_pairing_code") != std::string::npos);
  const auto replay = service.verify_proof(first_id, wrong_body, 5U);
  assert(replay.status == 409);
  assert(replay.body.find("pairing_session_replayed") != std::string::npos);

  const auto second_id = field(second.body, "sessionId");
  const auto expired = service.verify_proof(
      second_id, wrong_body, 2U + kPairingSessionLifetimeMs);
  assert(expired.status == 409);
  assert(expired.body.find("pairing_session_expired") != std::string::npos);
}

void test_wrong_stage_is_consumed() {
  DeterministicCrypto crypto;
  MemoryStorage storage;
  MockSrpFactory factory;
  Secret256 pin{};
  PairingService service(
      {"philcoino-test", "PhilcoINO", "ESP32-S3-WROOM-1-N16R8", "0.5.0"}, "12345678",
      pin, crypto, storage, factory);
  assert(service.initialize());
  Secret256 nonce{};
  const auto started = service.start_session(start_body(nonce), 1U);
  const auto id = field(started.body, "sessionId");
  const auto wrong_stage = service.complete_session(
      id,
      std::string("{\"clientId\":\"") + client_id(1) +
          "\",\"encryptedClientBinding\":\"AAAAAAAAAAAAAAAAAAAAAAA\"}",
      2U);
  assert(wrong_stage.status == 409);
  assert(wrong_stage.body.find("pairing_stage_mismatch") != std::string::npos);
  SrpProof proof{};
  proof.fill(0xA5U);
  const auto replay = service.verify_proof(
      id,
      std::string("{\"clientProof\":\"") +
          base64url_encode(proof.data(), proof.size()) + "\"}",
      3U);
  assert(replay.status == 409);
}

}  // namespace

int main() {
  test_pairing_rotation_replay_and_code_change();
  test_bounded_sessions_wrong_proof_and_expiry();
  test_wrong_stage_is_consumed();
  return 0;
}
