# PHIL-006 — Implement the firmware control state machine

Status: Todo
Review Mode: Agent
Review Reason: Mode, readiness, timeout, validation, and fault transitions can be proven with a simulated clock and sensor inputs.

## Goal

Implement deterministic temperature-control state and safety behavior independent of networking.

## Scope

- Implement brew/steam modes, active sensor/target selection, and brew boot default.
- Implement readiness stability, five-minute steam timeout, and automatic brew return.
- Implement target validation and persistence orchestration.
- Latch defined faults and force SSR command off.
- Monitor both sensors in every mode.

## Non-Scope

- HTTP/mDNS, mobile behavior, or tuning with an energized boiler.

## Implementation Plan

1. Build a pure state machine around clock, sensors, settings, and heater interfaces.
2. Add mode/readiness/timeout behavior.
3. Add fault and recovery behavior.
4. Cover boundaries and failure sequences with host tests.

## Acceptance Criteria

- [ ] Boot always selects brew without overwriting persisted targets.
- [ ] Ready requires ±1°C for three continuous seconds.
- [ ] Steam returns to brew five minutes after first ready.
- [ ] Every defined fault latches until reboot and commands SSR off.
- [ ] Network presence is irrelevant to control behavior.

## Verification Strategy

Run table-driven host tests with fake time, sensors, NVS, and SSR output.

## Dependencies

PHIL-005.

## Files Expected To Change

Firmware domain/control modules, safety constants, and host tests.
