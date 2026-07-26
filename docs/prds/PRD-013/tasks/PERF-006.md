# PERF-006 — Cache accepted scale processing

Status: Done
Implementation Commit: `726d5c4`
Review Mode: Agent
Review Reason: Accepted-sample processing, cached snapshots, age, and
availability are deterministic in pure controller tests.

## Goal

Recompute scale filtering and stability only after accepted samples and expose
O(1) cached snapshots without locking for `NotReady`.

## Scope

- Skip workflow mutex acquisition and controller publication for `NotReady`.
- Update median, spread, stability, calibrated weight, and cache only for
  accepted samples.
- Preserve current age/availability and the automatic-tare readiness window.
- Continue bounded post-extraction settling sampling.

## Non-Scope

- ISR notification wiring, calibration persistence, API schema changes, or
  extraction policy removal.

## Implementation Plan

1. Separate accepted-sample processing from snapshot reads.
2. Cache derived scale state with current age/availability calculation.
3. Keep automatic tare and settling semantics intact.
4. Add saturation, disconnect, recovery, tare, cutoff, fallback, and settling
   regressions.

## Acceptance Criteria

- [x] `NotReady` never acquires the workflow mutex.
- [x] Derived scale work runs only after an accepted sample.
- [x] Consumer snapshots are O(1) and preserve age/availability.
- [x] Automatic tare and bounded settling behavior are unchanged.
- [x] Firmware host and available target checks pass.

## Evidence

- `../evidence/PERF-006-CACHED-SCALE.md`

## Verification Strategy

- Pure scale/extraction tests, firmware host/sanitizer suites, and target
  diagnostics when available.

## Dependencies

- PERF-005 complete.

## Files Expected To Change

- `firmware/espresso-machine/components/control/`
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`
- `docs/TRACKER.md`
