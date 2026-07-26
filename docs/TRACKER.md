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
- Existing API v1 and queryless API v2 state/mutation payloads remain unchanged;
  PRD-012 adds an opt-in prediction state variant while history uses the current
  protected-route authentication policy.
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
| [HIST-007](prds/PRD-007/tasks/HIST-007.md) | Human | Todo | Partial owner evidence: complete bounded pages, stable boot ID under repeated stress, and gap-free one-minute reopen; 0.3.2 retest pending | Gap-only recovery and stable timestamp page identity | Pending | Connected-target resource evidence unavailable | Flash/test 0.3.2 and complete target timing/resource checks |

## PRD-011 Brew by weight

PRD: `docs/prds/PRD-011/PRD-011.md`

Software status: Implemented on 2026-07-23. Protocol, deterministic simulator,
firmware host policy/adapters, mobile Scale page, local defaults, 90-day
history, and CSV export are present. This does not advance or replace the
pending PRD-007 Human task above.

Human status: Disconnected low-voltage HX711/load-cell wiring, GPIO0/GPIO1 boot
behavior, sample cadence, 0/35/100 g repeatability, automatic tare, and injected
disconnect validation remain Todo. Energized compensation tuning requires
separate authorization.

## PRD-012 Passive predictive boiler-temperature diagnostics

PRD: `docs/prds/PRD-012/PRD-012.md`

Software status: Passive prediction diagnostics are implemented without
connecting prediction output to the authoritative heater command path.

Human status: Connected-target resource/timing checks and passive physical
validation remain pending.
