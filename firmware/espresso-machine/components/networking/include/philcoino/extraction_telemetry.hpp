#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>
#include <type_traits>

#include "philcoino/control.hpp"

namespace philcoino::networking {

inline constexpr std::size_t kExtractionTelemetryCapacity = 320;
inline constexpr std::size_t kExtractionTelemetryPageSize = 16;
inline constexpr std::uint32_t kExtractionTelemetryIntervalMs = 250;
inline constexpr std::uint32_t kExtractionTelemetrySettlingLimitMs = 10'000;
inline constexpr std::uint32_t kExtractionTelemetryHeartbeatMs = 2'000;
inline constexpr std::size_t kExtractionTelemetrySerializedPageLimit = 8U * 1024U;

enum class ExtractionTelemetryContinuity {
  kInitial,
  kContinuous,
  kTruncated,
  kReset,
};

enum class ExtractionTelemetryStatus { kRunning, kSettling, kTerminal };

struct ExtractionTelemetrySample {
  std::uint64_t sequence{0};
  std::uint64_t uptime_ms{0};
  std::uint32_t elapsed_ms{0};
  std::uint32_t extraction_elapsed_ms{0};
  std::int32_t net_weight_decigrams{0};
  std::int16_t temperature_quarters_c{0};
  std::uint8_t active_target_c{0};
  std::uint8_t flags{0};
};

struct ExtractionTelemetrySlot {
  // Odd values are being written; even values are committed. The sequence
  // makes readers retry an overwritten slot without ever blocking the sole
  // producer.
  std::atomic<std::uint32_t> commit{0};
  std::atomic<std::uint32_t> sequence_low{0};
  std::atomic<std::uint32_t> sequence_high{0};
  std::atomic<std::uint32_t> uptime_ms_low{0};
  std::atomic<std::uint32_t> uptime_ms_high{0};
  std::atomic<std::uint32_t> elapsed_ms{0};
  std::atomic<std::uint32_t> extraction_elapsed_ms{0};
  std::atomic<std::int32_t> net_weight_decigrams{0};
  std::atomic<std::int16_t> temperature_quarters_c{0};
  std::atomic<std::uint8_t> active_target_c{0};
  std::atomic<std::uint8_t> flags{0};
};

struct ExtractionTelemetryCursor {
  bool supplied{false};
  std::array<char, 33> boot_id{};
  std::array<char, 65> extraction_id{};
  std::uint64_t after_sequence{0};
};

struct ExtractionTelemetryPage {
  std::array<ExtractionTelemetrySample, kExtractionTelemetryPageSize> samples{};
  std::array<char, 33> boot_id{};
  std::array<char, 65> extraction_id{};
  std::size_t sample_count{0};
  std::uint64_t oldest_sequence{0};
  std::uint64_t latest_sequence{0};
  std::uint64_t next_sequence{0};
  std::uint64_t captured_at_uptime_ms{0};
  ExtractionTelemetryContinuity continuity{
      ExtractionTelemetryContinuity::kInitial};
  ExtractionTelemetryStatus status{ExtractionTelemetryStatus::kTerminal};
  control::ExtractionSelection selection{};
  control::WeightControl weight_control{};
  control::ExtractionOutcome outcome{control::ExtractionOutcome::kNone};
  control::WeightCompletionReason weight_completion_reason{
      control::WeightCompletionReason::kNone};
  std::int32_t baseline_weight_decigrams{0};
  std::int32_t terminal_weight_decigrams{0};
  bool weighted{false};
  bool baseline_available{false};
  bool terminal_weight_available{false};
  bool terminal_weight_settled{false};
  bool weight_fallback{false};
  bool has_more{false};
};

struct ExtractionTelemetryMetadata {
  std::array<char, 65> extraction_id{};
  std::size_t start{0};
  std::size_t count{0};
  ExtractionTelemetryStatus status{ExtractionTelemetryStatus::kTerminal};
  control::ExtractionSelection selection{};
  control::WeightControl weight_control{};
  control::ExtractionOutcome outcome{control::ExtractionOutcome::kNone};
  control::WeightCompletionReason weight_completion_reason{
      control::WeightCompletionReason::kNone};
  std::int32_t baseline_weight_decigrams{0};
  std::int32_t terminal_weight_decigrams{0};
  bool present{false};
  bool weighted{false};
  bool baseline_available{false};
  bool terminal_weight_available{false};
  bool terminal_weight_settled{false};
  bool weight_fallback{false};
};

template <typename T>
class AtomicObject {
  static_assert(std::is_trivially_copyable<T>::value,
                "AtomicObject requires a trivially copyable value");

