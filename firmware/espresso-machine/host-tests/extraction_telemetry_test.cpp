#include <cassert>
#include <cstdint>
#include <string>

#include "philcoino/extraction_telemetry.hpp"

namespace {

using namespace philcoino::control;
using namespace philcoino::networking;
using namespace philcoino::peripherals;

ControlSnapshot machine() {
  ControlSnapshot value{};
  value.targets.brew_c = 93;
  value.boiler_temperature = {ThermocoupleStatus::kOk, 92.75F};
  value.heater_enabled = true;
  return value;
}

ScaleSnapshot scale(std::int32_t weight = 800) {
  ScaleSnapshot value{};
  value.availability = ScaleAvailability::kReady;
  value.calibration_status = ScaleCalibrationStatus::kCalibrated;
  value.stable = true;
  value.gross_weight_available = true;
  value.gross_weight_decigrams = weight;
  return value;
}

ExtractionSnapshot running(const char* id, ExtractionSelection selection,
                           std::uint32_t elapsed_ms) {
  return {ExtractionStatus::kRunning, id, selection,
          selection.kind == ExtractionSelectionKind::kManual
              ? ExtractionPhase::kManual
              : ExtractionPhase::kMainExtraction,
          elapsed_ms, 60'000U - elapsed_ms, PumpCommand::kRunning,
          ExtractionOutcome::kNone};
}

struct ContentionContext {
  ExtractionTelemetryBuffer* buffer;
  ControlSnapshot machine;
  ExtractionSnapshot extraction;
  ScaleSnapshot scale;
  WeightExtractionSnapshot weight;
  bool attempted{false};
};

void attempt_capture_while_locked(void* opaque) {
  auto* context = static_cast<ContentionContext*>(opaque);
  if (context->attempted) return;
  context->attempted = true;
  context->extraction.elapsed_ms = 250U;
  assert(!context->buffer->record(250U, context->machine,
                                  context->extraction, context->scale,
                                  context->weight));
}

void test_all_modes_and_cursor_replay() {
  ExtractionTelemetryBuffer buffer{"00112233445566778899aabbccddeeff"};
  WeightExtractionSnapshot no_weight{};
  auto manual = running("run-1", {ExtractionSelectionKind::kManual, 0U}, 0U);
  assert(buffer.record(1000U, machine(), manual, scale(), no_weight));
  manual.elapsed_ms = 250U;
  assert(buffer.record(1250U, machine(), manual, scale(825), no_weight));

  ExtractionTelemetryPage page{};
  assert(buffer.page({}, 1250U, page));
  assert(page.sample_count == 2U);
  assert(page.selection.kind == ExtractionSelectionKind::kManual);
  assert(page.baseline_available);
  assert(page.samples[1].net_weight_decigrams == 25);
  const auto json = serialize_extraction_telemetry_page("device-1", page);
  assert(json.find("\"controlMode\":\"manual\"") != std::string::npos);
  assert(json.find("\"heaterActive\":true") != std::string::npos);
  assert(json.find("\"netWeightDecigrams\":25") != std::string::npos);

  ExtractionTelemetryCursor cursor{};
  assert(parse_extraction_telemetry_cursor(
      "extractionId=run-1&bootId=00112233445566778899aabbccddeeff&afterSequence=1",
      cursor));
  assert(buffer.page(cursor, 1250U, page));
  assert(page.continuity == ExtractionTelemetryContinuity::kContinuous);
  assert(page.sample_count == 1U);
  assert(buffer.cursor_available(cursor));
  cursor.after_sequence = 3U;
  assert(!buffer.cursor_available(cursor));
  assert(!parse_extraction_telemetry_cursor("extractionId=run-1", cursor));

  ExtractionTelemetryBuffer weighted{"00112233445566778899aabbccddeeff"};
  auto profile = running("run-2", {ExtractionSelectionKind::kProfile, 0U}, 0U);
  WeightExtractionSnapshot weight{};
  weight.active = true;
  weight.extraction_id = "run-2";
  weight.control = {350, 20};
  weight.cutoff_decigrams = 330;
  weight.net_weight_available = true;
  weight.net_weight_decigrams = 0;
  assert(weighted.record(2000U, machine(), profile, scale(700), weight));
  assert(weighted.page({}, 2000U, page));
  assert(page.weighted);
  assert(page.baseline_weight_decigrams == 700);
  assert(serialize_extraction_telemetry_page("device-1", page).find(
             "\"controlMode\":\"weight\"") != std::string::npos);
}

void test_full_settling_tail_and_fixed_retention() {
  ExtractionTelemetryBuffer buffer{"00112233445566778899aabbccddeeff"};
  WeightExtractionSnapshot weight{};
  auto extraction =
      running("run-tail", {ExtractionSelectionKind::kManual, 0U}, 60'000U);
  assert(buffer.record(0U, machine(), extraction, scale(), weight));
  extraction.status = ExtractionStatus::kIdle;
  extraction.phase = ExtractionPhase::kIdle;
  extraction.pump_command = PumpCommand::kOff;
  extraction.outcome = ExtractionOutcome::kCompleted;
  assert(buffer.record(250U, machine(), extraction, scale(), weight));
  for (std::uint32_t now = 500U; now <= 10'250U; now += 250U) {
    assert(buffer.record(now, machine(), extraction, scale(), weight));
  }
  ExtractionTelemetryPage page{};
  assert(buffer.page({}, 10'250U, page));
  assert(page.status == ExtractionTelemetryStatus::kTerminal);
  assert(page.samples[0].sequence == 1U);

  ExtractionTelemetryBuffer retained{"00112233445566778899aabbccddeeff"};
  extraction = running("run-long", {ExtractionSelectionKind::kManual, 0U}, 0U);
  for (std::uint32_t index = 0; index < 330U; ++index) {
    extraction.elapsed_ms = index * kExtractionTelemetryIntervalMs;
    assert(retained.record(extraction.elapsed_ms, machine(), extraction,
                           scale(), weight));
  }
  assert(retained.page({}, extraction.elapsed_ms, page));
  assert(page.oldest_sequence == 11U);
  assert(page.latest_sequence == 330U);
  assert(page.sample_count == kExtractionTelemetryPageSize);
  assert(page.has_more);
  const auto json = serialize_extraction_telemetry_page("device-1", page);
  assert(!json.empty());
  assert(json.size() <= kExtractionTelemetrySerializedPageLimit);
}

void test_zero_wait_contention_and_wrap_safe_uptime() {
  ExtractionTelemetryBuffer buffer{"00112233445566778899aabbccddeeff"};
  ContentionContext contention{
      &buffer,
      machine(),
      running("run-gap", {ExtractionSelectionKind::kManual, 0U}, 0U),
      scale(),
      {},
  };
  buffer.set_notification(attempt_capture_while_locked, &contention);
  assert(buffer.record(0U, contention.machine, contention.extraction,
                       contention.scale, contention.weight));
  buffer.set_notification(nullptr, nullptr);
  contention.extraction.elapsed_ms = 500U;
  assert(buffer.record(500U, contention.machine, contention.extraction,
                       contention.scale, contention.weight));
  ExtractionTelemetryPage page{};
  assert(buffer.page({}, 500U, page));
  assert(page.sample_count == 2U);
  assert(page.samples[0].sequence == 1U);
  assert(page.samples[1].sequence == 3U);

  ExtractionTelemetryBuffer wrap{"00112233445566778899aabbccddeeff"};
  auto extraction =
      running("run-wrap", {ExtractionSelectionKind::kManual, 0U}, 0U);
  WeightExtractionSnapshot weight{};
  constexpr std::uint64_t before_wrap = UINT32_MAX - 100ULL;
  assert(wrap.record(before_wrap, machine(), extraction, scale(), weight));
  extraction.elapsed_ms = 100U;
  assert(!wrap.record(before_wrap + 100U, machine(), extraction, scale(), weight));
  extraction.elapsed_ms = 250U;
  assert(wrap.record(before_wrap + 250U, machine(), extraction, scale(), weight));
}

}  // namespace

int main() {
  test_all_modes_and_cursor_replay();
  test_full_settling_tail_and_fixed_retention();
  test_zero_wait_contention_and_wrap_safe_uptime();
  return 0;
}
