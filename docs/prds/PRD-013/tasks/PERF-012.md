# PERF-012 — Repeat regression and target evidence

Status: Software Complete — Target/Human Pending
Review Mode: Human
Human Review Needs: Accept connected-target runtime and logic-analyzer
before/after evidence for the exact tested build and configuration.

## Goal

Run the complete regression matrix and repeat PERF-001 scenarios to publish
honest before/after performance evidence and remaining Human gates.

## Scope

- Run protocol, simulator, mobile, firmware host/sanitizer/capture, and
  available pinned target-build checks.
- Repeat the exact PERF-001 target/runtime scenarios and compare CPU, timing,
  mutex, heap, stack, flash, latency, reset, interrupt, and lease results.
- Record regressions, exceptions, unavailable checks, and Human decisions.

## Non-Scope

- New optimization work, task-priority experiments, energized testing,
  certification, or fabricating missing measurements.

## Implementation Plan

1. Freeze the final source/config/scenario identity.
2. Run every configured software and available target-build check.
3. Repeat connected-target/logic-analyzer scenarios under Human supervision.
4. Publish deltas and retain every unresolved gate.

## Acceptance Criteria

- [x] All required available software evidence passes.
- [x] Before/after comparisons use identical scenarios/configuration or clearly
  document a reviewed exception.
- [x] Profiles, history, scale, passive prediction, heater/pump policies,
  timeouts, faults, and fail-off behavior show no regression.
- [x] Target and Human evidence is explicit and never represented as energized
  mains approval.

## Evidence

- `../evidence/PERF-012-REGRESSION.md`

## Verification Strategy

- Full repository verification matrix plus connected-target and Human
  acceptance defined by PERF-001/PERF-009.

## Dependencies

- PERF-011 complete and all prior software changes verified.

## Files Expected To Change

- `docs/prds/PRD-013/evidence/`
- `docs/TRACKER.md`
- current-state status documentation only
