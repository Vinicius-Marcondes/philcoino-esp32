# S3TEMP-002 — Establish the ESP32-S3 hardware foundation

Status: Done
Review Mode: Agent
Review Reason: Target configuration, pin ownership, initialization order, and host checks are deterministic.

## Goal
Move the firmware foundation to ESP32-S3 N16R8 and implement the shared dual-MAX6675 transport.

## Scope
- Configure the S3 target, native USB, 16 MB flash, disabled PSRAM, task affinities, and fixed GPIO map.
- Add shared-clock, separate-CS/SO MAX6675 channels with fail-off initialization.
- Add per-instance zero-frame and excessive-drop validation.

## Non-Scope
- Dual-sensor control policy or API serialization.

## Implementation Plan
1. Update target defaults, metadata, config constants, and compile-time pin checks.
2. Refactor the ESP MAX6675 adapter around one locked shared bus and two channels.
3. Extend pure peripheral tests and bounded diagnostics.

## Acceptance Criteria
- [x] The configured pins and reserved-pin rules match PRD-021.
- [x] Both channels initialize safely and sample independently every 500 ms.
- [x] Zero frames and drops greater than 10°C are rejected without corrupting either baseline.

## Verification Strategy
- Run peripheral/config host tests and a compile-only ESP32-S3 build when available.

## Dependencies
- S3TEMP-001.

## Files Expected To Change
- `firmware/espresso-machine/components/firmware_config/`
- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/sdkconfig.defaults`
