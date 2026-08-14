#include "philcoino/pairing.hpp"

#include <algorithm>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <utility>

#include "philcoino/api_codec.hpp"
#include "philcoino/api_json.hpp"

namespace philcoino::networking {
namespace {

using codec::error_response;
using codec::json_response;
using json::Field;
using json::ObjectParser;
using json::Value;

constexpr char kAlphabet[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
constexpr char kDeviceBindingDomain[] = "philcoino:v3:device-binding";
constexpr char kClientBindingDomain[] = "philcoino:v3:client-binding";

bool constant_time_equal(const Secret256& left, const Secret256& right) {
  volatile std::uint8_t difference = 0;
  for (std::size_t index = 0; index < left.size(); ++index) {
    difference |= left[index] ^ right[index];
  }
  return difference == 0U;
}

bool valid_hex_id(const std::string& value) {
  return value.size() == 32U &&
         std::all_of(value.begin(), value.end(), [](char character) {
           return (character >= '0' && character <= '9') ||
                  (character >= 'a' && character <= 'f');
         });
}

bool valid_pairing_code(const std::string& value) {
  return value.size() == 8U &&
         std::all_of(value.begin(), value.end(), [](char character) {
           return character >= '0' && character <= '9';
         });
}

std::string hex_id(const Secret256& random) {
  std::ostringstream output;
  output << std::hex << std::setfill('0');
  for (std::size_t index = 0; index < 16U; ++index) {
    output << std::setw(2) << static_cast<unsigned>(random[index]);
  }
  return output.str();
}

std::string json_quote(const std::string& value) {
  std::ostringstream output;
  output << '"';
  for (const unsigned char character : value) {
    switch (character) {
      case '"': output << "\\\""; break;
      case '\\': output << "\\\\"; break;
      case '\b': output << "\\b"; break;
      case '\f': output << "\\f"; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default:
        if (character < 0x20U) {
          output << "\\u00" << std::hex << std::setw(2)
                 << std::setfill('0') << static_cast<unsigned>(character)
                 << std::dec;
        } else {
          output << static_cast<char>(character);
        }
    }
  }
  output << '"';
  return output.str();
}

std::string serialize_identity(const DeviceIdentity& identity) {
  std::ostringstream output;
  output << "{\"deviceId\":" << json_quote(identity.device_id)
         << ",\"name\":" << json_quote(identity.name)
         << ",\"model\":" << json_quote(identity.model)
         << ",\"apiVersion\":\"3\",\"firmwareVersion\":"
         << json_quote(identity.firmware_version) << "}";
  return output.str();
}

const char* bearer_value(const char* authorization) {
  if (authorization == nullptr) return nullptr;
  constexpr char kPrefix[] = "Bearer ";
  for (std::size_t index = 0; index < sizeof(kPrefix) - 1U; ++index) {
    char supplied = authorization[index];
    char expected = kPrefix[index];
    if (supplied >= 'A' && supplied <= 'Z') {
      supplied = static_cast<char>(supplied - 'A' + 'a');
    }
    if (expected >= 'A' && expected <= 'Z') {
      expected = static_cast<char>(expected - 'A' + 'a');
    }
    if (supplied != expected) return nullptr;
  }
  const char* value = authorization + sizeof(kPrefix) - 1U;
  return *value == '\0' ? nullptr : value;
}

bool parse_start_request(const std::string& body, Secret256& client_nonce,
                         std::vector<std::uint8_t>& client_public_key) {
  std::vector<Field> fields;
  ObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 3U) return false;
  std::string client_name;
  std::string encoded_nonce;
  std::string encoded_public_key;
  for (const auto& field : fields) {
    if (field.key == "clientName" &&
        field.value.type == Value::Type::kString &&
        !field.value.string.empty() && field.value.string.size() <= 64U) {
      client_name = field.value.string;
    } else if (field.key == "clientNonce" &&
               field.value.type == Value::Type::kString) {
      encoded_nonce = field.value.string;
    } else if (field.key == "clientPublicKey" &&
               field.value.type == Value::Type::kString) {
      encoded_public_key = field.value.string;
    } else {
      return false;
    }
  }
  return !client_name.empty() && base64url_decode(encoded_nonce, client_nonce) &&
         base64url_decode(encoded_public_key, client_public_key,
                          kSrpPublicKeyBytes) &&
         client_public_key.size() == kSrpPublicKeyBytes;
}

bool parse_proof_request(const std::string& body, SrpProof& client_proof) {
  std::vector<Field> fields;
  ObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 1U ||
      fields[0].key != "clientProof" ||
      fields[0].value.type != Value::Type::kString) {
    return false;
  }
  std::vector<std::uint8_t> decoded;
  if (!base64url_decode(fields[0].value.string, decoded, client_proof.size()) ||
      decoded.size() != client_proof.size()) {
    return false;
  }
  std::copy(decoded.begin(), decoded.end(), client_proof.begin());
  return true;
}

bool parse_complete_request(const std::string& body, std::string& client_id,
                            std::vector<std::uint8_t>& encrypted_binding) {
  std::vector<Field> fields;
  ObjectParser parser(body);
  if (!parser.parse(fields) || fields.size() != 2U) return false;
  std::string encoded_binding;
  for (const auto& field : fields) {
    if (field.key == "clientId" &&
        field.value.type == Value::Type::kString &&
        valid_hex_id(field.value.string)) {
      client_id = field.value.string;
    } else if (field.key == "encryptedClientBinding" &&
               field.value.type == Value::Type::kString) {
      encoded_binding = field.value.string;
    } else {
      return false;
    }
  }
  return !client_id.empty() &&
         base64url_decode(encoded_binding, encrypted_binding, 768U) &&
         encrypted_binding.size() > 16U;
}

bool valid_client_binding(const std::string& plaintext,
                          const std::string& expected_session_id,
                          const std::string& expected_client_id,
                          const Secret256& expected_client_nonce,
                          const DeviceIdentity& identity,
                          const Secret256& certificate_pin) {
  std::vector<Field> fields;
  ObjectParser parser(plaintext);
  if (!parser.parse(fields) || fields.size() != 6U) return false;
  std::string domain;
  std::string session_id;
  std::string client_id;
  std::string client_nonce;
  std::string device_id;
  std::string pin;
  for (const auto& field : fields) {
    if (field.value.type != Value::Type::kString) return false;
    if (field.key == "domain") domain = field.value.string;
    else if (field.key == "sessionId") session_id = field.value.string;
    else if (field.key == "clientId") client_id = field.value.string;
    else if (field.key == "clientNonce") client_nonce = field.value.string;
    else if (field.key == "deviceId") device_id = field.value.string;
    else if (field.key == "certificateSpkiSha256") pin = field.value.string;
    else return false;
  }
  return domain == kClientBindingDomain && session_id == expected_session_id &&
         client_id == expected_client_id &&
         client_nonce == base64url_encode(expected_client_nonce) &&
         device_id == identity.device_id &&
         pin == base64url_encode(certificate_pin);
}

PairingNonce completion_nonce(PairingNonce nonce) {
  nonce[8] = 0U;
  nonce[9] = 0U;
  nonce[10] = 0U;
  nonce[11] = 2U;
  return nonce;
}

}  // namespace

