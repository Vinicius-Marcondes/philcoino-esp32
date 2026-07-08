# PHIL-012 — Validate contract and resilience end to end

Status: Todo
Review Mode: Agent
Review Reason: Cross-workspace contract conformance and failure recovery can be exercised deterministically with the simulator and captured firmware fixtures.

## Goal

Prove that mobile, simulator, and firmware agree on API v1 and recover correctly from realistic failures.

## Scope

- Add end-to-end tests for pairing, polling, settings, mode, timeout, faults, malformed data, unauthorized responses, and address changes.
- Validate firmware response fixtures against OpenAPI/Zod.
- Add checks preventing undocumented endpoints and schema drift.
- Verify no remote brew/pump/power behavior exists.

## Non-Scope

- Visual approval, mains testing, App Store release, or new features.

## Implementation Plan

1. Create reusable scenario fixtures.
2. Exercise complete mobile flows against Hono.
3. Check firmware fixtures against the same schemas.
4. Close contract inconsistencies at their owning layer.

## Acceptance Criteria

- [ ] All PRD API acceptance scenarios pass automatically.
- [ ] Simulator and firmware fixtures validate identically.
- [ ] Unauthorized, offline, timeout, and malformed cases recover predictably.
- [ ] Contract drift fails CI/test execution.

## Verification Strategy

Run all protocol, simulator, mobile, and firmware host-test suites plus lint/type/build checks.

## Dependencies

PHIL-007 and PHIL-011.

## Files Expected To Change

Cross-workspace fixtures/tests, CI or root verification scripts, and small owning-layer corrections.
