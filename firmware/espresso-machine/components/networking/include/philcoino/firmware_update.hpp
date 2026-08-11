#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace philcoino::networking {

using FirmwareImageDigest = std::array<std::uint8_t, 32>;

enum class FirmwareUpdateResult {
  kOk,
  kBusy,
  kInvalidMetadata,
  kImageTooLarge,
  kSafetyConflict,
  kOutputFailure,
  kWriteFailure,
  kDigestMismatch,
  kInvalidImage,
  kBackendFailure,
};

enum class FirmwareUpdateSafetyResult {
  kReady,
  kBusy,
  kOutputFailure,
};

class FirmwareUpdateSafety {
 public:
  virtual ~FirmwareUpdateSafety() = default;
  virtual FirmwareUpdateSafetyResult prepare(std::uint32_t now_ms) = 0;
};

class FirmwareUpdateBackend {
 public:
  virtual ~FirmwareUpdateBackend() = default;
  virtual std::size_t maximum_image_size() const = 0;
  virtual FirmwareUpdateResult begin(
      std::size_t image_size,
      const FirmwareImageDigest& expected_digest) = 0;
  virtual FirmwareUpdateResult write(const std::uint8_t* data,
                                     std::size_t length) = 0;
  virtual FirmwareUpdateResult finish() = 0;
  virtual void abort() = 0;
};

bool parse_firmware_image_digest(std::string_view value,
                                 FirmwareImageDigest& digest);

class FirmwareUpdateCoordinator {
 public:
  FirmwareUpdateCoordinator(FirmwareUpdateSafety& safety,
                            FirmwareUpdateBackend& backend);

  FirmwareUpdateResult begin(std::size_t image_size,
                             std::string_view expected_digest,
                             std::uint32_t now_ms);
  FirmwareUpdateResult write(const std::uint8_t* data, std::size_t length);
  FirmwareUpdateResult finish();
  void abort();
  bool active() const;
  std::size_t bytes_written() const;

 private:
  FirmwareUpdateSafety& safety_;
  FirmwareUpdateBackend& backend_;
  bool active_{false};
  std::size_t expected_size_{0};
  std::size_t bytes_written_{0};
};

}  // namespace philcoino::networking
