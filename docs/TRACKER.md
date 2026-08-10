# PRD-020 Tracker

PRD Status: Implemented — Native and connected Human acceptance pending
Current Task: [SIMP-006](prds/PRD-020/tasks/SIMP-006.md) — Verify and document the simplified system

Implementation Boundary: Remove machine-history backfill and firmware profile
persistence while preserving one-Hertz state polling, firmware-owned extraction,
short stream replay, and local-only durable histories.

## Summary

Profiles become mobile-only inline Start data, foreground state samples remain
local until clear, and every extraction is presented through one Shots surface.

PRD: `docs/prds/PRD-020/PRD-020.md`

## Compatibility and Safety Boundary

- API generation 2 is a coordinated mobile/firmware cutover with no legacy shim.
- Firmware latches and executes inline profiles; connectivity and telemetry never
  own timing, cutoff, faults, heater, or pump safety.
- The extraction replay ring remains observational and bounded. Connected and
  software evidence do not establish energized physical safety.
- PRD-019 remains Implemented with connected/Human acceptance pending; its
  outstanding extraction-stream evidence is carried into SIMP-006, not marked complete.

## Git

- Branch: `codex/PRD-020-system-simplification`
- Base: `main`
- Merge target: `main`

## Execution State

| Task | Review | Status | Evidence | Decision Log | Commit | Blocked Reason | Requested Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [SIMP-001](prds/PRD-020/tasks/SIMP-001.md) | Agent | Done | [Software verification](prds/PRD-020/evidence/SOFTWARE-VERIFICATION.md) | Coordinated API generation 2 cutover | Pending | None | None |
| [SIMP-002](prds/PRD-020/tasks/SIMP-002.md) | Agent | Done | [Software verification](prds/PRD-020/evidence/SOFTWARE-VERIFICATION.md) | No persisted simulator profiles/history | Pending | None | None |
| [SIMP-003](prds/PRD-020/tasks/SIMP-003.md) | Agent | Done | [Software verification](prds/PRD-020/evidence/SOFTWARE-VERIFICATION.md) | Inline profile remains firmware-latched | Pending | None | None |
| [SIMP-004](prds/PRD-020/tasks/SIMP-004.md) | Agent | Done | [Software verification](prds/PRD-020/evidence/SOFTWARE-VERIFICATION.md) | Status retained until explicit clear | Pending | None | None |
| [SIMP-005](prds/PRD-020/tasks/SIMP-005.md) | Agent | Done | [Software verification](prds/PRD-020/evidence/SOFTWARE-VERIFICATION.md) | One durable Shots surface | Pending | None | None |
| [SIMP-006](prds/PRD-020/tasks/SIMP-006.md) | Human | Implemented — Review pending | [Software verification](prds/PRD-020/evidence/SOFTWARE-VERIFICATION.md) | Physical acceptance remains separate | Pending | Native lifecycle/visual and connected-target evidence | Review five-tab UI, lifecycle, export/clear, latency/timing, heap/stack, SSE, and REST Stop |
