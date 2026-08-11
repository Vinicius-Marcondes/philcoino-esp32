#include "philcoino/esp_ota_update.hpp"

#include <algorithm>

#include "esp_err.h"
#include "esp_log.h"
#include "esp_system.h"

namespace philcoino::networking {
namespace {

constexpr char kLogTag[] = "philcoino-ota";

bool constant_time_equal(const FirmwareImageDigest& left,
                         const FirmwareImageDigest& right) {
  volatile std::uint8_t difference = 0U;
  for (std::size_t index = 0; index < left.size(); ++index) {
    difference |= left[index] ^ right[index];
  }
  return difference == 0U;
}

}  // namespace

EspOtaUpdateBackend::~EspOtaUpdateBackend() { abort(); }

std::size_t EspOtaUpdateBackend::maximum_image_size() const {
  const auto* partition = esp_ota_get_next_update_partition(nullptr);
  return partition == nullptr ? 0U : partition->size;
}

FirmwareUpdateResult EspOtaUpdateBackend::begin(
    std::size_t image_size, const FirmwareImageDigest& expected_digest) {
  if (active_) return FirmwareUpdateResult::kBusy;
  partition_ = esp_ota_get_next_update_partition(nullptr);
  if (partition_ == nullptr || image_size > partition_->size ||
      psa_crypto_init() != PSA_SUCCESS ||
      psa_hash_setup(&hash_operation_, PSA_ALG_SHA_256) != PSA_SUCCESS) {
    partition_ = nullptr;
    psa_hash_abort(&hash_operation_);
    return FirmwareUpdateResult::kBackendFailure;
  }
  hash_active_ = true;
  const auto result = esp_ota_begin(partition_, image_size, &handle_);
  if (result != ESP_OK) {
    psa_hash_abort(&hash_operation_);
    hash_active_ = false;
    partition_ = nullptr;
    return result == ESP_ERR_OTA_ROLLBACK_INVALID_STATE
               ? FirmwareUpdateResult::kBusy
               : FirmwareUpdateResult::kBackendFailure;
  }
  expected_digest_ = expected_digest;
  active_ = true;
  ESP_LOGI(kLogTag, "OTA image reception started slot=%s bytes=%u",
           partition_->label, static_cast<unsigned>(image_size));
  return FirmwareUpdateResult::kOk;
}

FirmwareUpdateResult EspOtaUpdateBackend::write(const std::uint8_t* data,
                                                std::size_t length) {
  if (!active_ || !hash_active_ || data == nullptr || length == 0U) {
    return FirmwareUpdateResult::kWriteFailure;
  }
  if (psa_hash_update(&hash_operation_, data, length) != PSA_SUCCESS ||
      esp_ota_write(handle_, data, length) != ESP_OK) {
    return FirmwareUpdateResult::kWriteFailure;
  }
  return FirmwareUpdateResult::kOk;
}

FirmwareUpdateResult EspOtaUpdateBackend::finish() {
  if (!active_ || !hash_active_) return FirmwareUpdateResult::kBackendFailure;
  FirmwareImageDigest actual_digest{};
  std::size_t digest_length = 0U;
  const auto hash_result = psa_hash_finish(
      &hash_operation_, actual_digest.data(), actual_digest.size(),
      &digest_length);
  hash_active_ = false;
  if (hash_result != PSA_SUCCESS || digest_length != actual_digest.size() ||
      !constant_time_equal(actual_digest, expected_digest_)) {
    esp_ota_abort(handle_);
    active_ = false;
    partition_ = nullptr;
    return hash_result == PSA_SUCCESS
               ? FirmwareUpdateResult::kDigestMismatch
               : FirmwareUpdateResult::kBackendFailure;
  }
  const auto end_result = esp_ota_end(handle_);
  active_ = false;
  if (end_result != ESP_OK) {
    partition_ = nullptr;
    return end_result == ESP_ERR_OTA_VALIDATE_FAILED
               ? FirmwareUpdateResult::kInvalidImage
               : FirmwareUpdateResult::kBackendFailure;
  }
  const auto boot_result = esp_ota_set_boot_partition(partition_);
  if (boot_result != ESP_OK) {
    partition_ = nullptr;
    return boot_result == ESP_ERR_OTA_VALIDATE_FAILED
               ? FirmwareUpdateResult::kInvalidImage
               : FirmwareUpdateResult::kBackendFailure;
  }
  ESP_LOGI(kLogTag, "OTA image validated; next boot slot=%s",
           partition_->label);
  partition_ = nullptr;
  return FirmwareUpdateResult::kOk;
}

void EspOtaUpdateBackend::abort() {
  if (active_) esp_ota_abort(handle_);
  if (hash_active_) psa_hash_abort(&hash_operation_);
  active_ = false;
  hash_active_ = false;
  partition_ = nullptr;
}

EspOtaBootValidationGuard::EspOtaBootValidationGuard() {
  const auto* running = esp_ota_get_running_partition();
  esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
  pending_ = running != nullptr &&
             esp_ota_get_state_partition(running, &state) == ESP_OK &&
             state == ESP_OTA_IMG_PENDING_VERIFY;
  if (pending_) {
    ESP_LOGW(kLogTag, "First boot of an OTA image is pending validation");
  }
}

EspOtaBootValidationGuard::~EspOtaBootValidationGuard() {
  if (!pending_) return;
  ESP_LOGE(kLogTag,
           "OTA first-boot initialization did not complete; rolling back");
  if (esp_ota_mark_app_invalid_rollback_and_reboot() != ESP_OK) {
    esp_restart();
  }
}

bool EspOtaBootValidationGuard::pending() const { return pending_; }

bool EspOtaBootValidationGuard::confirm() {
  if (!pending_) return true;
  if (esp_ota_mark_app_valid_cancel_rollback() != ESP_OK) return false;
  pending_ = false;
  ESP_LOGI(kLogTag, "OTA image marked valid after fail-off initialization");
  return true;
}

}  // namespace philcoino::networking
