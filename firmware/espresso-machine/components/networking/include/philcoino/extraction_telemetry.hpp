#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>

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

static_assert(sizeof(ExtractionTelemetrySample) <= 40U);

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
  std::array<ExtractionTelemetrySample, kExtractionTelemetryCapacity> samples_{};
  std::array<char, 33> boot_id_{};
  std::array<char, 65> extraction_id_{};
  std::atomic_flag lock_ = ATOMIC_FLAG_INIT;
  std::atomic<std::uint64_t> latest_attempt_sequence_{0};
  std::atomic<std::uint64_t> next_capture_ms_{0};
  std::atomic<bool> terminal_sample_captured_{false};
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

static_assert(sizeof(ExtractionTelemetryBuffer) <= 16U * 1024U);
static_assert(sizeof(ExtractionTelemetryPage) <= 2U * 1024U);

bool parse_extraction_telemetry_cursor(const std::string& query,
                                       ExtractionTelemetryCursor& cursor);
std::string serialize_extraction_telemetry_page(
    const std::string& device_id, const ExtractionTelemetryPage& page);

}  // namespace philcoino::networking