std::string base64url_encode(const std::uint8_t* value, std::size_t length) {
  if (value == nullptr && length != 0U) return {};
  std::string output;
  output.reserve((length * 4U + 2U) / 3U);
  std::uint32_t accumulator = 0;
  unsigned bits = 0;
  for (std::size_t index = 0; index < length; ++index) {
    accumulator = (accumulator << 8U) | value[index];
    bits += 8U;
    while (bits >= 6U) {
      bits -= 6U;
      output.push_back(kAlphabet[(accumulator >> bits) & 0x3FU]);
    }
  }
  if (bits != 0U) {
    output.push_back(kAlphabet[(accumulator << (6U - bits)) & 0x3FU]);
  }
  return output;
}

std::string base64url_encode(const Secret256& value) {
  return base64url_encode(value.data(), value.size());
}

bool base64url_decode(const std::string& value,
                      std::vector<std::uint8_t>& output,
                      std::size_t maximum_bytes) {
  if (value.empty() || value.size() % 4U == 1U) return false;
  output.clear();
  output.reserve(std::min(maximum_bytes, value.size() * 3U / 4U + 1U));
  std::uint32_t accumulator = 0;
  unsigned bits = 0;
  for (const char character : value) {
    const char* found = std::find(std::begin(kAlphabet),
                                  std::end(kAlphabet) - 1, character);
    if (found == std::end(kAlphabet) - 1) return false;
    accumulator =
        (accumulator << 6U) | static_cast<std::uint32_t>(found - kAlphabet);
    bits += 6U;
    if (bits >= 8U) {
      bits -= 8U;
      if (output.size() >= maximum_bytes) return false;
      output.push_back(
          static_cast<std::uint8_t>((accumulator >> bits) & 0xFFU));
    }
  }
  const std::uint32_t mask = bits == 0U ? 0U : (1U << bits) - 1U;
  return (accumulator & mask) == 0U;
}

