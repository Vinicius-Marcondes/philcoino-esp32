#include <cassert>
#include <iostream>

#include "philcoino/brew_pi.hpp"
#include "philcoino/control.hpp"
#include "philcoino/history.hpp"

int main() {
  using philcoino::control::BrewPiController;
  using philcoino::control::ControlSnapshot;
  using philcoino::networking::HistoryBuffer;
  using philcoino::networking::HistoryPage;
  using philcoino::networking::HistorySample;

  assert(sizeof(HistorySample) <= 48U);
  assert(sizeof(HistoryBuffer) <= 40U * 1024U);
  assert(sizeof(HistoryPage) <= 2U * 1024U);

  std::cout << "HistorySample=" << sizeof(HistorySample)
            << " HistoryBuffer=" << sizeof(HistoryBuffer)
            << " HistoryPage=" << sizeof(HistoryPage)
            << " ControlSnapshot=" << sizeof(ControlSnapshot)
            << " BrewPiController=" << sizeof(BrewPiController) << '\n';
  return 0;
}
