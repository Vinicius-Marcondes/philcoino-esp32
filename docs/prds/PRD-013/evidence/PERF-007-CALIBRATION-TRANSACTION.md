# PERF-007 calibration transaction evidence

Date: 2026-07-26

## Behavior

Scale calibration completion is now an explicit three-phase transaction:

1. Under the workflow mutex, validate the workflow/reference/sample window and
   prepare an immutable calibration candidate with a monotonic token.
2. Release the mutex and save that candidate through
   `ScaleCalibrationStorage`.
3. Reacquire the mutex and adopt only the candidate/token that is still
   pending.

`ScaleController` no longer owns or calls storage, so controller operations
cannot perform NVS I/O under synchronization. The API storage fake asserts that
the workflow lock is not held for every save.

A failed save clears only the pending transaction after reacquisition; the old
calibration remains intact and completion can be retried. If save succeeds but
reacquisition/adoption fails, the immutable pending transaction remains:
calibration reports `calibrating`, Cancel cannot clear it, and weighted Start
returns the existing `scale_not_calibrated` conflict with the pump off. Repeating
completion with the same reference re-saves and adopts the same candidate.
Token/candidate mismatches cannot acknowledge another transaction.

## Compatibility and safety

- Calibration routes, bodies, success shapes, status codes, and existing
  `persistence_failure`, `calibration_in_progress`, and
  `scale_not_calibrated` error shapes remain within the unchanged contract.
- No OpenAPI/public schema, physical calibration policy, automatic tare,
  heater/pump, timeout, fault, or fail-off behavior changed.
- The only scale-calibration NVS save now occurs outside the workflow mutex.
- No accuracy, connected-hardware, or energized safety validation is inferred.

## Verification

- PASS — storage fake asserts every calibration save observes
  `synchronization.held == false`.
- PASS — focused controller transaction tests: save failure, old-calibration
  retention, retry, pending Cancel guard, token mismatch, candidate mismatch,
  and successful adoption.
- PASS — focused API tests: persistence failure/retry, post-save reacquisition
  failure, unresolved weighted-Start block, and recovery.
- PASS — complete native firmware host suite: 7/7.
- PASS — complete ASan/UBSan firmware host suite: 7/7.
- PASS — 32 generated firmware response captures validated.
- NOT RUN — pinned ESP-IDF target build and connected NVS/flash-stall runtime;
  the existing target toolchain and hardware remain unavailable.
