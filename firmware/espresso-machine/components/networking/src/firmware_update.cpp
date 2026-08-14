#include "philcoino/firmware_update.hpp"

namespace philcoino::networking {

namespace {

int hex_digit(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  return -1;
}

}  // namespace

bool parse_firmware_image_digest(std::string_view value,
                                 FirmwareImageDigest& digest) {
  if (value.size() != digest.size() * 2U) return false;
  FirmwareImageDigest parsed{};
  for (std::size_t index = 0; index < parsed.size(); ++index) {
    const int high = hex_digit(value[index * 2U]);
    const int low = hex_digit(value[index * 2U + 1U]);
    if (high < 0 || low < 0) return false;
    parsed[index] = static_cast<std::uint8_t>((high << 4) | low);
  }
  digest = parsed;
  return true;
}

FirmwareUpdateCoordinator::FirmwareUpdateCoordinator(
    FirmwareUpdateSafety& safety, FirmwareUpdateBackend& backend)
    : safety_(safety), backend_(backend) {}

FirmwareUpdateResult FirmwareUpdateCoordinator::begin(
    std::size_t image_size, std::string_view expected_digest,
    std::uint32_t now_ms) {
  if (active_) return FirmwareUpdateResult::kBusy;
  FirmwareImageDigest digest{};
  if (image_size == 0U || !parse_firmware_image_digest(expected_digest, digest)) {
    return FirmwareUpdateResult::kInvalidMetadata;
  }
  const auto maximum_size = backend_.maximum_image_size();
  if (maximum_size == 0U) return FirmwareUpdateResult::kBackendFailure;
  if (image_size > maximum_size) {
    return FirmwareUpdateResult::kImageTooLarge;
  }
  const auto safety_result = safety_.prepare(now_ms);
  if (safety_result == FirmwareUpdateSafetyResult::kBusy) {
    return FirmwareUpdateResult::kSafetyConflict;
  }
  if (safety_result == FirmwareUpdateSafetyResult::kOutputFailure) {
    return FirmwareUpdateResult::kOutputFailure;
  }
  const auto result = backend_.begin(image_size, digest);
  if (result != FirmwareUpdateResult::kOk) return result;
  active_ = true;
  expected_size_ = image_size;
  bytes_written_ = 0U;
  return FirmwareUpdateResult::kOk;
}

FirmwareUpdateResult FirmwareUpdateCoordinator::write(
    const std::uint8_t* data, std::size_t length) {
  if (!active_ || data == nullptr || length == 0U ||
      bytes_written_ > expected_size_ ||
      length > expected_size_ - bytes_written_) {
    abort();
    return FirmwareUpdateResult::kWriteFailure;
  }
  const auto result = backend_.write(data, length);
  if (result != FirmwareUpdateResult::kOk) {
    abort();
    return result;
  }
  bytes_written_ += length;
  return FirmwareUpdateResult::kOk;
}

FirmwareUpdateResult FirmwareUpdateCoordinator::finish() {
  if (!active_ || bytes_written_ != expected_size_) {
    abort();
    return FirmwareUpdateResult::kInvalidImage;
  }
  const auto result = backend_.finish();
  active_ = false;
  expected_size_ = 0U;
  return result;
}

void FirmwareUpdateCoordinator::abort() {
  if (active_) backend_.abort();
  active_ = false;
  expected_size_ = 0U;
}

bool FirmwareUpdateCoordinator::active() const { return active_; }

std::size_t FirmwareUpdateCoordinator::bytes_written() const {
  return bytes_written_;
}

}  // namespace philcoino::networking