bool base64url_decode(const std::string& value, Secret256& output) {
  std::vector<std::uint8_t> decoded;
  if (!base64url_decode(value, decoded, output.size()) ||
      decoded.size() != output.size()) {
    return false;
  }
  std::copy(decoded.begin(), decoded.end(), output.begin());
  return true;
}

PairingService::PairingService(DeviceIdentity identity, std::string pairing_code,
                               Secret256 certificate_spki_sha256,
                               PairingCrypto& crypto, PairingStorage& storage,
                               PairingSrpFactory& srp_factory)
    : identity_(std::move(identity)),
      pairing_code_(std::move(pairing_code)),
      certificate_spki_sha256_(certificate_spki_sha256),
      crypto_(crypto),
      storage_(storage),
      srp_factory_(srp_factory) {}

bool PairingService::initialize() {
  if (!valid_pairing_code(pairing_code_)) return false;
  Secret256 fingerprint{};
  if (!crypto_.sha256(
          reinterpret_cast<const std::uint8_t*>(pairing_code_.data()),
          pairing_code_.size(), fingerprint)) {
    return false;
  }
  PairingPersistentState loaded{};
  const bool present = storage_.load(loaded);
  if (!present || loaded.format_version != 1U) {
    loaded = {};
    loaded.pairing_code_fingerprint = fingerprint;
    if (!storage_.save(loaded)) return false;
  } else if (!constant_time_equal(loaded.pairing_code_fingerprint,
                                  fingerprint)) {
    loaded.clients = {};
    loaded.next_issued_sequence = 1U;
    loaded.pairing_code_fingerprint = fingerprint;
    if (!storage_.save(loaded)) return false;
  }
  persisted_ = loaded;
  initialized_ = true;
  return true;
}

bool PairingService::authorized(const char* authorization) const {
  if (!initialized_) return false;
  const char* encoded = bearer_value(authorization);
  if (encoded == nullptr) return false;
  Secret256 token{};
  Secret256 hash{};
  if (!base64url_decode(encoded, token) ||
      !crypto_.sha256(token.data(), token.size(), hash)) {
    return false;
  }
  bool matched = false;
  for (const auto& client : persisted_.clients) {
    matched = (client.occupied && constant_time_equal(client.token_hash, hash)) ||
              matched;
  }
  return matched;
}

PairingService::Session* PairingService::find_session(
    const std::string& session_id) {
  for (auto& session : sessions_) {
    if (session.stage != SessionStage::kEmpty &&
        session_id == session.id.data()) {
      return &session;
    }
  }
  return nullptr;
}

void PairingService::destroy_session(Session& session) {
  session.srp.reset();
  session = {};
}

