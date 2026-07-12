# PUMP-006 — Implement the firmware extraction state machine

Status: Todo
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

- [ ] All phases and Manual cutoff command off at their exact deadlines without phone renewal.
- [ ] Same-key replay preserves the original start time; competing starts cannot replace an active extraction.
- [ ] Stop is idempotent and reset/power-cycle initialization is idle/off.
- [ ] Temperature/heater faults do not stop extraction and extraction does not reset heater safety deadlines.
- [ ] Pump/output failure ends extraction through internal-error handling.
- [ ] Host tests cover disconnect equivalence, delayed updates, timer wraparound, and every transition.

## Verification Strategy

- Pure C++ host tests with fake monotonic time, profile storage, pump output, heater faults, delayed updates, and wraparound boundaries.

## Dependencies

- PUMP-005.

## Files Expected To Change

- `firmware/espresso-machine/components/control/`
- `firmware/espresso-machine/host-tests/`
- `firmware/espresso-machine/main/`
