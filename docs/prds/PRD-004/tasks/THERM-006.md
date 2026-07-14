# THERM-006 — Implement the firmware cooldown policy

Status: Done
Review Mode: Agent
Review Reason: Eligibility, output ordering, monotonic timing, idempotency, stabilization, and failure transitions can be proven with pure C++ fakes.

## Goal

Implement a deterministic firmware-owned cooldown state machine over injected temperature, heater-inhibit, and pump-output boundaries.

## Scope

- Add idle, pumping, and stabilizing policy states plus terminal outcome tracking.
- Enforce valid-sensor/no-fault eligibility, mutual exclusion, target snapshot, and automatic switch-to-Brew request.
- Force heater off before pump running and preserve user heater permission independently.
- End pumping at target, 45 seconds, Stop, or failure; hold a five-second stabilization inhibit.
- Implement same-key replay, competing conflict, idempotent Stop, reset-off, failure, delayed-update, and wraparound behavior.

## Non-Scope

- FreeRTOS integration, HTTP parsing, mobile UI, NVS, or energized validation.

## Implementation Plan

1. Define the narrow cooldown policy interfaces and snapshots.
2. Implement ordered Start, update, Stop, abort, and stabilization transitions.
3. Keep active state volatile and deadlines absolute/wrap-safe.
4. Add exhaustive host tests with stuck/failing output fakes.

## Acceptance Criteria

- [x] Pump cannot start unless heater-off/inhibit establishment succeeds.
- [x] Threshold, 45-second cutoff, and Stop command pump off and enter exactly five stabilization seconds.
- [x] Same-key replay does not restart time; conflicts cannot replace active state.
- [x] Sensor/output failure aborts and attempts both outputs off without restoring heating.
- [x] User heater permission is never enabled by cooldown and reset boots idle/off.
- [x] Strict C++17 host build and all cooldown policy tests pass.

## Verification Strategy

- Test exact/adjacent deadlines, target changes after snapshot, disabled permission, delayed updates, disconnect equivalence, output failure, and timer wraparound.

## Dependencies

- THERM-005.

## Files Expected To Change

- `firmware/espresso-machine/components/control/`
- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/host-tests/`

## Completion Evidence

### Changed behavior

- `CooldownController` now owns volatile idle, pumping, stabilizing, and retained
  terminal state over injected `TemperatureController` heater-inhibit and
  existing `FailOffPump` command boundaries.
- Start validates key, sensor, fault, extraction mutual exclusion, and current
  temperature. It snapshots the Brew target, requests Brew, establishes a
  heater-off inhibit, and only then requests the pump-running command.
- Pumping ends on the snapshotted threshold, exact 45-second cutoff, Stop, or
  failure. Target/Stop begin five seconds at the observed transition; cutoff
  uses the absolute original `start + 45s` boundary so a delayed update cannot
  add another stabilization interval.
- Same-key active or terminal replay retains identity and elapsed time. A
  competing active key conflicts. Stop is idempotent and never restarts the
  stabilization deadline.
- Sensor/machine/output failure attempts heater and pump off, latches the
  appropriate temperature-control fault, records terminal failed state, and
  clears the cooldown-specific inhibit only after fault ownership prevents
  heating. Reset clears all volatile identity/outcome state and requests both
  commands off.

### Decisions

- Cooldown constants are compile-time `45_000 ms` pumping and `5_000 ms`
  stabilization values in firmware configuration.
- The user's heater permission is never modified. Cooldown uses a separate
  controller-owned inhibit; completing or resetting it only releases that
  inhibit and does not command heat on.
- Existing `FailOffSsr`/safety lease and `FailOffPump` boundaries are reused;
  no new peripheral wrapper was needed. Tests include a pump fake that verifies
  a running command was not attempted before the heater inhibit/off command
  state was established.
- Terminal elapsed time is total workflow time. Cutoff delayed to or beyond 50
  seconds completes immediately after the late off attempt rather than
  extending the absolute policy deadline.

### Compatibility and safety impact

- API, FreeRTOS, NVS, OLED, persisted targets/profiles, extraction policy, and
  user heater permission are unchanged in this pure-policy task.
- Start in Steam explicitly returns the temperature controller to Brew before
  pump Start; extraction-active and active-cooldown replacement are rejected.
- Failed output writes remain command-attempt evidence. A wrapper reporting an
  off command cannot prove GPIO voltage, SSR state, current, water flow,
  cooling, or physical de-energization; an internal fault prevents automatic
  heating recovery.
- Active state is RAM-only and reset does not resume it. Host success is not
  firmware scheduling, target hardware, or physical safety evidence.

### Verification evidence

- Strict C++17 `-Wall -Wextra -Werror` host build passed.
- `ctest --test-dir /private/tmp/philcoino-prd004-host-tests
  --output-on-failure` passed 4/4.
- Added exact/adjacent coverage for heater-before-pump ordering, Steam-to-Brew,
  disabled permission preservation, eligibility and mutual exclusion, target
  snapshot despite later target mutation, same-key replay, competing conflict,
  `44,999/45,000 ms` cutoff, `4,999/5,000 ms` stabilization, repeated Stop,
  delayed 50-second update, timer wraparound, sensor failure, pump Start/off
  failure, heater-off failure, reset clearing, and retained terminal outcome.

### Checks not run

- ESP-IDF target build, API captures, protocol/simulator/mobile suites, and
  physical checks were not run because THERM-006 is a pure host policy task.
  Runtime scheduling and HTTP integration remain later ordered tasks.
- No package, dependency, program, CLI, or SDK was installed.

### Remaining blockers and human acceptance

- No Agent blocker remains for THERM-006.
- FreeRTOS/API/runtime coordination is intentionally pending THERM-007 onward.
  THERM-010 and THERM-011 remain deferred Human gates with no supplied physical
  evidence or energized authorization.
