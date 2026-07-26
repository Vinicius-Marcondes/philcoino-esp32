# PERF-011 — Remove verified ghost features

Status: Done
Review Mode: Agent
Review Reason: Production reachability and retained active feature coverage are
deterministic through call-graph review and regression tests.

## Goal

Remove only production-unreachable helpers while confirming the dual-sensor
runtime is absent and active profiles, history, scale, and prediction remain.

## Scope

- Build a production call graph for suspected abandoned helpers.
- Delete only confirmed unreachable implementation/tests/docs.
- Preserve active profiles, synchronization, weighted extraction, ten-minute
  history, passive prediction, and single-sensor limitation documentation.

## Non-Scope

- Feature removal by source-size preference, architecture rewrite, API change,
  or rewriting historical decisions.

## Implementation Plan

1. Inventory suspected unreachable helpers and every caller.
2. Require positive reachability evidence before removal.
3. Delete only proven ghost code and update current-state documentation.
4. Run complete affected regressions.

## Acceptance Criteria

- [x] Every removed production helper has recorded unreachable evidence.
- [x] Active profiles/history/scale/prediction behavior remains present.
- [x] No dual-sensor runtime remains, while its safety limitation stays visible.
- [x] Firmware and affected workspace checks pass.

## Evidence

- `../evidence/PERF-011-GHOST-CALL-GRAPH.md`

## Verification Strategy

- Call-graph/search evidence and full affected host/workspace regression suites.

## Dependencies

- PERF-010 complete.

## Files Expected To Change

- only files containing verified unreachable helpers
- focused tests and current-state documentation
- `docs/TRACKER.md`
