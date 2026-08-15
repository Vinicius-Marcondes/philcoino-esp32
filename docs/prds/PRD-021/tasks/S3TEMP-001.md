# S3TEMP-001 — Define API v4 dual-temperature contract

Status: Done
Review Mode: Agent
Review Reason: OpenAPI, strict schemas, fixtures, and drift checks provide deterministic acceptance.

## Goal
Define the coordinated API v4 boundary for two temperature sensors and remove legacy Steam compensation.

## Scope
- Replace v3 paths, identity, pairing domains, schemas, fixtures, and types with v4.
- Add Boiler/Steam readings, sensor-qualified faults/calibrations, Steam-ready timeout, and telemetry page version 2.
- Remove Steam compensation and decay fields.

## Non-Scope
- Firmware, simulator, or mobile runtime implementation.

## Implementation Plan
1. Change OpenAPI first.
2. Align strict Zod schemas, exports, fixtures, and structural tests.
3. Document incompatibility and required re-pairing in the contract surface.

## Acceptance Criteria
- [x] Only API v4 routes and identity values remain in the active contract.
- [x] State, calibration, fault, settings, and telemetry schemas encode the approved behavior.
- [x] Protocol validation, tests, types, and fixtures pass.

## Verification Strategy
- Run protocol tests, typecheck, and OpenAPI validation.

## Dependencies
- PRD-021 approval.

## Files Expected To Change
- `packages/protocol/`