HttpResponse PairingService::start_session(const std::string& body,
                                           std::uint64_t uptime_ms) {
  if (!initialized_) {
    return error_response(503, "internal_error",
                          "Pairing credential storage is unavailable.");
  }
  Secret256 client_nonce{};
  std::vector<std::uint8_t> client_public_key;
  if (!parse_start_request(body, client_nonce, client_public_key)) {
    return error_response(400, "malformed_request",
                          "The SRP session request is malformed.");
  }
  Session* selected = nullptr;
  for (auto& session : sessions_) {
    if (session.stage != SessionStage::kEmpty &&
        uptime_ms >= session.expires_at_ms) {
      destroy_session(session);
    }
    if (selected == nullptr && session.stage == SessionStage::kEmpty) {
      selected = &session;
    }
  }
  if (selected == nullptr) {
    return error_response(409, "pairing_busy",
                          "Two pairing sessions are already active.");
  }

  auto srp = srp_factory_.create();
  std::vector<std::uint8_t> server_public_key;
  std::vector<std::uint8_t> salt;
  Secret256 random_id{};
  if (!srp || !crypto_.random(random_id) ||
      !srp->start(client_public_key, server_public_key, salt) ||
      server_public_key.empty() || salt.empty()) {
    return error_response(500, "internal_error",
                          "The SRP session could not be initialized.");
  }
  const auto id = hex_id(random_id);
  std::copy(id.begin(), id.end(), selected->id.begin());
  selected->client_nonce = client_nonce;
  selected->expires_at_ms = uptime_ms + kPairingSessionLifetimeMs;
  selected->stage = SessionStage::kAwaitingProof;
  selected->srp = std::move(srp);

  std::ostringstream output;
  output << "{\"sessionId\":\"" << selected->id.data()
         << "\",\"device\":" << serialize_identity(identity_)
         << ",\"serverPublicKey\":\""
         << base64url_encode(server_public_key.data(), server_public_key.size())
         << "\",\"salt\":\"" << base64url_encode(salt.data(), salt.size())
         << "\",\"expiresAtUptimeMs\":" << selected->expires_at_ms << "}";
  return json_response(200, output.str());
}

HttpResponse PairingService::verify_proof(const std::string& session_id,
                                          const std::string& body,
                                          std::uint64_t uptime_ms) {
  Session* session = find_session(session_id);
  if (session == nullptr) {
    return error_response(409, "pairing_session_replayed",
                          "The pairing session is unavailable.");
  }
  if (uptime_ms >= session->expires_at_ms) {
    destroy_session(*session);
    return error_response(409, "pairing_session_expired",
                          "The pairing session expired.");
  }
  if (session->stage != SessionStage::kAwaitingProof) {
    destroy_session(*session);
    return error_response(409, "pairing_stage_mismatch",
                          "The pairing session is not awaiting a proof.");
  }
  SrpProof client_proof{};
  if (!parse_proof_request(body, client_proof)) {
    destroy_session(*session);
    return error_response(400, "malformed_request",
                          "The SRP proof request is malformed.");
  }
  SrpProof server_proof{};
  if (!session->srp || !session->srp->verify(client_proof, server_proof)) {
    destroy_session(*session);
    return error_response(401, "invalid_pairing_code",
                          "The pairing code or SRP proof is invalid.");
  }

  Secret256 nonce_random{};
  if (!crypto_.random(nonce_random)) {
    destroy_session(*session);
    return error_response(500, "internal_error",
                          "Pairing encryption randomness is unavailable.");
  }
  std::copy_n(nonce_random.begin(), 8U, session->device_nonce.begin());
  session->device_nonce[8] = 0U;
  session->device_nonce[9] = 0U;
  session->device_nonce[10] = 0U;
  session->device_nonce[11] = 1U;

  std::ostringstream binding;
  binding << "{\"domain\":\"" << kDeviceBindingDomain
          << "\",\"sessionId\":\"" << session->id.data()
          << "\",\"clientNonce\":\""
          << base64url_encode(session->client_nonce)
          << "\",\"deviceId\":" << json_quote(identity_.device_id)
          << ",\"certificateSpkiSha256\":\""
          << base64url_encode(certificate_spki_sha256_) << "\"}";
  std::vector<std::uint8_t> encrypted_binding;
  if (!session->srp->encrypt(session->device_nonce, binding.str(),
                             encrypted_binding)) {
    destroy_session(*session);
    return error_response(500, "internal_error",
                          "The certificate binding could not be encrypted.");
  }
  session->stage = SessionStage::kAwaitingCompletion;

  std::ostringstream output;
  output << "{\"serverProof\":\""
         << base64url_encode(server_proof.data(), server_proof.size())
         << "\",\"deviceNonce\":\""
         << base64url_encode(session->device_nonce.data(),
                             session->device_nonce.size())
         << "\",\"encryptedDeviceBinding\":\""
         << base64url_encode(encrypted_binding.data(), encrypted_binding.size())
         << "\"}";
  return json_response(200, output.str());
}

