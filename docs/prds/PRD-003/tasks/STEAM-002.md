# STEAM-002 — Implement the firmware Steam temperature correction

Status: Done
Review Mode: Agent
Review Reason: Raw validation, mode-specific conversion, heater decisions,
readiness, timeouts, and fault boundaries can be proven with pure C++ host tests
and deterministic sensor/time inputs.

## Goal

Implement one centralized fixed `+5°C` correction for all Steam control and
safety decisions while leaving Brew and raw sensor validation unchanged.

## Scope

- Add the fixed Steam offset constant to the existing firmware configuration
  header.
- Validate thermocouple status and numeric validity before correction.
- Centralize conversion from the raw reading to the active effective
  temperature: raw in Brew and raw plus the configured offset in Steam.
- Use the effective Steam temperature exactly once for heater demand and duty,
  recovery, readiness, heating-timeout demand, Steam-timeout start,
  over-temperature latching, and over-temperature dismissal.
- Ensure control snapshots expose the effective temperature while retaining no
  separately public raw value.
- Preserve current mode-reset behavior, targets, limits, timeouts, persistence,
  fault latching, and fail-off output behavior.
- Add boundary-focused configuration and controller host tests.

## Non-Scope

- HTTP schema changes, mobile code, simulator physics, dynamic configuration,
  NVS storage, scaling, interpolation, or a correction curve.
- Adjusting Brew behavior or changing existing target/safety constants.
- Energized heater tests or claims of physical calibration.

## Implementation Plan

1. Add the single compile-time configuration constant and configuration guard.
2. Introduce one controller-owned raw-to-effective temperature path.
3. Route every Steam control and safety comparison through that path without
   weakening raw sensor validation.
4. Add deterministic tests for mode boundaries, timing, faults, and prevention
   of double application.

## Acceptance Criteria

- [x] The existing configuration header defines one Steam offset constant equal
  to `5°C` and no runtime configuration path exists.
- [x] A raw `115°C` sample in Steam is effective `120°C`, requests no further
  heat at a `120°C` target, and becomes ready only after three continuous
  seconds.
- [x] Steam readiness starts the existing five-minute timeout from the corrected
  temperature.
- [x] Duty, recovery, and heating-timeout demand use the correction exactly
  once.
- [x] A raw `125°C` Steam sample reaches the existing effective `130°C` limit,
  latches `over_temperature`, and commands the heater off.
- [x] Over-temperature dismissal uses the corrected Steam temperature and all
  existing validity/cooldown gates.
- [x] Invalid, open, non-finite, or failed raw samples latch `sensor_failure`
  before correction can influence control.
- [x] The same raw samples remain unchanged in Brew behavior and snapshots.
- [x] Mode changes retain the existing readiness, timeout, recovery, demand,
  and heater-window resets.
- [x] Firmware configuration and controller host tests pass.

## Verification Strategy

- Build the firmware host suite in a temporary directory outside the repository
  and run its CTest cases.
- Add exact-boundary and adjacent-boundary cases for `115/120°C` target control
  and `125/130°C` over-temperature behavior.
- Re-run existing Brew, readiness, timeout, recovery, wraparound, target update,
  sensor-failure, and output-failure cases as regressions.

## Dependencies

STEAM-001.

## Files Expected To Change

- `firmware/espresso-machine/components/firmware_config/include/philcoino/config.hpp`
- `firmware/espresso-machine/components/control/include/philcoino/control.hpp`
- `firmware/espresso-machine/components/control/src/control.cpp`
- `firmware/espresso-machine/host-tests/firmware_config_test.cpp`
- `firmware/espresso-machine/host-tests/control_test.cpp`

## Implementation Record

- Completed: 2026-07-14.
- Evidence: strict C++17 host CMake build completed in
  `/tmp/philcoino-prd003-steam002-host`; CTest passed 4/4 tests
  (`firmware_config_test`, `peripherals_test`, `control_test`, and
  `firmware_api_test`).
- Decision: `kSteamTemperatureOffsetC` is the only production offset constant
  and equals `5`. `TemperatureController` retains a private raw reading,
  validates status and finiteness first, and converts it through the single
  `active_temperature()` path. Valid snapshots expose the effective value;
  callers do not add a correction.
- Boundary coverage: raw Steam `115°C` at target `120°C`, adjacent duty and
  recovery points, heating-demand timing, readiness/Steam timeout, raw
  open/invalid/transport/non-finite failures, raw `124.75/125°C`
  over-temperature boundaries, corrected dismissal, Brew preservation, and
  mode-reset recomputation.
- Safety evidence: host results establish software behavior only and do not
  validate physical calibration, SSR output, heater de-energization, or safe
  energized operation.
- Commit: This commit.
