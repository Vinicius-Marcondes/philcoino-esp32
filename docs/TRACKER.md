# PRD-019 Tracker

PRD Status: Implemented — Pinned target and Human acceptance pending
Current Task: [STRM-007](prds/PRD-019/tasks/STRM-007.md) — Verify connected behavior

Implementation Boundary: Replace extraction-time scale/trace polling with one
authenticated local SSE stream for every extraction while retaining firmware
authority, one-Hertz combined-state polling, and acknowledged REST mutations.

## Summary

Stream resumable 250 ms temperature, command, phase, timing, and nullable scale
telemetry; preserve real gaps; derive flow on mobile; and generalize local
history without cloud services or automatic pruning.

PRD: `docs/prds/PRD-019/PRD-019.md`

## Compatibility and Safety Boundary

- `/api/v2/extractions/stream` is additive; existing REST and
  `/api/v2/scale/trace` shapes remain compatible.
- The new mobile requires streaming and does not fall back to high-frequency
  trace polling, but keeps one-Hertz state/fault polling and REST Stop usable.
- Telemetry is observation-only. Heater/pump fields remain firmware commands,
  flow remains phone-derived, and none prove physical state.
- Capture, serialization, transmission, storage, and UI remain outside firmware
  control/safety authority and physical acceptance.

## Git

- Planned branch: `feature/PRD-019-local-extraction-streaming`
- Base: `main`
- Merge target: `main`

## Execution State

| Task | Review | Status | Evidence | Decision Log | Commit | Blocked Reason | Requested Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [STRM-001](prds/PRD-019/tasks/STRM-001.md) | Agent | Done | OpenAPI validation; protocol typecheck; 169 tests | Additive SSE; `/scale/trace` compatible | Pending | None | None |
| [STRM-002](prds/PRD-019/tasks/STRM-002.md) | Agent | Done | Simulator typecheck; 99 tests | Manual time publishes without sleeps | Pending | None | None |
| [STRM-003](prds/PRD-019/tasks/STRM-003.md) | Agent | Done | Native and ASan/UBSan host suites: 11/11 | Separate 320-sample zero-wait ring | Pending | None | None |
| [STRM-004](prds/PRD-019/tasks/STRM-004.md) | Agent | In Review | Host suites pass; target source implemented | One async subscriber; disconnect on send failure | Pending | `idf.py` unavailable; connected budgets unmeasured | Run pinned ESP-IDF 6.0.2 build and connected worksheet |
| [STRM-005](prds/PRD-019/tasks/STRM-005.md) | Agent | Done | Mobile typecheck; parser/session/integration tests | 404 unsupported; no polling fallback | Pending | None | None |
| [STRM-006](prds/PRD-019/tasks/STRM-006.md) | Agent | Done | Migration/history/CSV/UI tests; lint | Unlimited retention until explicit clear | Pending | Native visual review is part of STRM-007 | None |
| [STRM-007](prds/PRD-019/tasks/STRM-007.md) | Human | In Review | Automated matrix recorded in side notes | Connected evidence remains separate from safety | Pending | Target/native devices and instrumentation unavailable | Review native UI and connected target metrics |
