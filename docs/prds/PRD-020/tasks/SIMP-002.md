# SIMP-002 — Align the deterministic simulator

Status: Done
Review Mode: Agent
Review Reason: Simulator state, reset, route, and extraction behavior are fully testable.

## Goal

Model the simplified contract without stored profiles or machine history.

## Scope

- Remove profile/history routes, storage, reset behavior, and tests.
- Execute, echo, replay, and stream the exact inline profile.

## Non-Scope

- Firmware, mobile runtime, or physical behavior.

## Implementation Plan

1. Remove obsolete model state and routes.
2. Latch inline profile data for timed and weighted extraction.
3. Update deterministic integration coverage.

## Acceptance Criteria

- [x] Simulator covers all extraction modes and full-request idempotency.
- [x] Power cycle retains no machine profile state and exposes no history route.

## Verification Strategy

- Run simulator tests and typecheck.

## Dependencies

- SIMP-001.

## Files Expected To Change

- `tools/device-simulator/src/`
- `tools/device-simulator/test/`
