# PERF-006 cached scale evidence

Date: 2026-07-26

## Behavior

`ScaleController` now computes median, raw spread, stability inputs, and
calibrated gross weight once when an accepted HX711 sample enters the rolling
window. Consumer snapshots copy those cached values and apply only wrap-safe
sample-age, transport-failure, and calibration-state gating.

`kNotReady` remains visible to task-side timeout diagnostics, but it bypasses
the workflow mutex and controller publication entirely. Transport error and
saturation still publish immediately so availability fails without waiting for
sample-age expiry.

Automatic tare, weight cutoff, timer fallback, warning acknowledgement, and the
bounded post-extraction settling window retain their existing controller paths.

## Before/after bounds

| Operation | Before | After |
| --- | --- | --- |
| `ScaleController::snapshot` derived work | Up to 10-value min/max and sort plus conversion per consumer | O(1) cached copy plus age/status gating |
| `kNotReady` workflow-mutex acquisitions | One per 750 ms timeout after PERF-005 | Zero |
| Accepted-sample derived refresh | Recomputed by each consumer | Once per accepted sample |
| Unavailable sample-age boundary | 750 ms | 750 ms |

These are deterministic source/host bounds; target CPU and mutex timing were
not measured.

## Compatibility and safety

- No API, schema, ISR, acquisition timeout, priority, calibration persistence,
  heater/pump, profile, history, prediction, fault, or fail-off behavior
  changed.
- No NVS/flash operation was moved into the workflow mutex.
- No physical or energized safety validation is inferred.

## Verification

- PASS — focused native and ASan/UBSan scale regressions covering cached
  `NotReady` behavior, saturation, recovery, age expiry, and tick wrap.
- PASS — complete native firmware host suite: 7/7.
- PASS — complete ASan/UBSan firmware host suite: 7/7.
- Existing weighted extraction tests cover automatic tare, cutoff, fallback,
  acknowledgement, and terminal settling behavior.
- NOT RUN — target diagnostics/build; the pinned ESP-IDF toolchain remains
  unavailable.
