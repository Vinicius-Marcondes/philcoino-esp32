# SIMP-005 — Unify durable shot history

Status: Done
Review Mode: Agent
Review Reason: Storage migrations, recovery state, exports, and navigation helpers are testable.

## Goal

Persist every identified extraction and make Shots the only history list.

## Scope

- Add immediate/reconciled and incomplete shot records with profile snapshots.
- Recover running and terminal stream identities.
- Add the fifth Shots page and remove duplicate lists from console and Scale.

## Non-Scope

- Scale calibration or firmware control changes.

## Implementation Plan

1. Extend shot schema/repository and lifecycle reconciliation.
2. Build history list/detail/export/clear presentation.
3. Simplify the live console and Scale page.

## Acceptance Criteria

- [x] Manual, timed, weighted, stopped, failed, and incomplete shots are retained.
- [x] Profile edits cannot change historical shot meaning.
- [x] Only Shots contains a history list; live controls remain usable.

## Verification Strategy

- Run storage migration, stream, export, navigation, responsive, and localization tests.

## Dependencies

- SIMP-003 and SIMP-004.

## Files Expected To Change

- `apps/mobile/src/history/`
- `apps/mobile/src/telemetry/`
- `apps/mobile/components/`
- `apps/mobile/src/layout/`
