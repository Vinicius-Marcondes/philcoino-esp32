#include <array>
#include <cassert>
#include <cstdint>
#include <string>
#include <type_traits>

#include "philcoino/config.hpp"
#include "philcoino/performance_diagnostics.hpp"

int main() {
  using namespace philcoino::config;

  assert(std::string(kFirmwareVersion) == "0.3.3");
  const std::array<std::uint8_t, 6> mac{0xAA, 0xBB, 0xCC, 0x01, 0x02, 0xAF};
  assert(stable_device_id(mac) == std::string("philcoino-0102AF"));

  static_assert(kBrewTargetMinimumC < kBrewTargetMaximumC);
  static_assert(kSteamTargetMinimumC <= kSteamTargetMaximumC);
  static_assert(kSteamTemperatureOffsetC == 5);
  static_assert(kPreInfusionHeaterDutyOffsetC == 0);
  static_assert(kExtractionHeaterDutyOffsetC == 2);
  static_assert(kBrewOverTemperatureC > kBrewTargetMaximumC);
  static_assert(kSteamOverTemperatureC > kSteamTargetMaximumC);
  static_assert(kHeatingTimeoutMs == 600000U);
  static_assert(kSteamReadyTimeoutMs == 300000U);
  static_assert(kHeaterControlWindowMs == 10000U);
  static_assert(kMinimumHeaterPulseMs == 500U);
  static_assert(kMinimumHeaterPulseMs < kHeaterControlWindowMs);
  static_assert(kHeaterSafetyLeaseMs == 1500U);
  static_assert(kHeaterSafetyLeaseMs < kHeaterControlWindowMs);
  static_assert(kCooldownPumpLimitMs == 45000U);
  static_assert(kCooldownStabilizationMs == 5000U);
  static_assert(kWifiMaximumTxPowerQuarterDbm == 44);
  static_assert(kWifiMaximumTxPowerQuarterDbm >= 8);
  static_assert(kWifiMaximumTxPowerQuarterDbm <= 84);
  static_assert(kBrewHeatRampMinimumTargetBandC >
                static_cast<float>(kReadyBandC));
  static_assert(kBrewHeatRampMinimumTargetBandC < kBrewHeatRampBandC);
  static_assert(kBrewHeatRampBandC > static_cast<float>(kReadyBandC));
  static_assert(kSteamHeatRampBandC > kBrewHeatRampBandC);
  static_assert(kBrewRecoveryTriggerDropC >= static_cast<float>(kReadyBandC));
  static_assert(kSteamRecoveryTriggerDropC > kBrewRecoveryTriggerDropC);
  static_assert(kBrewRecoveryHeatRampBandC < kBrewHeatRampBandC);
  static_assert(kSteamRecoveryHeatRampBandC < kSteamHeatRampBandC);
  static_assert(std::is_same_v<decltype(kOledEnabled), const bool>);
  static_assert(
      std::is_same_v<decltype(kTemperatureReadingLoggingEnabled), const bool>);
  static_assert(!kTemperatureReadingLoggingEnabled);
  static_assert(!kPerformanceDiagnosticsEnabled);
  static_assert(kOledI2cAddress == 0x3C);
  static_assert(kBoilerThermocoupleChipSelectGpio == 7);
  static_assert(kBoilerThermocoupleDataGpio == 5);
  static_assert(kBoilerThermocoupleClockGpio == 4);
  static_assert(kSsrActiveHigh);
  static_assert(kPumpGpio == 10);
  static_assert(kPumpActiveHigh);
  static_assert(kPumpGpio != kSsrGpio);
  static_assert(kPumpGpio != kBoilerThermocoupleChipSelectGpio);
  static_assert(kPumpGpio != kBoilerThermocoupleClockGpio);
  static_assert(kPumpGpio != kBoilerThermocoupleDataGpio);

  using namespace philcoino::diagnostics;
  static_assert(fixed_period_lateness_ticks(1000U, 1000U) == 0U);
  static_assert(fixed_period_lateness_ticks(999U, 1000U) == 0U);
  static_assert(fixed_period_lateness_ticks(1025U, 1000U) == 25U);
  static_assert(fixed_period_lateness_ticks(0x00000020U, 0xFFFFFFF0U) ==
                48U);
  static_assert(fixed_period_catch_up_deadline(1000U, 1000U, 500U) ==
                1000U);
  static_assert(fixed_period_catch_up_deadline(1000U, 1249U, 500U) ==
                1000U);
  static_assert(fixed_period_catch_up_deadline(1000U, 1500U, 500U) ==
                1500U);
  static_assert(fixed_period_catch_up_deadline(1000U, 2250U, 500U) ==
                2000U);
  static_assert(fixed_period_catch_up_deadline(
                    0xFFFFFFF0U, 0x00000410U, 0x00000200U) ==
                0x000003F0U);
  PerformanceDiagnostics diagnostics;
  diagnostics.record(DurationMetric::kWorkflowMutexWaitUs, 9U);
  diagnostics.record(DurationMetric::kWorkflowMutexWaitUs, 250U);
  diagnostics.record(DurationMetric::kWorkflowMutexWaitUs, 5001U);
  diagnostics.increment(EventCounter::kWorkflowMutexAcquired);
  diagnostics.increment(EventCounter::kWorkflowMutexAcquired);
  diagnostics.observe_stack_free(StackRole::kWorkflow, 2048U);
  diagnostics.observe_stack_free(StackRole::kWorkflow, 2304U);
  diagnostics.observe_stack_free(StackRole::kWorkflow, 1536U);

  const auto performance = diagnostics.snapshot();
  const auto wait_index =
      static_cast<std::size_t>(DurationMetric::kWorkflowMutexWaitUs);
  assert(performance.durations[wait_index].count == 3U);
  assert(performance.durations[wait_index].maximum == 5001U);
  assert(performance.durations[wait_index].buckets[0] == 1U);
  assert(performance.durations[wait_index].buckets[3] == 1U);
  assert(performance.durations[wait_index]
             .buckets[kHistogramBucketCount - 1U] == 1U);
  assert(performance.counters[static_cast<std::size_t>(
             EventCounter::kWorkflowMutexAcquired)] == 2U);
  assert(performance.minimum_stack_free_bytes[
             static_cast<std::size_t>(StackRole::kWorkflow)] == 1536U);
  assert(performance.minimum_stack_free_bytes[
             static_cast<std::size_t>(StackRole::kHttp)] == 0U);

  return 0;
}
