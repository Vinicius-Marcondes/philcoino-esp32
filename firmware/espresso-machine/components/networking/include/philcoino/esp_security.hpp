#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>

#include "philcoino/pairing.hpp"

namespace philcoino::networking {

class EspPairingCrypto final : public PairingCrypto {
 public:
  bool random(Secret256& output) override;
  bool sha256(const std::uint8_t* data, std::size_t length,
              Secret256& output) override;
};

class EspPairingSrpFactory final : public PairingSrpFactory {
 public:
  explicit EspPairingSrpFactory(const char* pairing_code);
  std::unique_ptr<PairingSrpSession> create() override;

 private:
  std::array<char, 9> pairing_code_{};
};

class NvsPairingStorage final : public PairingStorage {
 public:
  bool load(PairingPersistentState& state) override;
  bool save(const PairingPersistentState& state) override;
};

class EspTlsIdentity {
 public:
  bool initialize(const char* common_name);
  const std::uint8_t* certificate() const { return certificate_.data(); }
  std::size_t certificate_length() const { return certificate_length_; }
  const std::uint8_t* private_key() const { return private_key_.data(); }
  std::size_t private_key_length() const { return private_key_length_; }
 const Secret256& spki_sha256() const { return spki_sha256_; }

 private:
  enum class PersistedIdentityState { kEmpty, kPresent, kUnavailable };

  PersistedIdentityState persisted_identity_state() const;
  bool load();
  bool generate(const char* common_name);
  bool persist();

  std::array<std::uint8_t, 2048> certificate_{};
  std::array<std::uint8_t, 512> private_key_{};
  std::size_t certificate_length_{0};
  std::size_t private_key_length_{0};
  Secret256 spki_sha256_{};
};

}  // namespace philcoino::networking
