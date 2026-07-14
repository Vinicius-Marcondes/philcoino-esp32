# THERM-005 — Implement the firmware extraction compensation policy

Status: Todo
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

- [ ] Manual/main uses `min(brewTargetC + 2°C, brewOverTemperatureC - 1°C)`; pre-infusion uses `0°C`; soak uses none.
- [ ] API/OLED targets, readiness, timeouts, recovery ownership, and limits retain base-target semantics.
- [ ] Faults, heater permission, Steam, and output failures override compensation.
- [ ] Heater faults suppress heat without independently stopping extraction.
- [ ] Strict C++17 host build and all affected host tests pass.

## Verification Strategy

- Host-test exact/adjacent temperatures and phases, maximum Brew target clamp, fault/permission changes, delayed updates, and timer wraparound.

## Dependencies

- THERM-004.

## Files Expected To Change

- `firmware/espresso-machine/components/firmware_config/`
- `firmware/espresso-machine/components/control/`
- `firmware/espresso-machine/host-tests/`
- `docs/hardware/temperature-control-tuning.md`