HttpResponse PairingService::complete_session(const std::string& session_id,
                                              const std::string& body,
                                              std::uint64_t uptime_ms) {
  Session* session = find_session(session_id);
  if (session == nullptr) {
    return error_response(409, "pairing_session_replayed",
                          "The pairing session is unavailable.");
  }
  if (uptime_ms >= session->expires_at_ms) {
    destroy_session(*session);
    return error_response(409, "pairing_session_expired",
                          "The pairing session expired.");
  }
  if (session->stage != SessionStage::kAwaitingCompletion) {
    destroy_session(*session);
    return error_response(409, "pairing_stage_mismatch",
                          "The pairing session is not awaiting completion.");
  }
  std::string client_id;
  std::vector<std::uint8_t> encrypted_binding;
  if (!parse_complete_request(body, client_id, encrypted_binding)) {
    destroy_session(*session);
    return error_response(400, "malformed_request",
                          "The pairing completion request is malformed.");
  }
  std::string plaintext;
  const auto nonce = completion_nonce(session->device_nonce);
  const Secret256 client_nonce = session->client_nonce;
  if (!session->srp ||
      !session->srp->decrypt(nonce, encrypted_binding, plaintext) ||
      !valid_client_binding(plaintext, session_id, client_id, client_nonce,
                            identity_, certificate_spki_sha256_)) {
    destroy_session(*session);
    return error_response(401, "unauthorized",
                          "The encrypted certificate binding is invalid.");
  }
  destroy_session(*session);

  Secret256 access_token{};
  Secret256 token_hash{};
  if (!crypto_.random(access_token) ||
      !crypto_.sha256(access_token.data(), access_token.size(), token_hash)) {
    return error_response(500, "internal_error",
                          "Access-token generation failed.");
  }

  PairingPersistentState candidate = persisted_;
  StoredClientCredential* destination = nullptr;
  for (auto& client : candidate.clients) {
    if (client.occupied && client_id == client.client_id.data()) {
      destination = &client;
      break;
    }
    if (!client.occupied && destination == nullptr) destination = &client;
  }
  if (destination == nullptr) {
    destination = &*std::min_element(
        candidate.clients.begin(), candidate.clients.end(),
        [](const auto& left, const auto& right) {
          return left.issued_sequence < right.issued_sequence;
        });
  }
  *destination = {};
  std::copy(client_id.begin(), client_id.end(), destination->client_id.begin());
  destination->token_hash = token_hash;
  destination->issued_sequence = candidate.next_issued_sequence++;
  destination->occupied = true;
  if (!storage_.save(candidate)) {
    return error_response(500, "persistence_failure",
                          "The client credential could not be persisted.");
  }
  persisted_ = candidate;

  std::ostringstream output;
  output << "{\"device\":" << serialize_identity(identity_)
         << ",\"certificateSpkiSha256\":\""
         << base64url_encode(certificate_spki_sha256_)
         << "\",\"clientId\":\"" << client_id
         << "\",\"accessToken\":\"" << base64url_encode(access_token)
         << "\"}";
  return json_response(200, output.str());
}

}  // namespace philcoino::networking
