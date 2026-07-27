#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>

#include "philcoino/control.hpp"

namespace philcoino::networking {

inline constexpr std::size_t kWeightedTraceCapacity = 320;
inline constexpr std::size_t kWeightedTracePageSize = 16;
inline constexpr std::uint32_t kWeightedTraceIntervalMs = 250;
inline constexpr std::uint32_t kWeightedTraceSettlingLimitMs = 10'000;

enum class WeightedTraceContinuity {
  kInitial,
  kContinuous,
  kTruncated,
  kReset,
};

enum class WeightedTraceStatus { kRunning, kSettling, kTerminal };

struct WeightedTraceSample {
  std::uint64_t sequence{0};
  std::uint64_t uptime_ms{0};
  std::uint32_t elapsed_ms{0};
  std::int32_t net_weight_decigrams{0};
  std::int16_t temperature_quarters_c{0};
  std::uint8_t active_target_c{0};
  std::uint8_t flags{0};
};

static_assert(sizeof(WeightedTraceSample) <= 32U);

struct WeightedTraceCursor {
  bool supplied{false};
  std::array<char, 33> boot_id{};
  std::array<char, 65> extraction_id{};
  std::uint64_t after_sequence{0};
};

struct WeightedTracePage {
  std::array<WeightedTraceSample, kWeightedTracePageSize> samples{};
  std::array<char, 33> boot_id{};
  std::array<char, 65> extraction_id{};
  std::size_t sample_count{0};
  std::uint64_t oldest_sequence{0};
  std::uint64_t latest_sequence{0};
  std::uint64_t next_sequence{0};
  std::uint64_t captured_at_uptime_ms{0};
  WeightedTraceContinuity continuity{WeightedTraceContinuity::kInitial};
  WeightedTraceStatus status{WeightedTraceStatus::kTerminal};
  bool has_more{false};
};

class WeightedTraceBuffer {
 public:
  explicit WeightedTraceBuffer(const std::string& boot_id);

  bool record(std::uint64_t uptime_ms,
              const control::ControlSnapshot& machine,
              const control::ExtractionSnapshot& extraction,
              const control::ScaleSnapshot& scale,
              const control::WeightExtractionSnapshot& weight);
  bool page(const WeightedTraceCursor& cursor,
            std::uint64_t captured_at_uptime_ms,
            WeightedTracePage& output);
  bool capture_due(std::uint64_t uptime_ms,
                   const std::string& extraction_id);
  bool has_trace();

 private:
  std::array<WeightedTraceSample, kWeightedTraceCapacity> samples_{};
  std::array<char, 33> boot_id_{};
  std::array<char, 65> extraction_id_{};
  std::atomic_flag lock_ = ATOMIC_FLAG_INIT;
  std::atomic<std::uint64_t> latest_attempt_sequence_{0};
  std::atomic<std::uint64_t> next_capture_ms_{0};
  std::size_t start_{0};
  std::size_t count_{0};
  std::uint32_t terminal_elapsed_ms_{0};
  std::uint64_t settling_started_uptime_ms_{0};
  WeightedTraceStatus status_{WeightedTraceStatus::kTerminal};
  bool present_{false};
  std::atomic<bool> terminal_sample_captured_{false};
};

static_assert(sizeof(WeightedTraceBuffer) <= 16U * 1024U);
static_assert(sizeof(WeightedTracePage) <= 2U * 1024U);

bool parse_weighted_trace_cursor(const std::string& query,
                                 WeightedTraceCursor& cursor);
std::string serialize_weighted_trace_page(const std::string& device_id,
                                          const WeightedTracePage& page);

}  // namespace philcoino::networking
