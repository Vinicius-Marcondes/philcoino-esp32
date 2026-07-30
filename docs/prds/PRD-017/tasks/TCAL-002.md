# TCAL-002 — Persist and apply the global firmware offset

Status: Done
Review Mode: Agent
Review Reason: Pure storage/control policies, host tests, sanitizer runs, and
contract captures deterministically cover the offset and fail-off boundaries.

## Goal

Replace the fixed Steam-only correction with one persisted signed offset used
exactly once by Brew and Steam, while enforcing independent effective and raw
temperature safety limits.

## Scope

- Add a dedicated firmware calibration NVS blob and host-testable storage
  policy separate from scale calibration and temperature targets.
- Distinguish missing calibration (`0°C`, uncalibrated), explicitly saved
  `0°C` (calibrated), corrupt data, and backend failure.
- Remove `kSteamTemperatureOffsetC` and centralize
  `effective = raw + savedOffset` after raw-sensor validation.
- Apply effective temperature to control, readiness, recovery, deadlines,
  diagnostics/history, snapshots, and normal over-temperature decisions.
- Raise effective Steam over-temperature to `135°C` and add an independent
  raw `135°C` ceiling checked before correction.
- Validate whether an effective target is reachable below the raw ceiling,
  without mutating or clamping persisted targets.
- Preserve Brew PI/legacy selection, extraction `+2°C` private duty bias,
  ten-second SSR window, safety lease, boot-off ordering, and fail-off owners.

## Non-Scope

- Calibration session/routes, simulator, mobile, UI, pump/steam-valve control,
  physical thermostat testing, or energized work.

## Implementation Plan

1. Add the pure calibration record, validation, storage interface, and ESP-IDF
   NVS adapter.
2. Load calibration during fail-off startup before normal temperature control.
3. Centralize raw validation and single raw-to-effective conversion.
4. Replace the fixed Steam correction and route all normal temperature
   consumers through the effective value.
5. Add target-reachability and dual-limit fault/dismissal policy.
6. Expand native/sanitizer host tests and contract captures.

## Acceptance Criteria

- [x] Missing storage yields uncalibrated `0°C`; saved `0°C` remains calibrated;
  corrupt/unreadable storage faults and keeps the heater off.
- [x] `108°C/-8°C`, `95°C/+5°C`, and `100°C/0°C` produce effective `100°C`.
- [x] Brew and Steam use the correction exactly once and no active firmware
  symbol or call path retains the fixed Steam-only `+5°C`.
- [x] Effective Steam `135°C` and raw `135°C` independently latch
  `over_temperature` and fail off.
- [x] Offset-aware target reachability rejects unsafe requests without changing
  stored targets.
- [x] Existing controller, workflow, permission, lease, output, and fault
  regression suites pass in native and sanitizer builds.

## Completion Evidence

- Native firmware host suite: 10/10 CTest targets passed.
- Sanitizer firmware host suite: 10/10 CTest targets passed.
- Firmware contract validation: 32 response captures passed.
- Pure tests cover missing, explicit zero, signed bounds, corrupt/read/save
  failures, the three required arithmetic examples, both controller builds,
  both modes, unsafe target rejection, and independent raw/effective limits.

## Decision Log

- Temperature calibration uses a dedicated versioned NVS blob; record presence
  distinguishes explicitly saved `0°C` from the missing-record default.
- Raw validation and the independent raw ceiling run before the one global
  offset is used by effective-temperature consumers.
- Safe target validation requires the implied raw target to remain strictly
  below `135°C`; rejected targets are neither persisted nor clamped.

## Verification Strategy

- Add pure storage tests for missing, zero, signed bounds, corruption, and
  failure.
- Add control traces for both modes, both controllers, offset signs, target
  changes, both temperature ceilings, and fault dismissal.
- Run the complete firmware native/sanitizer host suite and capture validation.

## Dependencies

- TCAL-001 complete.

## Files Expected To Change

- `firmware/espresso-machine/components/firmware_config/`
- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/components/control/`
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`
- `docs/TRACKER.md`
