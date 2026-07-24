# PRD-011 performance investigation evidence

Date: 2026-07-24

Commit under investigation: `fa6d67e` (`0.3.2`).

Implemented:

- default-off serial-only firmware performance instrumentation;
- prediction-disabled A/B build profile with unchanged response shape;
- request, heap, stack, session, controller, prediction, mutex, reset, and
  Wi-Fi metrics;
- dependency-free Bun load harness for state, prediction, history, and combined
  contention;
- deterministic regressions for prediction observer cleanup and mobile
  cross-session contention;
- severity-ranked review and hardware test matrix.

Build evidence:

- firmware host/sanitizer suite: 7/7 passed;
- firmware contract captures: 31/31 validated;
- protocol: 128 tests, typecheck, and OpenAPI validation passed;
- simulator: 67 tests and typecheck passed;
- mobile: 164 tests, typecheck, and lint passed;
- load harness: 3 tests and typecheck passed;
- ESP32-C3 diagnostics-off target build: passed, 1,148,960-byte binary;
- ESP32-C3 diagnostics-on target build: passed, 1,155,504-byte binary;
- ESP32-C3 diagnostics/no-prediction target build: passed,
  1,155,632-byte binary.

Pending:

- instrumented hardware flash and serial/load matrix;
- p50/p95/p99 target results and long-run heap/socket trends;
- human low-voltage acceptance.

No energized heater validation was performed or authorized.
