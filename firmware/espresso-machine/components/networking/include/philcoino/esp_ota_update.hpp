#pragma once

#include <array>
#include <cstddef>
#include <cstdint>

#include "esp_ota_ops.h"
#include "psa/crypto.h"
#include "philcoino/firmware_update.hpp"

namespace philcoino::networking {

class EspOtaUpdateBackend final : public FirmwareUpdateBackend {
 public:
  ~EspOtaUpdateBackend() override;

  std::size_t maximum_image_size() const override;
  FirmwareUpdateResult begin(
      std::size_t image_size,
      const FirmwareImageDigest& expected_digest) override;
  FirmwareUpdateResult write(const std::uint8_t* data,
                             std::size_t length) override;
  FirmwareUpdateResult finish() override;
  void abort() override;

 private:
  const esp_partition_t* partition_{nullptr};
  esp_ota_handle_t handle_{0};
  psa_hash_operation_t hash_operation_ = PSA_HASH_OPERATION_INIT;
  FirmwareImageDigest expected_digest_{};
  bool active_{false};
  bool hash_active_{false};
};

class EspOtaBootValidationGuard final {
 public:
  EspOtaBootValidationGuard();
  ~EspOtaBootValidationGuard();

  bool pending() const;
  bool confirm();

 private:
  bool pending_{false};
};

}  // namespace philcoino::networking
