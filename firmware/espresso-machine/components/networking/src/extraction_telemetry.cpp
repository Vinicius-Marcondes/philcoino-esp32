#include "philcoino/extraction_telemetry.hpp"

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
constexpr std::uint8_t kHeaterActive = 1U << 2U;
constexpr unsigned kAvailabilityShift = 3U;
constexpr unsigned kPhaseShift = 5U;

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
                  (c >= '0' && c <= '9') || c == '.' || c == '_' ||
                  c == '~' || c == '-';
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
  if (settling) return 4U;
  switch (phase) {
    case control::ExtractionPhase::kManual: return 0U;
    case control::ExtractionPhase::kPreInfusion: return 1U;
    case control::ExtractionPhase::kSoak: return 2U;
    default: return 3U;
  }
}

const char* phase_name(std::uint8_t flags) {
  switch ((flags >> kPhaseShift) & 0x7U) {
    case 0U: return "manual";
    case 1U: return "pre-infusion";
    case 2U: return "soak";
    case 3U: return "main-extraction";
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

const char* continuity_name(ExtractionTelemetryContinuity continuity) {
  switch (continuity) {
    case ExtractionTelemetryContinuity::kInitial: return "initial";
    case ExtractionTelemetryContinuity::kContinuous: return "continuous";
    case ExtractionTelemetryContinuity::kTruncated: return "truncated";
    case ExtractionTelemetryContinuity::kReset: return "reset";
  }
  return "reset";
}

const char* status_name(ExtractionTelemetryStatus status) {
  switch (status) {
    case ExtractionTelemetryStatus::kRunning: return "running";
    case ExtractionTelemetryStatus::kSettling: return "settling";
    case ExtractionTelemetryStatus::kTerminal: return "terminal";
  }
  return "terminal";
}

const char* outcome_name(control::ExtractionOutcome outcome) {
  switch (outcome) {
    case control::ExtractionOutcome::kCompleted: return "completed";
    case control::ExtractionOutcome::kStopped: return "stopped";
    case control::ExtractionOutcome::kFailed: return "failed";
    default: return "running";
  }
}

const char* completion_name(control::WeightCompletionReason reason) {
  switch (reason) {
    case control::WeightCompletionReason::kWeightReached: return "weight-reached";
    case control::WeightCompletionReason::kTimerFallback: return "timer-fallback";
    case control::WeightCompletionReason::kStopped: return "stopped";
    default: return "safety-cutoff";
  }
}

}  // namespace

ExtractionTelemetryBuffer::ExtractionTelemetryBuffer(
    const std::string& boot_id) {
  if (!valid_boot_id(boot_id)) return;
  std::copy(boot_id.begin(), boot_id.end(), boot_id_.begin());
}

bool ExtractionTelemetryBuffer::record(
    std::uint64_t uptime_ms, const control::ControlSnapshot& machine,
    const control::ExtractionSnapshot& extraction,
    const control::ScaleSnapshot& scale,
    const control::WeightExtractionSnapshot& weight) {
  const bool running = extraction.status == control::ExtractionStatus::kRunning;
  const bool retained_terminal =
      extraction.status == control::ExtractionStatus::kIdle &&
      !extraction.extraction_id.empty() &&
      extraction.outcome != control::ExtractionOutcome::kNone;
  if (!running && !retained_terminal) return false;

  FlagGuard guard(lock_);
  if (!guard.acquired()) {
    latest_attempt_sequence_.fetch_add(1U, std::memory_order_acq_rel);
    return false;
  }
  if (running &&
      std::strcmp(extraction_id_.data(), extraction.extraction_id.c_str()) != 0) {
    samples_ = {};
    extraction_id_ = {};
    std::copy(extraction.extraction_id.begin(), extraction.extraction_id.end(),
              extraction_id_.begin());
    start_ = 0;
    count_ = 0;
    terminal_elapsed_ms_ = 0;
    settling_started_uptime_ms_ = 0;
    status_ = ExtractionTelemetryStatus::kRunning;
    selection_ = extraction.selection;
    weighted_ = weight.active && weight.extraction_id == extraction.extraction_id;
    weight_control_ = weighted_ ? weight.control : control::WeightControl{};
    baseline_available_ = false;
    if (weighted_ && scale.gross_weight_available &&
        weight.net_weight_available) {
      baseline_available_ = true;
      baseline_weight_decigrams_ =
          scale.gross_weight_decigrams - weight.net_weight_decigrams;
    } else if (!weighted_ && scale.gross_weight_available &&
               scale.calibration_status ==
                   control::ScaleCalibrationStatus::kCalibrated &&
               scale.availability == control::ScaleAvailability::kReady) {
      baseline_available_ = true;
      baseline_weight_decigrams_ = scale.gross_weight_decigrams;
    }
    terminal_weight_available_ = false;
    terminal_weight_settled_ = false;
    weight_fallback_ = false;
    outcome_ = control::ExtractionOutcome::kNone;
    weight_completion_reason_ = control::WeightCompletionReason::kNone;
    present_ = true;
    terminal_sample_captured_.store(false, std::memory_order_release);
    latest_attempt_sequence_.store(0, std::memory_order_release);
    next_capture_ms_.store(uptime_ms, std::memory_order_release);
  }
  if (!present_ ||
      std::strcmp(extraction_id_.data(), extraction.extraction_id.c_str()) != 0) {
    return false;
  }

  if (retained_terminal && status_ == ExtractionTelemetryStatus::kRunning) {
    terminal_elapsed_ms_ = extraction.elapsed_ms;
    settling_started_uptime_ms_ = uptime_ms;
    status_ = ExtractionTelemetryStatus::kSettling;
    outcome_ = extraction.outcome;
  } else if (retained_terminal &&
             status_ == ExtractionTelemetryStatus::kSettling &&
             uptime_ms - settling_started_uptime_ms_ >=
                 kExtractionTelemetrySettlingLimitMs) {
    status_ = ExtractionTelemetryStatus::kTerminal;
  }
  if (weighted_ && weight.terminal &&
      weight.extraction_id == extraction.extraction_id) {
    terminal_weight_available_ = weight.net_weight_available;
    terminal_weight_decigrams_ = weight.net_weight_decigrams;
    terminal_weight_settled_ = weight.settled;
    weight_fallback_ = weight.fallback;
    weight_completion_reason_ = weight.completion_reason;
  }

  const auto due = next_capture_ms_.load(std::memory_order_acquire);
  if (uptime_ms < due ||
      (status_ == ExtractionTelemetryStatus::kTerminal &&
       terminal_sample_captured_.load(std::memory_order_acquire))) {
    return false;
  }
  const auto next_capture =
      uptime_ms > std::numeric_limits<std::uint64_t>::max() -
                      kExtractionTelemetryIntervalMs
          ? std::numeric_limits<std::uint64_t>::max()
          : uptime_ms + kExtractionTelemetryIntervalMs;
  next_capture_ms_.store(next_capture, std::memory_order_release);
  const auto sequence =
      latest_attempt_sequence_.fetch_add(1U, std::memory_order_acq_rel) + 1U;

  ExtractionTelemetrySample sample{};
  sample.sequence = sequence;
  sample.uptime_ms = uptime_ms;
  sample.extraction_elapsed_ms = running ? extraction.elapsed_ms
                                         : terminal_elapsed_ms_;
  sample.elapsed_ms =
      running
          ? extraction.elapsed_ms
          : terminal_elapsed_ms_ + static_cast<std::uint32_t>(std::min<
                std::uint64_t>(uptime_ms - settling_started_uptime_ms_,
                               kExtractionTelemetrySettlingLimitMs));
  const auto temperature = std::lround(
      static_cast<double>(machine.boiler_temperature.temperature_c) * 4.0);
  sample.temperature_quarters_c = static_cast<std::int16_t>(
      std::clamp<long>(temperature, std::numeric_limits<std::int16_t>::min(),
                       std::numeric_limits<std::int16_t>::max()));
  sample.active_target_c = static_cast<std::uint8_t>(machine.targets.brew_c);
  bool net_available = false;
  if (weighted_ && weight.extraction_id == extraction.extraction_id &&
      weight.net_weight_available) {
    net_available = true;
    sample.net_weight_decigrams = weight.net_weight_decigrams;
  } else if (!weighted_ && baseline_available_ &&
             scale.gross_weight_available) {
    net_available = true;
    sample.net_weight_decigrams =
        scale.gross_weight_decigrams - baseline_weight_decigrams_;
  }
  if (net_available) sample.flags |= kWeightAvailable;
  if (running && extraction.pump_command == peripherals::PumpCommand::kRunning) {
    sample.flags |= kPumpRunning;
  }
  if (machine.heater_enabled) sample.flags |= kHeaterActive;
  const auto availability =
      scale.availability == control::ScaleAvailability::kReady
          ? 0U
          : scale.availability == control::ScaleAvailability::kUnstable ? 1U
                                                                        : 2U;
  sample.flags |= static_cast<std::uint8_t>(availability << kAvailabilityShift);
  sample.flags |= static_cast<std::uint8_t>(
      phase_bits(extraction.phase, !running) << kPhaseShift);

  const auto index = (start_ + count_) % kExtractionTelemetryCapacity;
  if (count_ == kExtractionTelemetryCapacity) {
    samples_[start_] = sample;
    start_ = (start_ + 1U) % kExtractionTelemetryCapacity;
  } else {
    samples_[index] = sample;
    ++count_;
  }
  if (status_ == ExtractionTelemetryStatus::kTerminal) {
    terminal_sample_captured_.store(true, std::memory_order_release);
  }
  const auto notification = notification_.load(std::memory_order_acquire);
  if (notification != nullptr) {
    notification(notification_context_.load(std::memory_order_acquire));
  }
  return true;
}

bool ExtractionTelemetryBuffer::page(
    const ExtractionTelemetryCursor& cursor,
    std::uint64_t captured_at_uptime_ms, ExtractionTelemetryPage& output) {
  FlagGuard guard(lock_);
  if (!guard.acquired() || !present_ || count_ == 0U) return false;
  output = {};
  output.boot_id = boot_id_;
  output.extraction_id = extraction_id_;
  output.captured_at_uptime_ms = captured_at_uptime_ms;
  output.oldest_sequence = samples_[start_].sequence;
  output.latest_sequence =
      samples_[(start_ + count_ - 1U) % kExtractionTelemetryCapacity].sequence;
  output.status = status_;
  output.selection = selection_;
  output.weight_control = weight_control_;
  output.outcome = outcome_;
  output.weight_completion_reason = weight_completion_reason_;
  output.baseline_weight_decigrams = baseline_weight_decigrams_;
  output.terminal_weight_decigrams = terminal_weight_decigrams_;
  output.weighted = weighted_;
  output.baseline_available = baseline_available_;
  output.terminal_weight_available = terminal_weight_available_;
  output.terminal_weight_settled = terminal_weight_settled_;
  output.weight_fallback = weight_fallback_;

  std::uint64_t after = cursor.after_sequence;
  if (!cursor.supplied) {
    output.continuity = ExtractionTelemetryContinuity::kInitial;
    after = output.oldest_sequence - 1U;
  } else if (cursor.boot_id != boot_id_ ||
             cursor.extraction_id != extraction_id_) {
    output.continuity = ExtractionTelemetryContinuity::kReset;
    after = output.oldest_sequence - 1U;
  } else if (after > output.latest_sequence) {
    return false;
  } else if (after + 1U < output.oldest_sequence) {
    output.continuity = ExtractionTelemetryContinuity::kTruncated;
    after = output.oldest_sequence - 1U;
  } else {
    output.continuity = ExtractionTelemetryContinuity::kContinuous;
  }

  for (std::size_t index = 0;
       index < count_ && output.sample_count < kExtractionTelemetryPageSize;
       ++index) {
    const auto& sample =
        samples_[(start_ + index) % kExtractionTelemetryCapacity];
    if (sample.sequence > after) {
      output.samples[output.sample_count++] = sample;
    }
  }
  output.next_sequence =
      output.sample_count == 0U
          ? after
          : output.samples[output.sample_count - 1U].sequence;
  output.has_more = output.next_sequence < output.latest_sequence;
  return output.sample_count > 0U;
}

bool ExtractionTelemetryBuffer::cursor_available(
    const ExtractionTelemetryCursor& cursor) {
  FlagGuard guard(lock_);
  if (!guard.acquired()) return true;
  if (!present_ || count_ == 0U) return false;
  if (!cursor.supplied || cursor.boot_id != boot_id_ ||
      cursor.extraction_id != extraction_id_) {
    return true;
  }
  const auto latest =
      samples_[(start_ + count_ - 1U) % kExtractionTelemetryCapacity].sequence;
  return cursor.after_sequence <= latest;
}

bool ExtractionTelemetryBuffer::capture_due(
    std::uint64_t uptime_ms, const std::string& extraction_id) {
  FlagGuard guard(lock_);
  if (!guard.acquired() ||
      std::strcmp(extraction_id_.data(), extraction_id.c_str()) != 0) {
    return true;
  }
  return uptime_ms >= next_capture_ms_.load(std::memory_order_acquire) &&
         !terminal_sample_captured_.load(std::memory_order_acquire);
}

void ExtractionTelemetryBuffer::set_notification(Notification notification,
                                                  void* context) {
  notification_context_.store(context, std::memory_order_release);
  notification_.store(notification, std::memory_order_release);
}

bool parse_extraction_telemetry_cursor(
    const std::string& query, ExtractionTelemetryCursor& cursor) {
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
    if (key == "bootId" && boot_id.empty()) {
      boot_id = value;
    } else if (key == "extractionId" && extraction_id.empty()) {
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

std::string serialize_extraction_telemetry_page(
    const std::string& device_id, const ExtractionTelemetryPage& page) {
  std::ostringstream output;
  output.imbue(std::locale::classic());
  output << std::setprecision(6) << "{\"version\":1,\"deviceId\":\""
         << device_id << "\",\"extractionId\":\""
         << page.extraction_id.data() << "\",\"bootId\":\""
         << page.boot_id.data() << "\",\"capturedAtUptimeMs\":"
         << page.captured_at_uptime_ms << ",\"selection\":";
  if (page.selection.kind == control::ExtractionSelectionKind::kManual) {
    output << "{\"kind\":\"manual\"}";
  } else {
    output << "{\"kind\":\"profile\",\"profileId\":\"profile-"
           << page.selection.profile_index + 1U
           << "\",\"profile\":{\"name\":\""
           << page.selection.profile.name.data()
           << "\",\"preInfusionSeconds\":"
           << static_cast<unsigned>(
                  page.selection.profile.pre_infusion_seconds)
           << ",\"soakSeconds\":"
           << static_cast<unsigned>(page.selection.profile.soak_seconds)
           << ",\"mainExtractionSeconds\":"
           << static_cast<unsigned>(
                  page.selection.profile.main_extraction_seconds)
           << "}}";
  }
  output << ",\"controlMode\":\""
         << (page.selection.kind == control::ExtractionSelectionKind::kManual
                 ? "manual"
                 : page.weighted ? "weight" : "timed")
         << "\",\"weightControl\":";
  if (page.weighted) {
    output << "{\"targetWeightDecigrams\":"
           << page.weight_control.target_decigrams
           << ",\"compensationDecigrams\":"
           << page.weight_control.compensation_decigrams << '}';
  } else {
    output << "null";
  }
  output << ",\"baselineWeightDecigrams\":";
  if (page.baseline_available) output << page.baseline_weight_decigrams;
  else output << "null";
  output << ",\"status\":\"" << status_name(page.status)
         << "\",\"outcome\":";
  if (page.status == ExtractionTelemetryStatus::kRunning) output << "null";
  else output << '"' << outcome_name(page.outcome) << '"';
  output << ",\"terminalWeight\":";
  if (page.weighted && page.status != ExtractionTelemetryStatus::kRunning) {
    output << "{\"extractionId\":\"" << page.extraction_id.data()
           << "\",\"targetWeightDecigrams\":"
           << page.weight_control.target_decigrams
           << ",\"compensationDecigrams\":"
           << page.weight_control.compensation_decigrams
           << ",\"cutoffWeightDecigrams\":"
           << page.weight_control.target_decigrams -
                  page.weight_control.compensation_decigrams
           << ",\"finalWeightDecigrams\":";
    if (page.terminal_weight_available) output << page.terminal_weight_decigrams;
    else output << "null";
    output << ",\"settled\":"
           << (page.terminal_weight_settled ? "true" : "false")
           << ",\"completionReason\":\""
           << completion_name(page.weight_completion_reason)
           << "\",\"fallbackOccurred\":"
           << (page.weight_fallback ? "true" : "false") << '}';
  } else {
    output << "null";
  }
  output << ",\"oldestSequence\":" << page.oldest_sequence
         << ",\"latestSequence\":" << page.latest_sequence
         << ",\"nextCursor\":{\"extractionId\":\""
         << page.extraction_id.data() << "\",\"bootId\":\""
         << page.boot_id.data() << "\",\"afterSequence\":"
         << page.next_sequence << "},\"hasMore\":"
         << (page.has_more ? "true" : "false") << ",\"continuity\":\""
         << continuity_name(page.continuity) << "\",\"samples\":[";
  for (std::size_t index = 0; index < page.sample_count; ++index) {
    if (index != 0U) output << ',';
    const auto& sample = page.samples[index];
    output << "{\"sequence\":" << sample.sequence
           << ",\"uptimeMs\":" << sample.uptime_ms
           << ",\"elapsedMs\":" << sample.elapsed_ms
           << ",\"extractionElapsedMs\":" << sample.extraction_elapsed_ms
           << ",\"phase\":\"" << phase_name(sample.flags)
           << "\",\"boilerTemperatureC\":"
           << static_cast<double>(sample.temperature_quarters_c) / 4.0
           << ",\"activeTargetC\":"
           << static_cast<unsigned>(sample.active_target_c)
           << ",\"heaterActive\":"
           << ((sample.flags & kHeaterActive) ? "true" : "false")
           << ",\"pumpCommand\":\""
           << ((sample.flags & kPumpRunning) ? "running" : "off")
           << "\",\"scaleAvailability\":\""
           << availability_name(sample.flags)
           << "\",\"netWeightDecigrams\":";
    if (sample.flags & kWeightAvailable) output << sample.net_weight_decigrams;
    else output << "null";
    output << '}';
  }
  output << "]}";
  auto serialized = output.str();
  if (serialized.size() > kExtractionTelemetrySerializedPageLimit) return {};
  return serialized;
}

}  // namespace philcoino::networking
