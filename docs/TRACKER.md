# PRD-005 Tracker

PRD Status: Implementation Complete — Acceptance Blocked
Current Task: FWAPI-007

Implementation Boundary: FWAPI-001 through FWAPI-007 incrementally freeze and
decompose the firmware API codec without changing API v1/v2 behavior. FW-005
encrypted identity/session work and physical heater/pump validation remain
separate and must not be inferred from this refactor.

## Summary

Characterize the existing firmware API, extract generic JSON and typed domain
codecs, consolidate route/current-bearer policy, add deterministic
sanitizer-backed mutation coverage, and preserve target resource budgets.

PRD: `docs/prds/PRD-005/PRD-005.md`

## Compatibility and Safety Boundary

- API v1/v2 routes, exact deterministic responses, strict rejection, errors,
  authentication challenges, and controller/storage semantics remain unchanged.
- Unauthorized protected requests must still be rejected before body reads;
  transport bounds and deadlines stay owned by the ESP-IDF adapter.
- Codecs never own locks, persistence, controllers, outputs, or network I/O.
- Host, sanitizer, capture, and target-build results are software evidence, not
  physical de-energization, timing, wiring, or mains-safety evidence.
- PRD-005 completes before FW-005 changes routing/authentication.

## Git

- Planned branch: `feature/PRD-005-firmware-api-codec`
- Base: `main`
- Merge target: `main`

## Execution State

| Task | Review | Status | Evidence | Decision Log | Commit | Blocked Reason | Requested Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [FWAPI-001](prds/PRD-005/tasks/FWAPI-001.md) | Agent | Done | [Evidence](prds/PRD-005/evidence/IMPLEMENTATION.md) | Approved PRD decisions | Pending | None | None |
| [FWAPI-002](prds/PRD-005/tasks/FWAPI-002.md) | Agent | Done | [Evidence](prds/PRD-005/evidence/IMPLEMENTATION.md) | No dependency added | Pending | None | None |
| [FWAPI-003](prds/PRD-005/tasks/FWAPI-003.md) | Agent | Done | [Evidence](prds/PRD-005/evidence/IMPLEMENTATION.md) | Byte-stable extraction | Pending | None | None |
| [FWAPI-004](prds/PRD-005/tasks/FWAPI-004.md) | Agent | Done | [Evidence](prds/PRD-005/evidence/IMPLEMENTATION.md) | Byte-stable extraction | Pending | None | None |
| [FWAPI-005](prds/PRD-005/tasks/FWAPI-005.md) | Agent | Done | [Evidence](prds/PRD-005/evidence/IMPLEMENTATION.md) | Current bearer only | Pending | None | None |
| [FWAPI-006](prds/PRD-005/tasks/FWAPI-006.md) | Agent | Done | [Evidence](prds/PRD-005/evidence/IMPLEMENTATION.md) | Deterministic runner; no install | Pending | None | None |
| [FWAPI-007](prds/PRD-005/tasks/FWAPI-007.md) | Agent | Blocked | [Evidence](prds/PRD-005/evidence/IMPLEMENTATION.md) | Static budgets pass | Pending | Connected target/per-stage snapshots unavailable | Provide ESP32-C3 target runtime evidence; decide whether final cumulative static evidence is sufficient for the missed incremental snapshots |
