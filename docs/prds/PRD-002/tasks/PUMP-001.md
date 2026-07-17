# PUMP-001 — Define API v2 extraction contract

Status: Done
Review Mode: Agent
Review Reason: OpenAPI structure, strict schemas, fixtures, compatibility, and validation behavior are deterministic and fully testable.

## Goal

Define the language-neutral API v2 contract for profiles and acknowledged extraction control while preserving API v1 unchanged.

## Scope

- Add API v2 state, profile-set read/replace, extraction Start, and idempotent Stop operations.
- Define four stable slug slots, 1–12 ASCII alphanumeric names, whole-second phases, and the 60-second total bound.
- Define idle/running extraction state, phase, selected profile, elapsed/remaining time, and `running`/`off` pump command semantics.
- Define same-key Start replay, competing-Start conflict, atomic replacement, and existing internal-error behavior.
- Add strict Zod mirrors plus accepted/rejected fixtures and drift tests.

## Non-Scope

- Mobile UI, simulator behavior, firmware implementation, API v1 retirement, or physical pump claims.

## Implementation Plan

1. Add versioned v2 paths and schemas to the authoritative OpenAPI document.
2. Mirror every v2 request and response in strict protocol schemas and types.
3. Add fixtures for valid examples and every profile/idempotency/conflict boundary.
4. Prove API v1 fixtures and schemas remain unchanged.

## Acceptance Criteria

- [x] API v2 expresses all PRD-002 operations and acknowledged state without claiming measured pump state.
- [x] Profile IDs, names, slot count, phase combinations, and duration limits are strict and consistent.
- [x] Start replay, active conflict, idle-only export, and idempotent Stop have stable response/error shapes.
- [x] API v1 remains contract-compatible and temperature-control-only.
- [x] OpenAPI validation, protocol tests, and protocol typecheck pass.

## Verification Strategy

- Run the protocol OpenAPI structural, fixture, schema, drift, and typecheck scripts.
- Add rejected examples for unknown keys, invalid names/slugs, duplicate slots, invalid timing, and duration overflow.

## Dependencies

- PRD-002 approved.

## Files Expected To Change

- `packages/protocol/openapi.yaml`
- `packages/protocol/src/`
- `packages/protocol/fixtures/`
- `packages/protocol/test/`

## Implementation Record

### Changed behavior

- Added authenticated API v2 state, complete profile-set read/replace, idempotent Start, and idempotent Stop operations while retaining all API v1 paths.
- Added strict Zod types for four ordered immutable slots (`profile-1` through `profile-4`), nullable empty slots, ASCII alphanumeric names, whole-second phases, total-duration rules, idempotency keys, extraction phases, and acknowledged GPIO10 command state.
- Added stable API v2 errors and an active-extraction conflict body that returns the already acknowledged running extraction.
- Added accepted and rejected fixtures for slot, name, phase, duration, idempotency, command/phase, and conflict boundaries.

### Decisions made

- Slot identity is positional and immutable: the complete set always contains `profile-1` through `profile-4` in that order. Editable names are never identifiers.
- `mainExtractionSeconds` is at least 1; soak is valid only after non-zero pre-infusion; all three phases total at most 60 seconds.
- API v2 state nests the unchanged v1 machine snapshot under `machine` and extraction state under `extraction`, avoiding changes to the v1 response.
- `running` and `off` are bound to phase-specific GPIO command semantics only. A soak is running extraction state with an `off` pump command.
- Idempotent replay returns the same running state with the same `extractionId`; competing Start and active-time profile replacement return `extraction_active` plus that active state.

### Safety and compatibility impact

- API v1 remains temperature-control-only; its path set, schemas, fixtures, and error enum are unchanged.
- This task defines wire behavior only. It does not issue pump requests, change firmware, or establish physical pump operation/de-energization.
- The OpenAPI `PumpCommand` description explicitly excludes measured pump operation, switch position, current, flow, and confirmed physical de-energization.

### Verification evidence

- PASS — `bun run validate:openapi`.
- PASS — `bun run test:protocol` (69 tests, 143 expectations).
- PASS — `bun run typecheck:protocol`.
- PASS — `bun run typecheck` (mobile consumer).
- PASS — `bun run lint`.
- PASS — `bun run typecheck:simulator`.
- PASS — `bun run test:simulator` (25 tests, 115 expectations).
- PASS — firmware host configure/build and `ctest` (4/4), followed by firmware contract capture validation (8 captures), using `/tmp/philcoino-pump001-host-tests` and `/tmp/philcoino-pump001-contract`.

### Checks not passing or not run

- `bun run --cwd apps/mobile test` ran 60 tests: 59 passed and the pre-existing debug-mode environment test failed because passing `undefined` activates the function's default environment parameter while the repository `.env` sets `EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE`. The same result occurred with the shell variable unset because Expo/Bun loads `.env`. This code was not changed by PUMP-001 and is in PUMP-002's debug-mode scope.
- ESP-IDF target build and hardware checks were not run because PUMP-001 changes only the language-neutral/TypeScript contract.

### Remaining blockers or human acceptance

- None for PUMP-001. PUMP-002 was the next Human-review task and later received
  explicit design approval before the remaining implementation advanced.
