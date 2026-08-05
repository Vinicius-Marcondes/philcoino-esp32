#include <cassert>
#include <iostream>

#include "philcoino/brew_pi.hpp"
#include "philcoino/control.hpp"
#include "philcoino/history.hpp"
#include "philcoino/extraction_telemetry.hpp"

int main() {
  using philcoino::control::BrewPiController;
  using philcoino::control::ControlSnapshot;
  using philcoino::networking::HistoryBuffer;
  using philcoino::networking::HistoryPage;
  using philcoino::networking::HistorySample;
  using philcoino::networking::ExtractionTelemetryBuffer;
  using philcoino::networking::ExtractionTelemetryPage;
  using philcoino::networking::ExtractionTelemetrySample;

  assert(sizeof(HistorySample) <= 48U);
  assert(sizeof(HistoryBuffer) <= 40U * 1024U);
  assert(sizeof(HistoryPage) <= 2U * 1024U);
  assert(sizeof(ExtractionTelemetrySample) <= 40U);
  assert(sizeof(ExtractionTelemetryBuffer) <= 16U * 1024U);
  assert(sizeof(ExtractionTelemetryPage) <= 2U * 1024U);

  std::cout << "HistorySample=" << sizeof(HistorySample)
            << " HistoryBuffer=" << sizeof(HistoryBuffer)
            << " HistoryPage=" << sizeof(HistoryPage)
            << " ControlSnapshot=" << sizeof(ControlSnapshot)
            << " BrewPiController=" << sizeof(BrewPiController) << '\n';
  return 0;
}
