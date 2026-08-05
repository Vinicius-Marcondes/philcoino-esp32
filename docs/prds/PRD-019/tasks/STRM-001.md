# STRM-001 — Define the extraction stream contract

Status: Done
Review Mode: Agent
Review Reason: OpenAPI, strict schemas, fixtures, and drift tests provide deterministic acceptance.

## Goal

Define the additive authenticated SSE contract before runtime implementation.

## Scope

- Add `/api/v2/extractions/stream`, exact cursor parsing, telemetry page/sample
  schemas, constants, error codes, and exported TypeScript types.
- Preserve `/api/v2/scale/trace` and all REST mutation shapes.

## Non-Scope

- Simulator, firmware, mobile runtime, storage, UI, or physical testing.

## Implementation Plan

1. Add the OpenAPI operation and strict component schemas.
2. Mirror constants/types in Zod.
3. Add accepted/rejected fixtures and drift tests.
4. Align protocol documentation.

## Acceptance Criteria

- [x] Cursor triplets, page ordering, continuity, terminal invariants, and error responses are strict.
- [x] Pages are capped at 16 samples and retention/cadence/settling constants match PRD-019.
- [x] OpenAPI validation, protocol tests, and typecheck pass.

## Verification Strategy

- Run protocol validation, tests, fixture drift checks, and typecheck.

## Dependencies

- PRD-019 approved.

## Files Expected To Change

- `packages/protocol/openapi.yaml`
- `packages/protocol/src/`
- `packages/protocol/fixtures/`
- `packages/protocol/test/`
- `docs/protocol/api-v2-outline.md`
