# PERF-008 deterministic temperature schedule evidence

Date: 2026-07-26

## Behavior

The temperature owner now retains one 500 ms FreeRTOS wake deadline instead of
delaying 500 ms relative to the end of each iteration. ESP-IDF 6.0.2 removed
the legacy `vTaskDelayUntil` compatibility function, so the implementation uses
the version-correct `xTaskDelayUntil` API with the same fixed-period semantics.

After each wake, wrap-safe arithmetic records only deadline lateness in the
existing bounded temperature timing diagnostic. An overrun of one or more full
periods advances the retained deadline across elapsed slots before the next
wait. This preserves the fixed 500 ms grid without rapid catch-up reads that
could query the MAX6675 before another conversion is ready.

No task priority, control update, prediction, history, display, workflow,
heater-window, or safety-lease policy changed.

## Deterministic coverage

- on-time wake: zero lateness;
- early/non-late tick: zero lateness;
- 25-tick late wake: 25 ticks;
- single- and multi-period deadline catch-up;
- 32-bit tick wrap for lateness and catch-up deadline;
- zero-size diagnostics growth and no hot-path logging.

## Compatibility and safety

- No API/OpenAPI, profile, history, prediction, heater/pump, timeout, fault,
  fail-off, or 1,500 ms heater-lease behavior changed.
- No priority change or broad interrupt-disabled region was introduced.
- No target timing or physical-safety result is inferred from host arithmetic.

## Verification

- PASS — focused native and ASan/UBSan scheduling arithmetic tests.
- PASS — complete native firmware host suite: 7/7.
- PASS — complete ASan/UBSan firmware host suite: 7/7.
- PASS — 32 generated firmware response captures validated.
- NOT RUN — pinned ESP-IDF target build and on-target lateness/load scenarios;
  `idf.py` and `IDF_PATH` remain unavailable.
