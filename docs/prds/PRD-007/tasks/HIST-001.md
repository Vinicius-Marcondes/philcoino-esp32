# HIST-001 — Define the rolling-history contract

Status: Done
Review Mode: Agent
Review Reason: The additive endpoint, strict cursor rules, compatibility, and fixtures are deterministic and fully testable.

## Goal

Define the authenticated API v2 history endpoint without changing any existing wire shape.

## Scope

- Add history cursor, continuity, sample, and page schemas to OpenAPI and Zod.
- Add accepted/rejected fixtures and structural/drift coverage.
- Preserve API v1 and existing API v2 paths and shapes.

## Non-Scope

- Simulator, firmware, mobile persistence, graph UI, or physical validation.

## Implementation Plan

1. Define `GET /api/v2/history` and strict query/response semantics in OpenAPI.
2. Mirror response types and query constants in the protocol package.
3. Add fixtures and tests for all continuity and invalid-shape cases.

## Acceptance Criteria

- [x] The endpoint is bearer-protected and pages at no more than sixty samples.
- [x] Strict schemas represent initial, continuous, truncated, and reset pages.
- [x] Existing API v1/v2 shapes remain unchanged.
- [x] Protocol validation, tests, and typecheck pass.

## Completion Evidence

- Added strict OpenAPI/Zod cursor, sample, continuity, and page shapes plus valid and rejected fixtures.
- `bun run validate:openapi` passed.
- `bun run test:protocol` passed: 123 tests, 247 expectations.
- `bun run typecheck:protocol` passed.
- No dependency, simulator, firmware, mobile, or physical behavior changed.

## Verification Strategy

- Run OpenAPI validation, protocol tests, protocol typecheck, and fixture drift checks.

## Dependencies

- PRD-007 approved.

## Files Expected To Change

- `packages/protocol/openapi.yaml`
- `packages/protocol/src/`
- `packages/protocol/fixtures/`
- `packages/protocol/test/`
