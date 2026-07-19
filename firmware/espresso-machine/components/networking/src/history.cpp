#include "philcoino/history.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <iomanip>
#include <limits>
#include <locale>
#include <sstream>

namespace philcoino::networking {
namespace {

constexpr std::uint16_t kSteamMode = 1U << 0U;
constexpr std::uint16_t kHeaterEnabled = 1U << 1U;
constexpr std::uint16_t kHeaterActive = 1U << 2U;
constexpr std::uint16_t kPumpActive = 1U << 3U;
constexpr unsigned kStatusShift = 4U;
constexpr unsigned kFaultShift = 6U;

bool valid_boot_id(const std::string& value) {
  return value.size() == 32U &&
         std::all_of(value.begin(), value.end(), [](char c) {
           return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f');
         });
}

std::uint16_t status_bits(control::ControlStatus status) {
  switch (status) {
    case control::ControlStatus::kHeating: return 0U;
    case control::ControlStatus::kReady: return 1U;
    case control::ControlStatus::kFault: return 2U;
  }
  return 2U;
}

std::uint16_t fault_bits(bool active, control::FaultCode code) {
  if (!active) return 0U;
  switch (code) {
    case control::FaultCode::kSensorFailure: return 1U;
    case control::FaultCode::kOverTemperature: return 2U;
    case control::FaultCode::kHeatingTimeout: return 3U;
    case control::FaultCode::kInternalError: return 4U;
  }
  return 4U;
}

const char* status_name(std::uint16_t flags) {
  switch ((flags >> kStatusShift) & 0x3U) {
    case 0U: return "heating";
    case 1U: return "ready";
    default: return "fault";
  }
}

const char* fault_name(std::uint16_t flags) {
  switch ((flags >> kFaultShift) & 0x7U) {
    case 1U: return "sensor_failure";
    case 2U: return "over_temperature";
    case 3U: return "heating_timeout";
    case 4U: return "internal_error";
    default: return nullptr;
  }
}

const char* continuity_name(HistoryContinuity continuity) {
  switch (continuity) {
    case HistoryContinuity::kInitial: return "initial";
    case HistoryContinuity::kContinuous: return "continuous";
    case HistoryContinuity::kTruncated: return "truncated";
    case HistoryContinuity::kReset: return "reset";
  }
  return "reset";
}

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

}  // namespace

HistoryBuffer::HistoryBuffer(const std::string& boot_id) {
  if (!valid_boot_id(boot_id)) return;
  std::copy(boot_id.begin(), boot_id.end(), boot_id_.begin());
}

bool HistoryBuffer::record(std::uint64_t uptime_ms,
                           const control::ControlSnapshot& snapshot,
                           peripherals::PumpCommand pump_command) {
  if (uptime_ms < next_capture_ms_) return false;
  FlagGuard guard(lock_);
  if (!guard.acquired()) return false;

  HistorySample sample{};
  sample.uptime_ms = uptime_ms;
  const auto quarters = std::lround(
      static_cast<double>(snapshot.boiler_temperature.temperature_c) * 4.0);
  sample.temperature_quarters_c = static_cast<std::int16_t>(std::clamp<long>(
      quarters, std::numeric_limits<std::int16_t>::min(),
      std::numeric_limits<std::int16_t>::max()));
  sample.brew_target_c = static_cast<std::uint8_t>(snapshot.targets.brew_c);
  sample.steam_target_c = static_cast<std::uint8_t>(snapshot.targets.steam_c);
  sample.flags =
      (snapshot.mode == control::ControlMode::kSteam ? kSteamMode : 0U) |
      (snapshot.heater_enabled_permission ? kHeaterEnabled : 0U) |
      (snapshot.heater_enabled ? kHeaterActive : 0U) |
      (pump_command == peripherals::PumpCommand::kRunning ? kPumpActive : 0U) |
      static_cast<std::uint16_t>(status_bits(snapshot.status) << kStatusShift) |
      static_cast<std::uint16_t>(
          fault_bits(snapshot.fault_active, snapshot.fault.code) << kFaultShift);

  const std::size_t index = (start_ + count_) % kHistoryCapacity;
  if (count_ == kHistoryCapacity) {
    samples_[start_] = sample;
    start_ = (start_ + 1U) % kHistoryCapacity;
  } else {
    samples_[index] = sample;
    ++count_;
  }
  ++latest_sequence_;
  next_capture_ms_ = uptime_ms + 1000U;
  return true;
}

bool HistoryBuffer::page(const HistoryCursor& cursor,
                         std::uint64_t captured_at_uptime_ms,
                         HistoryPage& output) {
  FlagGuard guard(lock_);
  if (!guard.acquired()) return false;
  output = {};
  output.boot_id = boot_id_;
  output.captured_at_uptime_ms = captured_at_uptime_ms;
  output.empty = count_ == 0U;
  output.oldest_sequence = count_ == 0U ? 0U : latest_sequence_ - count_ + 1U;
  output.latest_sequence = latest_sequence_;

  std::uint64_t after = cursor.after_sequence;
  if (!cursor.supplied) {
    output.continuity = HistoryContinuity::kInitial;
    after = output.empty ? 0U : output.oldest_sequence - 1U;
  } else if (cursor.boot_id != boot_id_) {
    output.continuity = HistoryContinuity::kReset;
    after = output.empty ? 0U : output.oldest_sequence - 1U;
  } else if (after > output.latest_sequence) {
    return false;
  } else if (!output.empty && after + 1U < output.oldest_sequence) {
    output.continuity = HistoryContinuity::kTruncated;
    after = output.oldest_sequence - 1U;
  } else {
    output.continuity = HistoryContinuity::kContinuous;
  }

  output.first_sequence = after + 1U;
  const auto available = output.latest_sequence > after
                             ? output.latest_sequence - after
                             : 0U;
  output.sample_count = static_cast<std::size_t>(
      std::min<std::uint64_t>(available, kHistoryPageSize));
  for (std::size_t i = 0; i < output.sample_count; ++i) {
    const auto sequence = output.first_sequence + i;
    const auto offset = static_cast<std::size_t>(sequence - output.oldest_sequence);
    output.samples[i] = samples_[(start_ + offset) % kHistoryCapacity];
  }
  output.next_sequence = output.sample_count == 0U
                             ? after
                             : output.first_sequence + output.sample_count - 1U;
  output.has_more = output.next_sequence < output.latest_sequence;
  return true;
}

bool parse_history_cursor(const std::string& query, HistoryCursor& cursor) {
  cursor = {};
  if (query.empty()) return true;
  std::string boot_id;
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
    else if (key == "afterSequence" && sequence.empty()) sequence = value;
    else return false;
    ++fields;
    if (end == std::string::npos) break;
    position = end + 1U;
  }
  if (fields != 2U || !valid_boot_id(boot_id) || sequence.empty()) return false;
  std::uint64_t parsed = 0;
  for (char c : sequence) {
    if (c < '0' || c > '9') return false;
    const auto digit = static_cast<std::uint64_t>(c - '0');
    if (parsed > (9007199254740991ULL - digit) / 10ULL) return false;
    parsed = parsed * 10ULL + digit;
  }
  cursor.supplied = true;
  std::copy(boot_id.begin(), boot_id.end(), cursor.boot_id.begin());
  cursor.after_sequence = parsed;
  return true;
}

