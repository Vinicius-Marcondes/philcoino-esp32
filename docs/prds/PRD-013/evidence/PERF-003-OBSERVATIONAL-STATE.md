# PERF-003 observational state evidence

Date: 2026-07-26

## Behavior

API v2 state reads now copy the current machine, extraction, and cooldown
snapshots without advancing extraction, cooldown, scale settling, or
temperature-controller phase. Repeating a state read at the same timestamp
returns the same response and does not change pump state or extraction
compensation.

The dedicated workflow task remains the sole periodic advancement owner. It
also publishes the extraction phase on every workflow iteration, using Idle
while cooldown is active, so an extraction-to-cooldown handoff cannot retain a
stale extraction compensation phase in the absence of GET traffic.

Command routes retain ownership of their requested start/stop transitions; they
do not perform periodic workflow advancement.

## Compatibility and safety

- API v1/v2 routes, authentication, status codes, and public response schemas
  are unchanged.
- Firmware remains authoritative for extraction, cooldown, temperature phase,
  heater permission, pump commands, faults, and fail-off behavior.
- No timeout, heater lease, profile, history, prediction, NVS, or flash behavior
  changed.
- No physical or energized safety validation is inferred.

## Verification

- PASS — focused native firmware API regression.
- PASS — focused ASan/UBSan firmware API regression.
- PASS — complete native firmware host suite: 7/7.
- PASS — complete ASan/UBSan firmware host suite: 7/7.
- PASS — 32 generated firmware contract captures validated against the
  unchanged protocol contract.
- NOT RUN — ESP-IDF 6.0.2 target build; the pinned toolchain remains
  unavailable (`idf.py` absent and `IDF_PATH` unset).
