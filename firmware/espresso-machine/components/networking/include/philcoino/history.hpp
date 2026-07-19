#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <string>

#include "philcoino/control.hpp"
#include "philcoino/peripherals.hpp"

namespace philcoino::networking {

inline constexpr std::size_t kHistoryCapacity = 600;
inline constexpr std::size_t kHistoryPageSize = 60;

struct HistorySample {
  std::uint64_t uptime_ms{0};
  std::int16_t temperature_quarters_c{0};
  std::uint8_t brew_target_c{0};
  std::uint8_t steam_target_c{0};
  std::uint16_t flags{0};
};

static_assert(sizeof(HistorySample) == 16U);

enum class HistoryContinuity { kInitial, kContinuous, kTruncated, kReset };

struct HistoryCursor {
  bool supplied{false};
  std::array<char, 33> boot_id{};
  std::uint64_t after_sequence{0};
};

struct HistoryPage {
  std::array<HistorySample, kHistoryPageSize> samples{};
  std::array<char, 33> boot_id{};
  std::size_t sample_count{0};
  std::uint64_t first_sequence{0};
  std::uint64_t oldest_sequence{0};
  std::uint64_t latest_sequence{0};
  std::uint64_t next_sequence{0};
  std::uint64_t captured_at_uptime_ms{0};
  HistoryContinuity continuity{HistoryContinuity::kInitial};
  bool empty{true};
  bool has_more{false};
};

class HistoryBuffer {
 public:
  explicit HistoryBuffer(const std::string& boot_id);

  bool record(std::uint64_t uptime_ms,
              const control::ControlSnapshot& snapshot,
              peripherals::PumpCommand pump_command);
  bool page(const HistoryCursor& cursor, std::uint64_t captured_at_uptime_ms,
            HistoryPage& output);
  const std::array<char, 33>& boot_id() const { return boot_id_; }

 private:
  std::array<HistorySample, kHistoryCapacity> samples_{};
  std::array<char, 33> boot_id_{};
  std::atomic_flag lock_ = ATOMIC_FLAG_INIT;
  std::size_t start_{0};
  std::size_t count_{0};
  std::uint64_t latest_sequence_{0};
  std::uint64_t next_capture_ms_{1000};
};

static_assert(sizeof(HistoryBuffer) <= 12U * 1024U);

bool parse_history_cursor(const std::string& query, HistoryCursor& cursor);
std::string serialize_history_page(const std::string& device_id,
                                   const HistoryPage& page);

}  // namespace philcoino::networking
