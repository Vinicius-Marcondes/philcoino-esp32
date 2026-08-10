#include <cassert>
#include <iostream>

#include "philcoino/brew_pi.hpp"
#include "philcoino/control.hpp"
#include "philcoino/extraction_telemetry.hpp"

int main() {
  using philcoino::control::BrewPiController;
  using philcoino::control::ControlSnapshot;
  using philcoino::networking::ExtractionTelemetryBuffer;
  using philcoino::networking::ExtractionTelemetryPage;
  using philcoino::networking::ExtractionTelemetrySample;

  assert(sizeof(ExtractionTelemetrySample) <= 40U);
  assert(sizeof(ExtractionTelemetryBuffer) <= 16U * 1024U);
  assert(sizeof(ExtractionTelemetryPage) <= 2U * 1024U);

  std::cout << "ControlSnapshot=" << sizeof(ControlSnapshot)
            << " BrewPiController=" << sizeof(BrewPiController) << '\n';
  return 0;
}