std::string serialize_history_page(const std::string& device_id,
                                   const HistoryPage& page) {
  std::ostringstream output;
  output.imbue(std::locale::classic());
  output << std::setprecision(6) << "{\"deviceId\":\"" << device_id
         << "\",\"bootId\":\"" << page.boot_id.data()
         << "\",\"capturedAtUptimeMs\":" << page.captured_at_uptime_ms
         << ",\"oldestSequence\":";
  if (page.empty) output << "null"; else output << page.oldest_sequence;
  output << ",\"latestSequence\":";
  if (page.empty) output << "null"; else output << page.latest_sequence;
  output << ",\"nextCursor\":{\"bootId\":\"" << page.boot_id.data()
         << "\",\"afterSequence\":" << page.next_sequence
         << "},\"hasMore\":" << (page.has_more ? "true" : "false")
         << ",\"continuity\":\"" << continuity_name(page.continuity)
         << "\",\"samples\":[";
  for (std::size_t i = 0; i < page.sample_count; ++i) {
    if (i != 0U) output << ',';
    const auto& sample = page.samples[i];
    const auto flags = sample.flags;
    output << "{\"sequence\":" << page.first_sequence + i
           << ",\"uptimeMs\":" << sample.uptime_ms
           << ",\"boilerTemperatureC\":"
           << static_cast<double>(sample.temperature_quarters_c) / 4.0
           << ",\"brewTargetC\":" << static_cast<unsigned>(sample.brew_target_c)
           << ",\"steamTargetC\":" << static_cast<unsigned>(sample.steam_target_c)
           << ",\"activeMode\":\"" << ((flags & kSteamMode) ? "steam" : "brew")
           << "\",\"heaterEnabled\":" << ((flags & kHeaterEnabled) ? "true" : "false")
           << ",\"heaterActive\":" << ((flags & kHeaterActive) ? "true" : "false")
           << ",\"pumpActive\":" << ((flags & kPumpActive) ? "true" : "false")
           << ",\"machineStatus\":\"" << status_name(flags)
           << "\",\"faultCode\":";
    const auto* fault = fault_name(flags);
    if (fault == nullptr) output << "null"; else output << '\"' << fault << '\"';
    output << '}';
  }
  output << "]}";
  return output.str();
}

}  // namespace philcoino::networking
