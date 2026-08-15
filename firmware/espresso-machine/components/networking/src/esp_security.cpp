#include "philcoino/esp_security.hpp"

#include <algorithm>
#include <cstring>
#include <utility>

#include "esp_random.h"
#include "esp_srp.h"
#include "mbedtls/md.h"
#include "mbedtls/pk.h"
#include "mbedtls/x509_crt.h"
#include "nvs.h"
#include "psa/crypto.h"

namespace philcoino::networking {
namespace {

constexpr char kNamespace[] = "security_v4";
constexpr char kPairingStateKey[] = "clients";
constexpr char kCertificateKey[] = "tls_cert";
constexpr char kPrivateKeyKey[] = "tls_key";
constexpr char kPinKey[] = "tls_spki";

bool read_blob(nvs_handle_t handle, const char* key, std::uint8_t* output,
               std::size_t capacity, std::size_t& length) {
  length = capacity;
  return nvs_get_blob(handle, key, output, &length) == ESP_OK &&
         length > 0U && length <= capacity;
}

bool sha256_digest(const std::uint8_t* data, std::size_t length,
                   Secret256& output) {
  if (data == nullptr || psa_crypto_init() != PSA_SUCCESS) return false;
  std::size_t output_length = 0;
  return psa_hash_compute(PSA_ALG_SHA_256, data, length, output.data(),
                          output.size(), &output_length) == PSA_SUCCESS &&
         output_length == output.size();
}

}  // namespace

bool EspPairingCrypto::random(Secret256& output) {
  esp_fill_random(output.data(), output.size());
  return true;
}

bool EspPairingCrypto::sha256(const std::uint8_t* data, std::size_t length,
                              Secret256& output) {
  return sha256_digest(data, length, output);
}

namespace {

class EspPairingSrpSession final : public PairingSrpSession {
 public:
  explicit EspPairingSrpSession(std::string pairing_code)
      : pairing_code_(std::move(pairing_code)) {}

  ~EspPairingSrpSession() override {
    if (key_ready_) psa_destroy_key(key_id_);
    if (handle_ != nullptr) esp_srp_free(handle_);
    std::fill(session_key_.begin(), session_key_.end(), 0U);
  }

  bool start(const std::vector<std::uint8_t>& client_public_key,
             std::vector<std::uint8_t>& server_public_key,
             std::vector<std::uint8_t>& salt) override {
    if (handle_ != nullptr || client_public_key.size() != kSrpPublicKeyBytes ||
        pairing_code_.size() != 8U) {
      return false;
    }
    handle_ = esp_srp_init(ESP_NG_3072);
    if (handle_ == nullptr) return false;
    char* server_key = nullptr;
    char* generated_salt = nullptr;
    int server_key_length = 0;
    constexpr int kSaltLength = 16;
    if (esp_srp_srv_pubkey(
            handle_, kPairingSrpUsername,
            static_cast<int>(sizeof(kPairingSrpUsername) - 1U),
            pairing_code_.data(), static_cast<int>(pairing_code_.size()),
            kSaltLength, &server_key, &server_key_length,
            &generated_salt) != ESP_OK ||
        server_key == nullptr || server_key_length != kSrpPublicKeyBytes ||
        generated_salt == nullptr) {
      return false;
    }
    char* session_key = nullptr;
    std::uint16_t session_key_length = 0;
    if (esp_srp_get_session_key(
            handle_, reinterpret_cast<char*>(
                         const_cast<std::uint8_t*>(client_public_key.data())),
            static_cast<int>(client_public_key.size()), &session_key,
            &session_key_length) != ESP_OK ||
        session_key == nullptr || session_key_length < session_key_.size()) {
      return false;
    }
    server_public_key.assign(
        reinterpret_cast<std::uint8_t*>(server_key),
        reinterpret_cast<std::uint8_t*>(server_key) + server_key_length);
    salt.assign(reinterpret_cast<std::uint8_t*>(generated_salt),
                reinterpret_cast<std::uint8_t*>(generated_salt) +
                    kSaltLength);
    std::copy_n(reinterpret_cast<std::uint8_t*>(session_key),
                session_key_.size(), session_key_.begin());
    started_ = true;
    return true;
  }

