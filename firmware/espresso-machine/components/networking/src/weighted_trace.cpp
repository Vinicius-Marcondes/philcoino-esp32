#include "philcoino/weighted_trace.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <iomanip>
#include <limits>
#include <locale>
#include <sstream>

namespace philcoino::networking {
namespace {

constexpr std::uint8_t kWeightAvailable = 1U << 0U;
constexpr std::uint8_t kPumpRunning = 1U << 1U;
constexpr unsigned kAvailabilityShift = 2U;
constexpr unsigned kPhaseShift = 4U;

class FlagGuard {
 public:
  explicit FlagGuard(std::atomic_flag& lock)
      : lock_(lock), acquired_(!lock_.test_and_set(std::memory_order_acquire)) {}
  ~FlagGuard() {
    if (acquired_) lock_.clear(std::memory_order_release);
  }
  bool acquired() const { return acquired_; }

 private:
  std::atomic_flag& lock_;
  bool acquired_;
};

bool valid_boot_id(const std::string& value) {
  return value.size() == 32U &&
         std::all_of(value.begin(), value.end(), [](char c) {
           return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
         });
}

bool valid_extraction_id(const std::string& value) {
  return !value.empty() && value.size() <= 64U &&
         std::all_of(value.begin(), value.end(), [](char c) {
           return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                  (c >= '0' && c <= '9') || c == '-';
         });
}

bool parse_sequence(const std::string& value, std::uint64_t& output) {
  if (value.empty()) return false;
  output = 0;
  for (char c : value) {
    if (c < '0' || c > '9') return false;
    const auto digit = static_cast<std::uint64_t>(c - '0');
    if (output > (9007199254740991ULL - digit) / 10ULL) return false;
    output = output * 10ULL + digit;
  }
  return true;
}

std::uint8_t phase_bits(control::ExtractionPhase phase, bool settling) {
  if (settling) return 3U;
  switch (phase) {
    case control::ExtractionPhase::kPreInfusion: return 0U;
    case control::ExtractionPhase::kSoak: return 1U;
    default: return 2U;
  }
}

const char* phase_name(std::uint8_t flags) {
  switch ((flags >> kPhaseShift) & 0x3U) {
    case 0U: return "pre-infusion";
    case 1U: return "soak";
    case 2U: return "main-extraction";
    default: return "settling";
  }
}

const char* availability_name(std::uint8_t flags) {
  switch ((flags >> kAvailabilityShift) & 0x3U) {
    case 0U: return "ready";
    case 1U: return "unstable";
    default: return "unavailable";
  }
}

const char* continuity_name(WeightedTraceContinuity continuity) {
  switch (continuity) {
    case WeightedTraceContinuity::kInitial: return "initial";
    case WeightedTraceContinuity::kContinuous: return "continuous";
    case WeightedTraceContinuity::kTruncated: return "truncated";
    case WeightedTraceContinuity::kReset: return "reset";
  }
  return "reset";
}

const char* status_name(WeightedTraceStatus status) {
  switch (status) {
    case WeightedTraceStatus::kRunning: return "running";
    case WeightedTraceStatus::kSettling: return "settling";
    case WeightedTraceStatus::kTerminal: return "terminal";
  }
  return "terminal";
}

}  // namespace

WeightedTraceBuffer::WeightedTraceBuffer(const std::string& boot_id) {
  if (!valid_boot_id(boot_id)) return;
  std::copy(boot_id.begin(), boot_id.end(), boot_id_.begin());
}

bool WeightedTraceBuffer::record(
    std::uint64_t uptime_ms, const control::ControlSnapshot& machine,
    const control::ExtractionSnapshot& extraction,
    const control::ScaleSnapshot& scale,
    const control::WeightExtractionSnapshot& weight) {
  const bool weighted_active = weight.active && extraction.status ==
                                                    control::ExtractionStatus::kRunning;
  const bool retained_terminal = weight.terminal;
  if (!weighted_active && !retained_terminal) return false;

  if (weighted_active &&
      std::strcmp(extraction_id_.data(), weight.extraction_id.c_str()) != 0) {
    FlagGuard reset_guard(lock_);
    if (!reset_guard.acquired()) return false;
    samples_ = {};
    extraction_id_ = {};
    std::copy(weight.extraction_id.begin(), weight.extraction_id.end(),
              extraction_id_.begin());
    start_ = 0;
    count_ = 0;
    terminal_elapsed_ms_ = 0;
    settling_started_uptime_ms_ = 0;
    status_ = WeightedTraceStatus::kRunning;
    present_ = true;
    terminal_sample_captured_.store(false, std::memory_order_release);
    latest_attempt_sequence_.store(0, std::memory_order_release);
    next_capture_ms_.store(uptime_ms, std::memory_order_release);
  }
  if (!present_ ||
      std::strcmp(extraction_id_.data(), weight.extraction_id.c_str()) != 0) {
    return false;
  }

  if (retained_terminal && status_ == WeightedTraceStatus::kRunning) {
    terminal_elapsed_ms_ = extraction.elapsed_ms;
    settling_started_uptime_ms_ = uptime_ms;
    status_ = weight.settled ? WeightedTraceStatus::kTerminal
                             : WeightedTraceStatus::kSettling;
  } else if (retained_terminal &&
             status_ == WeightedTraceStatus::kSettling &&
             (weight.settled ||
              uptime_ms - settling_started_uptime_ms_ >=
                  kWeightedTraceSettlingLimitMs)) {
    status_ = WeightedTraceStatus::kTerminal;
  }

  const auto due = next_capture_ms_.load(std::memory_order_acquire);
  if (uptime_ms < due ||
      (status_ == WeightedTraceStatus::kTerminal &&
       terminal_sample_captured_.load(std::memory_order_acquire))) {
    return false;
  }
  next_capture_ms_.store((uptime_ms / kWeightedTraceIntervalMs + 1U) *
                             kWeightedTraceIntervalMs,
                         std::memory_order_release);
  const auto sequence =
      latest_attempt_sequence_.fetch_add(1U, std::memory_order_acq_rel) + 1U;

  FlagGuard guard(lock_);
  if (!guard.acquired()) return false;
  WeightedTraceSample sample{};
  sample.sequence = sequence;
  sample.uptime_ms = uptime_ms;
  sample.elapsed_ms =
      weighted_active
          ? extraction.elapsed_ms
          : terminal_elapsed_ms_ + static_cast<std::uint32_t>(std::min<
                std::uint64_t>(uptime_ms - settling_started_uptime_ms_,
                               kWeightedTraceSettlingLimitMs));
  const auto temperature = std::lround(
      static_cast<double>(machine.boiler_temperature.temperature_c) * 4.0);
  sample.temperature_quarters_c = static_cast<std::int16_t>(
      std::clamp<long>(temperature, std::numeric_limits<std::int16_t>::min(),
                       std::numeric_limits<std::int16_t>::max()));
  sample.active_target_c = static_cast<std::uint8_t>(machine.targets.brew_c);
  if (weight.net_weight_available) {
    sample.net_weight_decigrams = weight.net_weight_decigrams;
    sample.flags |= kWeightAvailable;
  }
  if (extraction.pump_command == peripherals::PumpCommand::kRunning) {
    sample.flags |= kPumpRunning;
  }
  const auto availability =
      scale.availability == control::ScaleAvailability::kReady
          ? 0U
          : scale.availability == control::ScaleAvailability::kUnstable ? 1U
                                                                        : 2U;
  sample.flags |= static_cast<std::uint8_t>(availability << kAvailabilityShift);
  sample.flags |= static_cast<std::uint8_t>(
      phase_bits(extraction.phase, retained_terminal) << kPhaseShift);

  const auto index = (start_ + count_) % kWeightedTraceCapacity;
  if (count_ == kWeightedTraceCapacity) {
    samples_[start_] = sample;
    start_ = (start_ + 1U) % kWeightedTraceCapacity;
  } else {
    samples_[index] = sample;
    ++count_;
  }
  if (status_ == WeightedTraceStatus::kTerminal) {
    terminal_sample_captured_.store(true, std::memory_order_release);
  }
  return true;
}

bool WeightedTraceBuffer::page(const WeightedTraceCursor& cursor,
                               std::uint64_t captured_at_uptime_ms,
                               WeightedTracePage& output) {
  FlagGuard guard(lock_);
  if (!guard.acquired() || !present_ || count_ == 0U) return false;
  output = {};
  output.boot_id = boot_id_;
  output.extraction_id = extraction_id_;
  output.captured_at_uptime_ms = captured_at_uptime_ms;
  output.oldest_sequence = samples_[start_].sequence;
  output.latest_sequence =
      latest_attempt_sequence_.load(std::memory_order_acquire);
  output.status = status_;

  std::uint64_t after = cursor.after_sequence;
  if (!cursor.supplied) {
    output.continuity = WeightedTraceContinuity::kInitial;
    after = output.oldest_sequence - 1U;
  } else if (cursor.boot_id != boot_id_ ||
             cursor.extraction_id != extraction_id_) {
    output.continuity = WeightedTraceContinuity::kReset;
    after = output.oldest_sequence - 1U;
  } else if (after > output.latest_sequence) {
    return false;
  } else if (after + 1U < output.oldest_sequence) {
    output.continuity = WeightedTraceContinuity::kTruncated;
    after = output.oldest_sequence - 1U;
  } else {
    output.continuity = WeightedTraceContinuity::kContinuous;
  }

  for (std::size_t i = 0; i < count_ &&
                          output.sample_count < kWeightedTracePageSize;
       ++i) {
    const auto& sample = samples_[(start_ + i) % kWeightedTraceCapacity];
    if (sample.sequence > after) {
      output.samples[output.sample_count++] = sample;
    }
  }
  output.next_sequence =
      output.sample_count == 0U
          ? output.latest_sequence
          : output.samples[output.sample_count - 1U].sequence;
  output.has_more = output.next_sequence < output.latest_sequence;
  return true;
}

bool WeightedTraceBuffer::has_trace() {
  FlagGuard guard(lock_);
  return !guard.acquired() || present_;
}

bool WeightedTraceBuffer::capture_due(std::uint64_t uptime_ms,
                                      const std::string& extraction_id) {
  FlagGuard guard(lock_);
  if (!guard.acquired() ||
      std::strcmp(extraction_id_.data(), extraction_id.c_str()) != 0) {
    return true;
  }
  return uptime_ms >= next_capture_ms_.load(std::memory_order_acquire) &&
         !terminal_sample_captured_.load(std::memory_order_acquire);
}

bool parse_weighted_trace_cursor(const std::string& query,
                                 WeightedTraceCursor& cursor) {
  cursor = {};
  if (query.empty()) return true;
  std::string boot_id;
  std::string extraction_id;
  std::string sequence;
  std::size_t position = 0;
  unsigned fields = 0;
  while (position <= query.size()) {
    const auto end = query.find('&', position);
    const auto field = query.substr(position, end - position);
    const auto equals = field.find('=');
    if (equals == std::string::npos) return false;
    const auto key = field.substr(0, equals);
    const auto value = field.substr(equals + 1U);
    if (key == "bootId" && boot_id.empty()) boot_id = value;
    else if (key == "extractionId" && extraction_id.empty()) {
      extraction_id = value;
    } else if (key == "afterSequence" && sequence.empty()) {
      sequence = value;
    } else {
      return false;
    }
    ++fields;
    if (end == std::string::npos) break;
    position = end + 1U;
  }
  if (fields != 3U || !valid_boot_id(boot_id) ||
      !valid_extraction_id(extraction_id) ||
      !parse_sequence(sequence, cursor.after_sequence)) {
    return false;
  }
  cursor.supplied = true;
  std::copy(boot_id.begin(), boot_id.end(), cursor.boot_id.begin());
  std::copy(extraction_id.begin(), extraction_id.end(),
            cursor.extraction_id.begin());
  return true;
}

std::string serialize_weighted_trace_page(const std::string& device_id,
                                          const WeightedTracePage& page) {
  std::ostringstream output;
  output.imbue(std::locale::classic());
  output << std::setprecision(6) << "{\"deviceId\":\"" << device_id
         << "\",\"extractionId\":\"" << page.extraction_id.data()
         << "\",\"bootId\":\"" << page.boot_id.data()
         << "\",\"capturedAtUptimeMs\":" << page.captured_at_uptime_ms
         << ",\"status\":\"" << status_name(page.status)
         << "\",\"oldestSequence\":" << page.oldest_sequence
         << ",\"latestSequence\":" << page.latest_sequence
         << ",\"nextCursor\":{\"extractionId\":\""
         << page.extraction_id.data() << "\",\"bootId\":\""
         << page.boot_id.data() << "\",\"afterSequence\":"
         << page.next_sequence << "},\"hasMore\":"
         << (page.has_more ? "true" : "false") << ",\"continuity\":\""
         << continuity_name(page.continuity) << "\",\"samples\":[";
  for (std::size_t i = 0; i < page.sample_count; ++i) {
    if (i != 0U) output << ',';
    const auto& sample = page.samples[i];
    output << "{\"sequence\":" << sample.sequence
           << ",\"uptimeMs\":" << sample.uptime_ms
           << ",\"elapsedMs\":" << sample.elapsed_ms
           << ",\"phase\":\"" << phase_name(sample.flags)
           << "\",\"boilerTemperatureC\":"
           << static_cast<double>(sample.temperature_quarters_c) / 4.0
           << ",\"activeTargetC\":"
           << static_cast<unsigned>(sample.active_target_c)
           << ",\"netWeightDecigrams\":";
    if (sample.flags & kWeightAvailable) {
      output << sample.net_weight_decigrams;
    } else {
      output << "null";
    }
    output << ",\"scaleAvailability\":\""
           << availability_name(sample.flags) << "\",\"pumpCommand\":\""
           << ((sample.flags & kPumpRunning) ? "running" : "off") << "\"}";
  }
  output << "]}";
  return output.str();
}

}  // namespace philcoino::networking
