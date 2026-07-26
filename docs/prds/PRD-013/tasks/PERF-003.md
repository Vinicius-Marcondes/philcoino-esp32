# PERF-003 — Make live-state reads observational

Status: Done
Review Mode: Agent
Review Reason: Snapshot-only reads and workflow advancement ownership are
deterministic in host tests.

## Goal

Ensure API v2 state reads only copy current state and never advance extraction,
cooldown, scale settling, or temperature-control phase.

## Scope

- Remove workflow advancement from GET state paths.
- Leave all advancement with the dedicated workflow task.
- Add repeated-read and no-side-effect coverage.

## Non-Scope

- Wire changes, serialization optimization, task scheduling, scale acquisition,
  or any requested-task implementation.

## Implementation Plan

1. Characterize state-read side effects.
2. Replace advancement with coherent snapshot copying.
3. Prove repeated GET operations cannot alter controller state.

## Acceptance Criteria

- [x] GET state operations are observational.
- [x] Only the workflow task advances workflow state.
- [x] Existing API responses remain compatible.
- [x] Firmware host and capture checks pass.

## Evidence

- `../evidence/PERF-003-OBSERVATIONAL-STATE.md`

## Verification Strategy

- Firmware API/control host tests and contract captures.

## Dependencies

- PERF-002 complete.

## Files Expected To Change

- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`
- `docs/TRACKER.md`