  bool verify(const SrpProof& client_proof,
              SrpProof& server_proof) override {
    if (!started_ || verified_ || handle_ == nullptr) return false;
    if (esp_srp_exchange_proofs(
            handle_, const_cast<char*>(kPairingSrpUsername),
            static_cast<std::uint16_t>(sizeof(kPairingSrpUsername) - 1U),
            reinterpret_cast<char*>(
                const_cast<std::uint8_t*>(client_proof.data())),
            reinterpret_cast<char*>(server_proof.data())) != ESP_OK) {
      return false;
    }
    psa_key_attributes_t attributes = PSA_KEY_ATTRIBUTES_INIT;
    psa_set_key_type(&attributes, PSA_KEY_TYPE_AES);
    psa_set_key_bits(&attributes, 256U);
    psa_set_key_usage_flags(&attributes,
                            PSA_KEY_USAGE_ENCRYPT | PSA_KEY_USAGE_DECRYPT);
    psa_set_key_algorithm(&attributes, PSA_ALG_GCM);
    const auto status = psa_import_key(&attributes, session_key_.data(),
                                       session_key_.size(), &key_id_);
    psa_reset_key_attributes(&attributes);
    std::fill(session_key_.begin(), session_key_.end(), 0U);
    if (status != PSA_SUCCESS) return false;
    key_ready_ = true;
    verified_ = true;
    return true;
  }

  bool encrypt(const PairingNonce& nonce, const std::string& plaintext,
               std::vector<std::uint8_t>& ciphertext) override {
    if (!verified_ || !key_ready_) return false;
    ciphertext.resize(plaintext.size() + 16U);
    std::size_t output_length = 0;
    const auto status = psa_aead_encrypt(
        key_id_, PSA_ALG_GCM, nonce.data(), nonce.size(), nullptr, 0U,
        reinterpret_cast<const std::uint8_t*>(plaintext.data()),
        plaintext.size(), ciphertext.data(), ciphertext.size(),
        &output_length);
    if (status != PSA_SUCCESS) {
      ciphertext.clear();
      return false;
    }
    ciphertext.resize(output_length);
    return true;
  }

  bool decrypt(const PairingNonce& nonce,
               const std::vector<std::uint8_t>& ciphertext,
               std::string& plaintext) override {
    if (!verified_ || !key_ready_ || ciphertext.size() <= 16U) return false;
    std::vector<std::uint8_t> decoded(ciphertext.size() - 16U);
    std::size_t output_length = 0;
    const auto status = psa_aead_decrypt(
        key_id_, PSA_ALG_GCM, nonce.data(), nonce.size(), nullptr, 0U,
        ciphertext.data(), ciphertext.size(), decoded.data(), decoded.size(),
        &output_length);
    if (status != PSA_SUCCESS) return false;
    plaintext.assign(reinterpret_cast<const char*>(decoded.data()),
                     output_length);
    return true;
  }

