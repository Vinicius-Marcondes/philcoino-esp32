# TCAL-001 — Define the calibration API contract

> TCAL-008 supersedes this task's original strict-below-`135°C` target-bound
> wording: exact raw `135°C` is now reachable and values above it are rejected.

Status: Done
Review Mode: Agent
Review Reason: OpenAPI validation, strict Zod schemas, fixtures, and drift tests
provide deterministic acceptance for the additive API v2 contract.

## Goal

Define the complete language-neutral contract for guided temperature
calibration, signed global offsets, raw/effective readings, safe target bounds,
and transactional errors before implementing any runtime behavior.

## Scope

- Start in `packages/protocol/openapi.yaml`.
- Define calibration constants: logical boiling reference `100°C`, candidate
  range `90–120°C`, signed offset range `-20–10°C`, `1°C` steps, effective
  Steam limit `135°C`, raw ceiling `135°C`, and a 15-second inactivity lease.
- Add strict authenticated API v2 operations for calibration status, start,
  candidate update, save, and cancel.
- Use one opaque calibration-session identifier on active-session operations.
- Define uncalibrated, calibrating, and calibrated states; raw/effective
  readings; offset preview; advisory stability; safe target bounds; conflicts;
  inactive/expired sessions; unsafe targets; and persistence failures.
- Update `boilerTemperatureC` documentation to mean effective temperature in
  both Brew and Steam without adding fields to existing state payloads.
- Align Zod schemas, exported types/constants, fixtures, structural validation,
  and contract drift tests.

## Non-Scope

- Firmware, simulator, mobile behavior, UI, NVS implementation, physical
  calibration, thermostat validation, or energized testing.

## Implementation Plan

1. Characterize existing API v2 mutation/error conventions and strict fixtures.
2. Add calibration operations, schemas, constants, and error semantics to
   OpenAPI.
3. Mirror the contract in Zod and exported TypeScript types.
4. Add accepted/rejected fixtures for boundaries, unknown fields, conflicts,
   expired sessions, and unsafe effective-to-raw targets.
5. Update protocol documentation and run the complete protocol matrix.

## Acceptance Criteria

- [x] OpenAPI defines strict status/start/candidate/save/cancel operations with
  bearer authentication and opaque session ownership.
- [x] Candidate, offset, Steam effective limit, raw ceiling, and inactivity
  lease constants match PRD-017.
- [x] Calibration responses distinguish raw, effective, saved, candidate, and
  advisory state without changing existing machine-state shapes.
- [x] Unsafe calibration saves and target requests have deterministic strict
  error responses and are never represented as clamped success.
- [x] OpenAPI validation, protocol tests, fixture drift checks, and protocol
  typecheck pass.

## Completion Evidence

- `bun run validate:openapi`: passed.
- `bun run test`: 157 tests passed with 337 expectations.
- `bun run typecheck`: passed.
- Added strict calibration state/request fixtures and rejection coverage for
  bounds, fractional candidates, unknown fields, session IDs, preview
  arithmetic, and unsafe targets.

## Decision Log

- The additive API v2 workflow uses a 15-second inactivity lease renewed by a
  matching status read; this is session ownership, not an overall calibration
  timer.
- Existing machine-state shapes remain unchanged and
  `boilerTemperatureC` is redefined as the single-offset effective temperature
  in both modes.
- Safe target bounds remain within the existing Brew/Steam product ranges and
  expose only targets whose implied raw value is at or below `135°C`.

## Verification Strategy

- Run `validate:openapi`, the full protocol test suite, and protocol typecheck.
- Add positive fixtures for all calibration states and negative fixtures for
  every numeric boundary, extra property, invalid transition, and unsafe target.

## Dependencies

- PRD-017 approved.

## Files Expected To Change

- `packages/protocol/openapi.yaml`
- `packages/protocol/src/`
- `packages/protocol/fixtures/`
- `packages/protocol/test/`
- `packages/protocol/README.md`
- `docs/protocol/api-v2-outline.md`
- `docs/TRACKER.md`
