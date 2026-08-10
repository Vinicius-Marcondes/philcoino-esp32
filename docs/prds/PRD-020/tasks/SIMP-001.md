# SIMP-001 — Define the breaking contract

Status: Done
Review Mode: Agent
Review Reason: OpenAPI, schemas, fixtures, and drift tests are deterministic.

## Goal

Remove machine history/profile endpoints, advertise API generation 2, and define
inline immutable profile execution.

## Scope

- Update OpenAPI, Zod types, fixtures, validation, and protocol documentation.
- Make extraction state and stream selection self-describing.

## Non-Scope

- Simulator, firmware, mobile runtime, or UI implementation.

## Implementation Plan

1. Remove the obsolete operations and history/profile-set wire schemas.
2. Add the exact profile to profile selections and bump device API generation.
3. Update accepted/rejected fixtures and contract drift tests.

## Acceptance Criteria

- [x] Strict schemas reject missing, invalid, unknown, and mismatched profile data.
- [x] Removed operations are absent and all retained operations validate.

## Verification Strategy

- Run protocol validation, tests, and typecheck.

## Dependencies

- PRD-020 approved.

## Files Expected To Change

- `packages/protocol/openapi.yaml`
- `packages/protocol/src/`
- `packages/protocol/fixtures/`
- `packages/protocol/test/`
