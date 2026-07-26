#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <limits>

namespace philcoino::diagnostics {

constexpr std::uint32_t fixed_period_lateness_ticks(
    std::uint32_t current_tick, std::uint32_t deadline_tick) {
  const auto lateness =
      static_cast<std::int32_t>(current_tick - deadline_tick);
  return lateness > 0 ? static_cast<std::uint32_t>(lateness) : 0U;
}

constexpr std::uint32_t fixed_period_catch_up_deadline(
    std::uint32_t deadline_tick, std::uint32_t current_tick,
    std::uint32_t period_ticks) {
  const auto lateness =
      fixed_period_lateness_ticks(current_tick, deadline_tick);
  return period_ticks == 0U
             ? deadline_tick
             : deadline_tick + (lateness / period_ticks) * period_ticks;
}

enum class DurationMetric : std::size_t {
  kWorkflowPeriodDeviationUs,
  kWorkflowWorkUs,
  kScalePeriodDeviationUs,
  kScaleWorkUs,
  kTemperaturePeriodDeviationUs,
  kTemperatureWorkUs,
  kWorkflowMutexWaitUs,
  kWorkflowMutexHoldUs,
  kApiLatencyUs,
  kApiHeapDecreaseBytes,
  kApiNewMinimumHeapDropBytes,
  kCount,
};

enum class EventCounter : std::size_t {
  kWorkflowMutexAcquired,
  kWorkflowMutexTimeout,
  kWorkflowDeadlineMiss,
  kScaleAcceptedSample,
  kScaleNotReady,
  kApiRequest,
  kHeaterLeaseTripObserved,
  kCount,
};

enum class StackRole : std::size_t {
  kTemperature,
  kWorkflow,
  kScale,
  kHttp,
  kDiagnostics,
  kCount,
};

inline constexpr std::array<std::uint32_t, 7> kHistogramUpperBounds{
    10U, 50U, 100U, 250U, 500U, 1000U, 5000U};
inline constexpr std::size_t kHistogramBucketCount =
    kHistogramUpperBounds.size() + 1U;

struct DurationSnapshot {
  std::uint32_t count{0};
  std::uint32_t maximum{0};
  std::array<std::uint32_t, kHistogramBucketCount> buckets{};
};

struct PerformanceSnapshot {
  std::array<DurationSnapshot,
             static_cast<std::size_t>(DurationMetric::kCount)>
      durations{};
  std::array<std::uint32_t, static_cast<std::size_t>(EventCounter::kCount)>
      counters{};
  std::array<std::uint32_t, static_cast<std::size_t>(StackRole::kCount)>
      minimum_stack_free_bytes{};
};

class PerformanceDiagnostics {
 public:
  PerformanceDiagnostics() {
    for (auto& measurement : durations_) {
      measurement.count.store(0U, std::memory_order_relaxed);
      measurement.maximum.store(0U, std::memory_order_relaxed);
      for (auto& bucket : measurement.buckets) {
        bucket.store(0U, std::memory_order_relaxed);
      }
    }
    for (auto& value : counters_) {
      value.store(0U, std::memory_order_relaxed);
    }
    for (auto& value : minimum_stack_free_bytes_) {
      value.store(std::numeric_limits<std::uint32_t>::max(),
                  std::memory_order_relaxed);
    }
  }

  void record(DurationMetric metric, std::uint32_t value) {
    auto& measurement = durations_[static_cast<std::size_t>(metric)];
    measurement.count.fetch_add(1U, std::memory_order_relaxed);
    auto maximum = measurement.maximum.load(std::memory_order_relaxed);
    while (maximum < value &&
           !measurement.maximum.compare_exchange_weak(
               maximum, value, std::memory_order_relaxed,
               std::memory_order_relaxed)) {
    }
    measurement.buckets[bucket_for(value)].fetch_add(
        1U, std::memory_order_relaxed);
  }

  void increment(EventCounter counter) {
    counters_[static_cast<std::size_t>(counter)].fetch_add(
        1U, std::memory_order_relaxed);
  }

  void observe_stack_free(StackRole role, std::uint32_t bytes) {
    auto& minimum = minimum_stack_free_bytes_[static_cast<std::size_t>(role)];
    auto current = minimum.load(std::memory_order_relaxed);
    while (current > bytes &&
           !minimum.compare_exchange_weak(current, bytes,
                                          std::memory_order_relaxed,
                                          std::memory_order_relaxed)) {
    }
  }

  PerformanceSnapshot snapshot() const {
    PerformanceSnapshot value{};
    for (std::size_t index = 0; index < durations_.size(); ++index) {
      value.durations[index].count =
          durations_[index].count.load(std::memory_order_relaxed);
      value.durations[index].maximum =
          durations_[index].maximum.load(std::memory_order_relaxed);
      for (std::size_t bucket = 0; bucket < kHistogramBucketCount; ++bucket) {
        value.durations[index].buckets[bucket] =
            durations_[index].buckets[bucket].load(std::memory_order_relaxed);
      }
    }
    for (std::size_t index = 0; index < counters_.size(); ++index) {
      value.counters[index] =
          counters_[index].load(std::memory_order_relaxed);
    }
    for (std::size_t index = 0; index < minimum_stack_free_bytes_.size();
         ++index) {
      const auto minimum =
          minimum_stack_free_bytes_[index].load(std::memory_order_relaxed);
      value.minimum_stack_free_bytes[index] =
          minimum == std::numeric_limits<std::uint32_t>::max() ? 0U : minimum;
    }
    return value;
  }

 private:
  struct AtomicDuration {
    std::atomic<std::uint32_t> count{0};
    std::atomic<std::uint32_t> maximum{0};
    std::array<std::atomic<std::uint32_t>, kHistogramBucketCount> buckets{};
  };

  static std::size_t bucket_for(std::uint32_t value) {
    for (std::size_t index = 0; index < kHistogramUpperBounds.size(); ++index) {
      if (value <= kHistogramUpperBounds[index]) return index;
    }
    return kHistogramBucketCount - 1U;
  }

  std::array<AtomicDuration,
             static_cast<std::size_t>(DurationMetric::kCount)>
      durations_{};
  std::array<std::atomic<std::uint32_t>,
             static_cast<std::size_t>(EventCounter::kCount)>
      counters_{};
  std::array<std::atomic<std::uint32_t>,
             static_cast<std::size_t>(StackRole::kCount)>
      minimum_stack_free_bytes_{};
};

static_assert(sizeof(PerformanceDiagnostics) <= 512U);

}  // namespace philcoino::diagnostics
