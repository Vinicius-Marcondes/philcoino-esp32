# PERF-007 — Make scale calibration persistence transactional

Status: Done
Review Mode: Agent
Review Reason: Prepare/save/adopt/retry state transitions and storage failures
are deterministic with injected locks and persistence.

## Goal

Move scale-calibration NVS I/O outside the workflow mutex while preserving the
previous calibration until a new value is safely adopted.

## Scope

- Add explicit prepare, unlock, save, relock, and adopt phases.
- Retain the old calibration on save failure and allow retry.
- Block weighted Start after unresolved reacquisition or adoption failure.
- Keep every NVS/flash operation outside the workflow mutex.

## Non-Scope

- Target calibration, physical accuracy claims, API shape changes, or heater
  persistence behavior.

## Implementation Plan

1. Model calibration transaction states in the scale owner.
2. Orchestrate storage outside the synchronization boundary.
3. Add deterministic save, reacquisition, adoption, retry, and recovery tests.
4. Preserve existing calibration/tare API responses.

## Acceptance Criteria

- [x] NVS save never occurs under the workflow mutex.
- [x] Save failure retains the prior calibration and permits retry.
- [x] Reacquisition/adoption failure blocks weighted Start until recovery.
- [x] Calibration API compatibility and fail-safe behavior are preserved.
- [x] Firmware host, sanitizer, and available target checks pass.

## Evidence

- `../evidence/PERF-007-CALIBRATION-TRANSACTION.md`

## Verification Strategy

- Barrier-based storage/lock host tests, capture validation, and target runtime
  evidence when available.

## Dependencies

- PERF-006 complete.

## Files Expected To Change

- `firmware/espresso-machine/components/control/`
- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/host-tests/`
- `docs/TRACKER.md`
