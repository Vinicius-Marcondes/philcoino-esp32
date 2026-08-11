#include <array>
#include <cassert>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

#include "philcoino/firmware_update.hpp"

namespace {

using philcoino::networking::FirmwareImageDigest;
using philcoino::networking::FirmwareUpdateBackend;
using philcoino::networking::FirmwareUpdateCoordinator;
using philcoino::networking::FirmwareUpdateResult;
using philcoino::networking::FirmwareUpdateSafety;
using philcoino::networking::FirmwareUpdateSafetyResult;

constexpr char kDigest[] =
    "000102030405060708090a0b0c0d0e0f"
    "101112131415161718191a1b1c1d1e1f";

class FakeSafety final : public FirmwareUpdateSafety {
 public:
  FirmwareUpdateSafetyResult prepare(std::uint32_t now_ms) override {
    prepare_calls += 1;
    last_now_ms = now_ms;
    return result;
  }

  FirmwareUpdateSafetyResult result{FirmwareUpdateSafetyResult::kReady};
  int prepare_calls{0};
  std::uint32_t last_now_ms{0};
};

class FakeBackend final : public FirmwareUpdateBackend {
 public:
  std::size_t maximum_image_size() const override { return maximum_size; }

  FirmwareUpdateResult begin(
      std::size_t image_size,
      const FirmwareImageDigest& expected_digest) override {
    begin_calls += 1;
    begun_size = image_size;
    digest = expected_digest;
    return begin_result;
  }

  FirmwareUpdateResult write(const std::uint8_t* data,
                             std::size_t length) override {
    write_calls += 1;
    if (write_result == FirmwareUpdateResult::kOk) {
      received.insert(received.end(), data, data + length);
    }
    return write_result;
  }

  FirmwareUpdateResult finish() override {
    finish_calls += 1;
    return finish_result;
  }

  void abort() override { abort_calls += 1; }

  std::size_t maximum_size{16};
  FirmwareUpdateResult begin_result{FirmwareUpdateResult::kOk};
  FirmwareUpdateResult write_result{FirmwareUpdateResult::kOk};
  FirmwareUpdateResult finish_result{FirmwareUpdateResult::kOk};
  int begin_calls{0};
  int write_calls{0};
  int finish_calls{0};
  int abort_calls{0};
  std::size_t begun_size{0};
  FirmwareImageDigest digest{};
  std::vector<std::uint8_t> received;
};

void test_digest_parser_is_strict() {
  FirmwareImageDigest digest{};
  assert(philcoino::networking::parse_firmware_image_digest(kDigest, digest));
  assert(digest.front() == 0U);
  assert(digest.back() == 31U);
  assert(!philcoino::networking::parse_firmware_image_digest(
      std::string(64, 'A'), digest));
  assert(!philcoino::networking::parse_firmware_image_digest(
      std::string(63, '0'), digest));
  assert(!philcoino::networking::parse_firmware_image_digest(
      std::string(64, 'g'), digest));
}

void test_successful_stream() {
  FakeSafety safety;
  FakeBackend backend;
  FirmwareUpdateCoordinator coordinator(safety, backend);
  assert(coordinator.begin(4, kDigest, 1234) == FirmwareUpdateResult::kOk);
  assert(safety.prepare_calls == 1);
  assert(safety.last_now_ms == 1234);
  assert(backend.begin_calls == 1);
  const std::array<std::uint8_t, 2> first{1, 2};
  const std::array<std::uint8_t, 2> second{3, 4};
  assert(coordinator.write(first.data(), first.size()) ==
         FirmwareUpdateResult::kOk);
  assert(coordinator.write(second.data(), second.size()) ==
         FirmwareUpdateResult::kOk);
  assert(coordinator.bytes_written() == 4U);
  assert(coordinator.finish() == FirmwareUpdateResult::kOk);
  assert(!coordinator.active());
  assert(backend.finish_calls == 1);
  assert((backend.received == std::vector<std::uint8_t>{1, 2, 3, 4}));
}

void test_invalid_requests_do_not_disable_outputs() {
  FakeSafety safety;
  FakeBackend backend;
  FirmwareUpdateCoordinator coordinator(safety, backend);
  assert(coordinator.begin(0, kDigest, 0) ==
         FirmwareUpdateResult::kInvalidMetadata);
  assert(coordinator.begin(17, kDigest, 0) ==
         FirmwareUpdateResult::kImageTooLarge);
  assert(coordinator.begin(1, "bad", 0) ==
         FirmwareUpdateResult::kInvalidMetadata);
  assert(safety.prepare_calls == 0);
  assert(backend.begin_calls == 0);
}

void test_safety_conflicts_stop_before_flash() {
  FakeSafety safety;
  FakeBackend backend;
  FirmwareUpdateCoordinator coordinator(safety, backend);
  safety.result = FirmwareUpdateSafetyResult::kBusy;
  assert(coordinator.begin(4, kDigest, 0) ==
         FirmwareUpdateResult::kSafetyConflict);
  safety.result = FirmwareUpdateSafetyResult::kOutputFailure;
  assert(coordinator.begin(4, kDigest, 0) ==
         FirmwareUpdateResult::kOutputFailure);
  assert(backend.begin_calls == 0);
}

void test_failed_or_oversized_writes_abort() {
  FakeSafety safety;
  FakeBackend backend;
  FirmwareUpdateCoordinator coordinator(safety, backend);
  const std::array<std::uint8_t, 5> bytes{1, 2, 3, 4, 5};
  assert(coordinator.begin(4, kDigest, 0) == FirmwareUpdateResult::kOk);
  assert(coordinator.write(bytes.data(), bytes.size()) ==
         FirmwareUpdateResult::kWriteFailure);
  assert(backend.abort_calls == 1);
  assert(!coordinator.active());

  assert(coordinator.begin(4, kDigest, 0) == FirmwareUpdateResult::kOk);
  backend.write_result = FirmwareUpdateResult::kBackendFailure;
  assert(coordinator.write(bytes.data(), 2) ==
         FirmwareUpdateResult::kBackendFailure);
  assert(backend.abort_calls == 2);
}

void test_incomplete_image_is_rejected() {
  FakeSafety safety;
  FakeBackend backend;
  FirmwareUpdateCoordinator coordinator(safety, backend);
  const std::array<std::uint8_t, 2> bytes{1, 2};
  assert(coordinator.begin(4, kDigest, 0) == FirmwareUpdateResult::kOk);
  assert(coordinator.write(bytes.data(), bytes.size()) ==
         FirmwareUpdateResult::kOk);
  assert(coordinator.finish() == FirmwareUpdateResult::kInvalidImage);
  assert(backend.abort_calls == 1);
  assert(backend.finish_calls == 0);
}

}  // namespace

int main() {
  test_digest_parser_is_strict();
  test_successful_stream();
  test_invalid_requests_do_not_disable_outputs();
  test_safety_conflicts_stop_before_flash();
  test_failed_or_oversized_writes_abort();
  test_incomplete_image_is_rejected();
  return 0;
}
