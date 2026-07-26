# PERF-011 — Ghost-feature call-graph evidence

Date: 2026-07-26

## Removed production-unreachable helpers

Repository-wide production caller searches found no callers for:

- `TemperatureController::update_targets`
- `TemperatureController::update_brew_target`
- `TemperatureController::update_steam_target`
- `ExtractionController::replace_profiles`
- `ReplaceProfilesResult`

Their only callers were host tests. These helpers owned storage writes inside
the control layer and predated the production transaction flow. Production
target updates use `prepare_target_update`, perform `TargetStorage::save`
outside the workflow mutex, then adopt or roll back. Production profile
replacement validates and saves through `FirmwareApi`, then calls
`adopt_persisted_profiles`.

The obsolete helpers and enum were deleted. Focused tests now exercise the
same explicit transaction stages used by production; persistence failure and
profile replacement orchestration remain covered by firmware API tests.

## Retained reachable behavior

Positive production reachability was confirmed for:

- profiles: startup NVS load, API replacement/adoption, and extraction snapshot;
- ten-minute history: `HistoryBuffer` construction, temperature-loop record,
  and API paging;
- scale/weighted extraction: HX711 sampling task, `ScaleController`, API, and
  extraction control;
- passive prediction: `TemperatureController` monitor/update/diagnostics and
  API/history serialization.

Firmware still constructs exactly one `EspMax6675Transport` and one `Max6675`
from the GPIO4/GPIO5/GPIO7 configuration. No dual-sensor runtime was found.
The documented risk of a plausible but wrong single-sensor reading remains.

## Verification

- Native host build and CTest: 7/7 passed.
- ASan/UBSan host build and CTest: 7/7 passed.
- Firmware contract generation and validation: 32 captures passed.
- Removed-symbol source search: no active production/test matches.

No public API, wire schema, controller safety deadline, heater lease, profile,
history, scale, or prediction behavior changed.