 public:
  AtomicObject() {
    for (auto& byte : bytes_) byte.store(0, std::memory_order_relaxed);
  }

  void store(const T& value) {
    const auto* source = reinterpret_cast<const unsigned char*>(&value);
    for (std::size_t index = 0; index < sizeof(T); ++index) {
      bytes_[index].store(source[index], std::memory_order_relaxed);
    }
  }

  T load() const {
    T value{};
    auto* destination = reinterpret_cast<unsigned char*>(&value);
    for (std::size_t index = 0; index < sizeof(T); ++index) {
      destination[index] = bytes_[index].load(std::memory_order_relaxed);
    }
    return value;
  }

 private:
  std::array<std::atomic<unsigned char>, sizeof(T)> bytes_{};
};

class ExtractionTelemetryBuffer {
 public:
  using Notification = void (*)(void* context);

  explicit ExtractionTelemetryBuffer(const std::string& boot_id);

  bool record(std::uint64_t uptime_ms,
              const control::ControlSnapshot& machine,
              const control::ExtractionSnapshot& extraction,
              const control::ScaleSnapshot& scale,
              const control::WeightExtractionSnapshot& weight);
  bool page(const ExtractionTelemetryCursor& cursor,
            std::uint64_t captured_at_uptime_ms,
            ExtractionTelemetryPage& output);
  bool capture_due(std::uint64_t uptime_ms,
                   const std::string& extraction_id);
  bool cursor_available(const ExtractionTelemetryCursor& cursor);
  void set_notification(Notification notification, void* context);

 private:
  void publish_metadata();

  std::array<ExtractionTelemetrySlot, kExtractionTelemetryCapacity> samples_{};
  std::array<char, 33> boot_id_{};
  std::array<char, 65> extraction_id_{};
  std::atomic<std::uint32_t> metadata_commit_{0};
  AtomicObject<ExtractionTelemetryMetadata> published_metadata_{};
  // These values belong exclusively to the single workflow producer.
  std::uint64_t latest_attempt_sequence_{0};
  std::uint64_t next_capture_ms_{0};
  bool terminal_sample_captured_{false};
  std::atomic<Notification> notification_{nullptr};
  std::atomic<void*> notification_context_{nullptr};
  std::size_t start_{0};
  std::size_t count_{0};
  std::uint32_t terminal_elapsed_ms_{0};
  std::uint64_t settling_started_uptime_ms_{0};
  ExtractionTelemetryStatus status_{ExtractionTelemetryStatus::kTerminal};
  control::ExtractionSelection selection_{};
  control::WeightControl weight_control_{};
  control::ExtractionOutcome outcome_{control::ExtractionOutcome::kNone};
  control::WeightCompletionReason weight_completion_reason_{
      control::WeightCompletionReason::kNone};
  std::int32_t baseline_weight_decigrams_{0};
  std::int32_t terminal_weight_decigrams_{0};
  bool present_{false};
  bool weighted_{false};
  bool baseline_available_{false};
  bool terminal_weight_available_{false};
  bool terminal_weight_settled_{false};
  bool weight_fallback_{false};
};

bool parse_extraction_telemetry_cursor(const std::string& query,
                                       ExtractionTelemetryCursor& cursor);
std::string serialize_extraction_telemetry_page(
    const std::string& device_id, const ExtractionTelemetryPage& page);

}  // namespace philcoino::networking
