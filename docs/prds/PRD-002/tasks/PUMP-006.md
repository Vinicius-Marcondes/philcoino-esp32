# PUMP-006 — Implement the firmware extraction state machine

Status: Done
Review Mode: Agent
Review Reason: Monotonic timing, wraparound, phase transitions, idempotency, fault independence, and fail-off paths are pure deterministic policies.

## Goal

Implement firmware-owned Manual and profile extraction timing independently of heater control and client connectivity.

## Scope

- Add idle, pre-infusion, soak, main, and Manual policy states.
- Enforce exact phase deadlines and the 60-second Manual and profile bounds using wrap-safe monotonic time.
- Implement same-key Start replay, competing-Start rejection, and idempotent Stop.
- Keep heater/temperature faults from stopping extraction while pump/output internal failures stop it.
- Ensure profile replacement is rejected while active and an active recipe is immutable.
- Keep time-critical pump-off behavior independent of blocking network, display, and persistence work.

## Non-Scope

- HTTP parsing, mobile behavior, physical pump feedback, or energized validation.

## Implementation Plan

1. Add a pure extraction controller over injected profile storage and pump output.
2. Implement validated Start/Stop/export commands and immutable active recipe capture.
3. Integrate monotonic updates without sharing heater deadlines or reset events.
4. Add exhaustive policy and wraparound tests.

## Acceptance Criteria

- [x] All phases and Manual cutoff command off at their exact monotonic policy deadlines without phone renewal.
- [x] Same-key replay preserves the original start time; competing starts cannot replace an active extraction.
- [x] Stop is idempotent and reset/power-cycle initialization is idle/off.
- [x] Temperature/heater faults do not stop extraction and extraction does not reset heater safety deadlines.
- [x] Pump/output failure ends extraction through the existing internal-error boundary.
- [x] Host tests cover disconnect equivalence, delayed updates, timer wraparound, and every transition.

## Verification Strategy

- Pure C++ host tests with fake monotonic time, profile storage, pump output, heater faults, delayed updates, and wraparound boundaries.

## Dependencies

- PUMP-005.

## Files Expected To Change

- `firmware/espresso-machine/components/control/`
- `firmware/espresso-machine/host-tests/`
- `firmware/espresso-machine/main/`

## Implementation Evidence

- Changed behavior: a pure `ExtractionController` now owns Manual and profile
  phase timing, immutable active profile capture, same-key replay, competing
  Start rejection, idempotent Stop, idle-only whole-set persistence, and pump
  fail-off behavior. A dedicated high-priority firmware task advances this
  controller independently from temperature, display, persistence, and network
  work.
- Verification: `cmake -S firmware/espresso-machine/host-tests -B
  /tmp/philcoino-pump-host`, `cmake --build /tmp/philcoino-pump-host
  --parallel`, and `ctest --test-dir /tmp/philcoino-pump-host
  --output-on-failure` passed all 4 host executables with strict C++17 warnings.
- Decisions: elapsed time uses unsigned wrap-safe subtraction; zero
  pre-infusion/soak begins directly in main extraction; delayed updates skip
  expired phases and command off when the absolute recipe deadline has passed;
  extraction and heater policies have no shared state or deadlines.
- Safety and compatibility: GPIO10 state remains only a firmware command;
  output failures clear the active extraction and attempt off. API v1 and the
  existing wire contract are unchanged in this task.
- Not run: the ESP-IDF 6.0.2 target build and disconnected GPIO10 observation
  remain scheduled for PUMP-007/PUMP-009; no hardware was energized.
- Remaining human acceptance: target timing, boot/reset/power-loss behavior,
  and low-voltage GPIO10 levels still require PUMP-009 observation.