 private:
  std::string pairing_code_;
  esp_srp_handle_t* handle_{nullptr};
  Secret256 session_key_{};
  mbedtls_svc_key_id_t key_id_{MBEDTLS_SVC_KEY_ID_INIT};
  bool started_{false};
  bool verified_{false};
  bool key_ready_{false};
};

}  // namespace

EspPairingSrpFactory::EspPairingSrpFactory(const char* pairing_code) {
  if (pairing_code == nullptr) return;
  const auto length = std::min<std::size_t>(8U, std::strlen(pairing_code));
  std::copy_n(pairing_code, length, pairing_code_.begin());
}

std::unique_ptr<PairingSrpSession> EspPairingSrpFactory::create() {
  return std::make_unique<EspPairingSrpSession>(pairing_code_.data());
}

bool NvsPairingStorage::load(PairingPersistentState& state) {
  nvs_handle_t handle = 0;
  if (nvs_open(kNamespace, NVS_READONLY, &handle) != ESP_OK) return false;
  std::size_t length = sizeof(state);
  const auto result =
      nvs_get_blob(handle, kPairingStateKey, &state, &length);
  nvs_close(handle);
  return result == ESP_OK && length == sizeof(state);
}

bool NvsPairingStorage::save(const PairingPersistentState& state) {
  nvs_handle_t handle = 0;
  if (nvs_open(kNamespace, NVS_READWRITE, &handle) != ESP_OK) return false;
  const bool saved =
      nvs_set_blob(handle, kPairingStateKey, &state, sizeof(state)) == ESP_OK &&
      nvs_commit(handle) == ESP_OK;
  nvs_close(handle);
  return saved;
}

bool EspTlsIdentity::initialize(const char* common_name) {
  if (common_name == nullptr || common_name[0] == '\0' ||
      psa_crypto_init() != PSA_SUCCESS) {
    return false;
  }
  if (load()) return true;
  // A partial or corrupt identity must fail closed. Silently generating a new
  // certificate here would change the app's pin without a supervised reset.
  if (persisted_identity_state() != PersistedIdentityState::kEmpty) {
    return false;
  }
  return generate(common_name) && persist();
}

EspTlsIdentity::PersistedIdentityState
EspTlsIdentity::persisted_identity_state() const {
  nvs_handle_t handle = 0;
  const auto opened = nvs_open(kNamespace, NVS_READONLY, &handle);
  if (opened == ESP_ERR_NVS_NOT_FOUND) {
    return PersistedIdentityState::kEmpty;
  }
  if (opened != ESP_OK) {
    return PersistedIdentityState::kUnavailable;
  }
  const auto inspect = [handle](const char* key) {
    std::size_t length = 0;
    const auto result = nvs_get_blob(handle, key, nullptr, &length);
    if (result == ESP_ERR_NVS_NOT_FOUND) return 0;
    if (result != ESP_OK || length == 0U) return -1;
    return 1;
  };
  const std::array<int, 3> states{inspect(kCertificateKey),
                                  inspect(kPrivateKeyKey), inspect(kPinKey)};
  nvs_close(handle);
  if (std::any_of(states.begin(), states.end(), [](int state) {
        return state < 0;
      })) {
    return PersistedIdentityState::kUnavailable;
  }
  return std::any_of(states.begin(), states.end(), [](int state) {
           return state > 0;
         })
             ? PersistedIdentityState::kPresent
             : PersistedIdentityState::kEmpty;
}

bool EspTlsIdentity::load() {
  nvs_handle_t handle = 0;
  if (nvs_open(kNamespace, NVS_READONLY, &handle) != ESP_OK) return false;
  std::size_t pin_length = spki_sha256_.size();
  const bool loaded =
      read_blob(handle, kCertificateKey, certificate_.data(),
                certificate_.size(), certificate_length_) &&
      read_blob(handle, kPrivateKeyKey, private_key_.data(),
                private_key_.size(), private_key_length_) &&
      nvs_get_blob(handle, kPinKey, spki_sha256_.data(), &pin_length) ==
          ESP_OK &&
      pin_length == spki_sha256_.size();
  nvs_close(handle);
  if (!loaded) return false;

  mbedtls_x509_crt parsed;
  mbedtls_x509_crt_init(&parsed);
  bool valid = false;
  do {
    if (mbedtls_x509_crt_parse(&parsed, certificate_.data(),
                               certificate_length_) != 0) {
      break;
    }
    std::array<unsigned char, 256> public_key{};
    const int public_length = mbedtls_pk_write_pubkey_der(
        &parsed.pk, public_key.data(), public_key.size());
    Secret256 recomputed_pin{};
    if (public_length <= 0 ||
        !sha256_digest(
            public_key.data() + public_key.size() - public_length,
            static_cast<std::size_t>(public_length), recomputed_pin) ||
        !std::equal(recomputed_pin.begin(), recomputed_pin.end(),
                    spki_sha256_.begin())) {
      break;
    }
    valid = true;
  } while (false);
  mbedtls_x509_crt_free(&parsed);
  return valid;
}

bool EspTlsIdentity::generate(const char* common_name) {
  mbedtls_pk_context key;
  mbedtls_x509write_cert certificate;
  mbedtls_svc_key_id_t key_id = MBEDTLS_SVC_KEY_ID_INIT;
  psa_key_attributes_t key_attributes = PSA_KEY_ATTRIBUTES_INIT;
  mbedtls_pk_init(&key);
  mbedtls_x509write_crt_init(&certificate);

  bool success = false;
  bool key_generated = false;
  do {
    psa_set_key_type(
        &key_attributes,
        PSA_KEY_TYPE_ECC_KEY_PAIR(PSA_ECC_FAMILY_SECP_R1));
    psa_set_key_bits(&key_attributes, 256U);
    psa_set_key_algorithm(&key_attributes,
                          PSA_ALG_ECDSA(PSA_ALG_SHA_256));
    psa_set_key_usage_flags(
        &key_attributes,
        PSA_KEY_USAGE_SIGN_HASH | PSA_KEY_USAGE_VERIFY_HASH |
            PSA_KEY_USAGE_EXPORT);
    if (psa_generate_key(&key_attributes, &key_id) != PSA_SUCCESS) {
      break;
    }
    key_generated = true;
    if (mbedtls_pk_wrap_psa(&key, key_id) != 0) {
      break;
    }
    std::array<unsigned char, 256> public_key{};
    const int public_length =
        mbedtls_pk_write_pubkey_der(&key, public_key.data(),
                                    public_key.size());
    if (public_length <= 0 ||
        !sha256_digest(
            public_key.data() + public_key.size() - public_length,
            static_cast<std::size_t>(public_length), spki_sha256_)) {
      break;
    }
    if (mbedtls_pk_write_key_pem(&key, private_key_.data(),
                                 private_key_.size()) != 0) {
      break;
    }
    private_key_length_ =
        std::strlen(reinterpret_cast<const char*>(private_key_.data())) + 1U;

    const std::string subject = std::string("CN=") + common_name;
    constexpr std::array<unsigned char, 1> serial{1U};
    if (mbedtls_x509write_crt_set_subject_name(&certificate,
                                               subject.c_str()) != 0 ||
        mbedtls_x509write_crt_set_issuer_name(&certificate,
                                              subject.c_str()) != 0 ||
        mbedtls_x509write_crt_set_serial_raw(
            &certificate, serial.data(), serial.size()) != 0 ||
        mbedtls_x509write_crt_set_validity(
            &certificate, "20240101000000", "20440101000000") != 0 ||
        mbedtls_x509write_crt_set_basic_constraints(&certificate, 0, -1) != 0 ||
        mbedtls_x509write_crt_set_key_usage(
            &certificate, MBEDTLS_X509_KU_DIGITAL_SIGNATURE) != 0) {
      break;
    }
    mbedtls_x509write_crt_set_subject_key(&certificate, &key);
    mbedtls_x509write_crt_set_issuer_key(&certificate, &key);
    mbedtls_x509write_crt_set_md_alg(&certificate, MBEDTLS_MD_SHA256);
    if (mbedtls_x509write_crt_pem(
            &certificate, certificate_.data(), certificate_.size()) != 0) {
      break;
    }
    certificate_length_ =
        std::strlen(reinterpret_cast<const char*>(certificate_.data())) + 1U;
    success = true;
  } while (false);

  mbedtls_x509write_crt_free(&certificate);
  mbedtls_pk_free(&key);
  if (key_generated) psa_destroy_key(key_id);
  psa_reset_key_attributes(&key_attributes);
  return success;
}

bool EspTlsIdentity::persist() {
  nvs_handle_t handle = 0;
  if (nvs_open(kNamespace, NVS_READWRITE, &handle) != ESP_OK) return false;
  const bool saved =
      nvs_set_blob(handle, kCertificateKey, certificate_.data(),
                   certificate_length_) == ESP_OK &&
      nvs_set_blob(handle, kPrivateKeyKey, private_key_.data(),
                   private_key_length_) == ESP_OK &&
      nvs_set_blob(handle, kPinKey, spki_sha256_.data(),
                   spki_sha256_.size()) == ESP_OK &&
      nvs_commit(handle) == ESP_OK;
  nvs_close(handle);
  return saved;
}

}  // namespace philcoino::networking
