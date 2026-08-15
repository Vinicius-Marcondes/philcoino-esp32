# S3TEMP-003 — Implement dual-sensor control and calibration

Status: Done
Review Mode: Agent
Review Reason: Pure C++ policy tests can deterministically cover every state and failure transition.

## Goal
Make Boiler and Steam independently calibrated authoritative control inputs without fallback.

## Scope
- Accept both readings in the controller and select the active sensor by mode.
- Enforce active/inactive failure, transition, over-temperature, timeout, and fail-off behavior.
- Persist independent calibration offsets and retain only Steam-ready timeout settings.

## Non-Scope
- Mobile calibration UI or physical sensor tuning.

## Implementation Plan
1. Introduce dual-reading/calibration value types and storage.
2. Refactor control snapshots, validation, mode changes, calibration sessions, and faults.
3. Remove heat-soak compensation and migrate the retained ready timeout.

## Acceptance Criteria
- [x] Brew uses Boiler and Steam uses Steam with no fallback or blending.
- [x] Invalid active readings force OFF immediately and latch after three failures; invalid inactive readings only block their mode.
- [x] Either raw sensor can trigger the 135°C cap and calibration remains sensor-specific and fail-off.

## Verification Strategy
- Run controller, storage, race, and sanitizer host tests.

## Dependencies
- S3TEMP-002.

## Files Expected To Change
- `firmware/espresso-machine/components/control/`
- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/host-tests/`
