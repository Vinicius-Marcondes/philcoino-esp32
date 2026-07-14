# THERM-006 — Implement the firmware cooldown policy

Status: Todo
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

- [ ] Pump cannot start unless heater-off/inhibit establishment succeeds.
- [ ] Threshold, 45-second cutoff, and Stop command pump off and enter exactly five stabilization seconds.
- [ ] Same-key replay does not restart time; conflicts cannot replace active state.
- [ ] Sensor/output failure aborts and attempts both outputs off without restoring heating.
- [ ] User heater permission is never enabled by cooldown and reset boots idle/off.
- [ ] Strict C++17 host build and all cooldown policy tests pass.

## Verification Strategy

- Test exact/adjacent deadlines, target changes after snapshot, disabled permission, delayed updates, disconnect equivalence, output failure, and timer wraparound.

## Dependencies

- THERM-005.

## Files Expected To Change

- `firmware/espresso-machine/components/control/`
- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/host-tests/`
