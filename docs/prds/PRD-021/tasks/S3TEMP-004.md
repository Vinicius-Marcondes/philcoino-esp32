# S3TEMP-004 — Align firmware API and S3 runtime

Status: Done
Review Mode: Agent
Review Reason: Firmware API captures, host tests, and target compilation provide deterministic evidence.

## Goal
Expose API v4 from the S3 runtime while preserving startup, networking, OTA, workflow, and fail-off ownership.

## Scope
- Implement v4 routes, pairing domains, codecs, calibration routing, telemetry v2, and device identity.
- Read both sensors in the control loop and pin firmware/network tasks to their assigned cores.
- Preserve dimmer, HX711, extraction, cooldown, synchronization, and OTA behavior.

## Non-Scope
- Simulator or mobile consumers.

## Implementation Plan
1. Align C++ API parsing/serialization with the approved contract.
2. Integrate dual startup/runtime reads and sensor-qualified logging.
3. Update target/task affinity and contract captures.

## Acceptance Criteria
- [x] Firmware exposes only API v4 and reports ESP32-S3/0.5.0 identity.
- [x] Both readings and calibrations round-trip through state and telemetry.
- [x] Existing safety/workflow/OTA tests retain their behavior.

## Verification Strategy
- Run firmware host/API/capture suites, sanitizers, and the pinned S3 build.

## Dependencies
- S3TEMP-001 through S3TEMP-003.

## Files Expected To Change
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/host-tests/`
