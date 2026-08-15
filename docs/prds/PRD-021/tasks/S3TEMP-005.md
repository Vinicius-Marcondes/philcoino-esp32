# S3TEMP-005 — Migrate the deterministic simulator

Status: Done
Review Mode: Agent
Review Reason: The simulator is deterministic and fully covered by contract and model tests.

## Goal
Provide API v4 dual-temperature behavior for mobile development without claiming physical fidelity.

## Scope
- Model independent raw readings, offsets, availability, active control selection, and storage faults.
- Implement v4 routes, calibration workflows, timeout-only Steam settings, and telemetry v2.
- Extend simulator controls and tests for both sensors.

## Non-Scope
- Physically accurate two-location thermal modeling.

## Implementation Plan
1. Align routes and persistence with the v4 contract.
2. Add deterministic two-sensor state and fault injection.
3. Update integration and reset/persistence tests.

## Acceptance Criteria
- [x] Simulator output passes strict v4 schemas.
- [x] Mode, calibration, fault, reset, and telemetry behavior cover both sensors.
- [x] Simulator documentation states that results are not hardware-safety evidence.

## Verification Strategy
- Run simulator tests, typecheck, and protocol integration tests.

## Dependencies
- S3TEMP-001.

## Files Expected To Change
- `tools/device-simulator/`
