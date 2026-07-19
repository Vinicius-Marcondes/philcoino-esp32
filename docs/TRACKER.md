# PRD-007 Tracker

PRD Status: Active
Current Task: HIST-007

Implementation Boundary: Add bounded observational device history, strict
history retrieval, mobile backfill, and thirty-second graph paging without
changing firmware control authority or existing API v1/v2 wire shapes.

## Summary

Capture ten minutes of one-Hertz ESP32 RAM history, synchronize it into the
phone's current-day SQLite history after reconnection, preserve real gaps, and
keep the Dashboard live while backfill runs.

PRD: `docs/prds/PRD-007/PRD-007.md`

## Compatibility and Safety Boundary

- History is observational RAM-only state and never participates in heater,
  pump, fault, timeout, readiness, target, or mutation decisions.
- Existing API v1 and v2 state/mutation payloads remain unchanged; the new
  endpoint uses the current protected-route authentication policy.
- Firmware history work must be bounded and must not make the control loop wait.
- Software and target-build evidence do not prove physical operation,
  de-energization, flow, cooling, wiring, or mains safety.

## Git

- Planned branch: `feature/PRD-007-device-history`
- Base: `main`
- Merge target: `main`

## Execution State

| Task | Review | Status | Evidence | Decision Log | Commit | Blocked Reason | Requested Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [HIST-001](prds/PRD-007/tasks/HIST-001.md) | Agent | Done | Protocol validation; 123 tests; typecheck | Approved PRD decisions | Pending | None | None |
| [HIST-002](prds/PRD-007/tasks/HIST-002.md) | Agent | Done | 65 simulator tests; typecheck | Deterministic boot IDs; fixed paging | Pending | None | None |
| [HIST-003](prds/PRD-007/tasks/HIST-003.md) | Agent | Done | Native/sanitizer 6/6; 30 captures | Zero-wait atomic history lock | Pending | Target environment unavailable | Provide target evidence in HIST-006/007 |
| [HIST-004](prds/PRD-007/tasks/HIST-004.md) | Agent | Done | Mobile 133 tests; typecheck; lint | Native-safe cancellation; exclusive idempotent page/cursor commit | Pending | None | None |
| [HIST-005](prds/PRD-007/tasks/HIST-005.md) | Agent | Done | 30 s window/gap/follow tests; localization | Rolling newest window; user-driven follow state | Pending | None | None |
| [HIST-006](prds/PRD-007/tasks/HIST-006.md) | Agent | Done | All configured host/workspace checks pass | Host evidence is not target evidence | Pending | Target toolchain unavailable | Complete target evidence in HIST-007 |
| [HIST-007](prds/PRD-007/tasks/HIST-007.md) | Human | Todo | Pending | Pending | Pending | None | None |
