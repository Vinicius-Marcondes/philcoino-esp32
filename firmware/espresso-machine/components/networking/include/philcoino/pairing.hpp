#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "philcoino/api.hpp"

namespace philcoino::networking {

inline constexpr std::size_t kPairingSecretBytes = 32;
inline constexpr std::size_t kMaximumPairedClients = 4;
inline constexpr std::size_t kMaximumPairingSessions = 2;
inline constexpr std::uint64_t kPairingSessionLifetimeMs = 90'000;
inline constexpr std::size_t kSrpPublicKeyBytes = 384;
inline constexpr std::size_t kSrpProofBytes = 64;
inline constexpr std::size_t kPairingNonceBytes = 12;
inline constexpr char kPairingSrpUsername[] = "philcoino-v4";

using Secret256 = std::array<std::uint8_t, kPairingSecretBytes>;
using PairingNonce = std::array<std::uint8_t, kPairingNonceBytes>;
using SrpProof = std::array<std::uint8_t, kSrpProofBytes>;

struct StoredClientCredential {
  std::array<char, 33> client_id{};
  Secret256 token_hash{};
  std::uint64_t issued_sequence{0};
  bool occupied{false};
};

struct PairingPersistentState {
  std::uint32_t format_version{1};
  Secret256 pairing_code_fingerprint{};
  std::array<StoredClientCredential, kMaximumPairedClients> clients{};
  std::uint64_t next_issued_sequence{1};
};

class PairingStorage {
 public:
  virtual ~PairingStorage() = default;
  virtual bool load(PairingPersistentState& state) = 0;
  virtual bool save(const PairingPersistentState& state) = 0;
};

class PairingCrypto {
 public:
  virtual ~PairingCrypto() = default;
  virtual bool random(Secret256& output) = 0;
  virtual bool sha256(const std::uint8_t* data, std::size_t length,
                      Secret256& output) = 0;
};

class PairingSrpSession {
 public:
  virtual ~PairingSrpSession() = default;
  virtual bool start(const std::vector<std::uint8_t>& client_public_key,
                     std::vector<std::uint8_t>& server_public_key,
                     std::vector<std::uint8_t>& salt) = 0;
  virtual bool verify(const SrpProof& client_proof,
                      SrpProof& server_proof) = 0;
  virtual bool encrypt(const PairingNonce& nonce, const std::string& plaintext,
                       std::vector<std::uint8_t>& ciphertext) = 0;
  virtual bool decrypt(const PairingNonce& nonce,
                       const std::vector<std::uint8_t>& ciphertext,
                       std::string& plaintext) = 0;
};

class PairingSrpFactory {
 public:
  virtual ~PairingSrpFactory() = default;
  virtual std::unique_ptr<PairingSrpSession> create() = 0;
};

class PairingService {
 public:
  PairingService(DeviceIdentity identity, std::string pairing_code,
                 Secret256 certificate_spki_sha256, PairingCrypto& crypto,
                 PairingStorage& storage, PairingSrpFactory& srp_factory);

  bool initialize();
  bool authorized(const char* authorization) const;
  HttpResponse start_session(const std::string& body,
                             std::uint64_t uptime_ms);
  HttpResponse verify_proof(const std::string& session_id,
                            const std::string& body,
                            std::uint64_t uptime_ms);
  HttpResponse complete_session(const std::string& session_id,
                                const std::string& body,
                                std::uint64_t uptime_ms);

 private:
  enum class SessionStage { kEmpty, kAwaitingProof, kAwaitingCompletion };

  struct Session {
    std::array<char, 33> id{};
    Secret256 client_nonce{};
    PairingNonce device_nonce{};
    std::uint64_t expires_at_ms{0};
    SessionStage stage{SessionStage::kEmpty};
    std::unique_ptr<PairingSrpSession> srp;
  };

  Session* find_session(const std::string& session_id);
  void destroy_session(Session& session);

  DeviceIdentity identity_;
  std::string pairing_code_;
  Secret256 certificate_spki_sha256_{};
  PairingCrypto& crypto_;
  PairingStorage& storage_;
  PairingSrpFactory& srp_factory_;
  PairingPersistentState persisted_{};
  std::array<Session, kMaximumPairingSessions> sessions_{};
  bool initialized_{false};
};

std::string base64url_encode(const std::uint8_t* value, std::size_t length);
std::string base64url_encode(const Secret256& value);
bool base64url_decode(const std::string& value,
                      std::vector<std::uint8_t>& output,
                      std::size_t maximum_bytes);
bool base64url_decode(const std::string& value, Secret256& output);

}  // namespace philcoino::networking
