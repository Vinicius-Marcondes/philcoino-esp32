# THERM-005 — Implement the firmware extraction compensation policy

Status: Done
Review Mode: Agent
Review Reason: Phase eligibility, fixed bias calculation, safety overrides, and deadline preservation are pure deterministic policies suitable for host tests.

## Goal

Add the fixed phase-aware Brew heater-duty bias without changing targets, readiness, timeouts, limits, or pump independence.

## Scope

- Add compile-time `0°C` pre-infusion and `+2°C` Manual/main constants.
- Apply the clamped bias only to heater demand/duty calculations for the eligible extraction phase.
- Suppress compensation during soak, Steam, disabled permission, faults, and fail-off conditions.
- Preserve readiness, persisted/displayed targets, heating/Steam deadlines, over-temperature limits, and extraction continuation under heater faults.
- Add exact/adjacent phase, clamp, fault, timeout, and wraparound host tests.

## Non-Scope

- Cooldown, HTTP, OLED/mobile UI, runtime-configurable tuning, or physical effectiveness.

## Implementation Plan

1. Add named firmware constants and a narrow controller-owned compensation input/state.
2. Separate the duty target from the persisted/readiness target.
3. Reset compensation at every exact workflow boundary without resetting safety timers.
4. Add exhaustive pure C++ tests.

## Acceptance Criteria

- [x] Manual/main uses `min(brewTargetC + 2°C, brewOverTemperatureC - 1°C)`; pre-infusion uses `0°C`; soak uses none.
- [x] API/OLED targets, readiness, timeouts, recovery ownership, and limits retain base-target semantics.
- [x] Faults, heater permission, Steam, and output failures override compensation.
- [x] Heater faults suppress heat without independently stopping extraction.
- [x] Strict C++17 host build and all affected host tests pass.

## Verification Strategy

- Host-test exact/adjacent temperatures and phases, maximum Brew target clamp, fault/permission changes, delayed updates, and timer wraparound.

## Dependencies

- THERM-004.

## Files Expected To Change

- `firmware/espresso-machine/components/firmware_config/`
- `firmware/espresso-machine/components/control/`
- `firmware/espresso-machine/host-tests/`
- `docs/hardware/temperature-control-tuning.md`

## Completion Evidence

### Changed behavior

- Firmware configuration now names compile-time `0°C` pre-infusion and `+2°C`
  Manual/main heater-duty offsets.
- `TemperatureController` accepts one narrow extraction-phase input. Manual and
  main extraction derive a private duty target clamped to
  `kBrewOverTemperatureC - 1`; pre-infusion, soak, idle, and Steam retain the
  unchanged active target.
- Only heater demand and pulse duration read the private duty target. The
  controller's persisted/snapshot target, effective temperature, readiness,
  heating demand deadline, recovery eligibility, Steam deadline, and
  over-temperature policy still use the base target and existing active
  temperature.
- Exact phase changes restart only the duty window. They do not reset
  readiness, heating timeout, Steam timeout, extraction time, or the user's
  heater permission.
- Compensation status is suppressed in Steam, with heater permission disabled,
  after a latched fault, or after the fail-off safety lease trips. Heater faults
  remain independent from `ExtractionController` and do not stop its pump
  command policy.

### Decisions

- The controller owns both the compensated duty target and the public
  compensation-eligibility predicate. Callers supply only the authoritative
  extraction phase; they cannot supply an offset or compensated target.
- Recovery arming/trigger ownership remains based on the base Brew target. The
  fixed bias changes only the final demand/pulse calculation, matching the PRD
  boundary and avoiding target/readiness/timeout drift.
- Repeating the same phase is a no-op. A real phase boundary begins a new duty
  window so an entering eligible phase can request its own bounded pulse and an
  exiting phase cannot inherit an ineligible compensated pulse.
- Runtime extraction-task coordination and API/OLED serialization are not
  pulled into this task; later ordered tasks wire this already-tested policy.

### Compatibility and safety impact

- API v1/v2 shapes, persisted targets/profiles, OLED input, readiness, Steam
  correction, heating/Steam deadlines, limits, and extraction deadlines are
  unchanged.
- The `+2°C` bias remains below the Brew over-temperature threshold by at least
  `1°C`, including the maximum `95°C` Brew target. The existing over-temperature
  check still evaluates the uncompensated validated Brew temperature against
  the unchanged `98°C` limit.
- Permission, sensor, internal-output, safety-lease, and over-temperature faults
  override the heater command. A heater fault does not independently stop an
  active extraction.
- This is command-policy evidence only. It does not establish physical heat,
  cooling, flow, current, SSR operation, calibration, or energized safety and
  closes no review finding.

### Verification evidence

- `cmake -S firmware/espresso-machine/host-tests -B
  /private/tmp/philcoino-prd004-host-tests` — passed.
- `cmake --build /private/tmp/philcoino-prd004-host-tests` — passed under the
  configured strict C++17 `-Wall -Wextra -Werror` build.
- `ctest --test-dir /private/tmp/philcoino-prd004-host-tests
  --output-on-failure` — passed 4/4: firmware config, peripherals, control, and
  firmware API.
- Added control coverage for idle/pre-infusion/soak/Manual/main exact phase
  behavior, base target/readiness preservation, maximum-target clamp and
  adjacent `96.99/97/97.99/98°C` boundaries, Steam and permission suppression,
  sensor/output faults, heater-fault extraction independence, heating-timeout
  wraparound, and Steam-deadline wraparound.

### Checks not run

- ESP-IDF target build, firmware response captures, protocol/simulator/mobile
  suites, and physical checks were not run because THERM-005 changes only pure
  firmware configuration/control policy, its host tests, and tuning
  documentation. Cross-layer checks remain assigned to later tasks.
- No dependency, package, CLI, SDK, or program was installed.

### Remaining blockers and human acceptance

- No Agent blocker remains for THERM-005.
- Runtime phase coordination is intentionally pending THERM-007/THERM-008.
  THERM-010/THERM-011 Human evidence and authorization remain deferred and no
  physical behavior is claimed.
