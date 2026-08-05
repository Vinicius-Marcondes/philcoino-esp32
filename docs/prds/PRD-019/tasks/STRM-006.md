# STRM-006 — Generalize extraction history and presentation

Status: Done
Review Mode: Agent
Review Reason: Schema migration, CSV, view models, localization, and component behavior are testable; native visuals remain a later Human gate.

## Goal

Store, inspect, clear, and export every extraction through one history surface.

## Scope

- Generalize weighted summaries/traces, migrate existing SQLite rows, remove
  automatic pruning, add nullable all-shot fields, and preserve mobile-derived flow.
- Move unified history access to the extraction console and show heater command
  as observational data.

## Non-Scope

- New navigation destination, automatic retention, cloud backup, or physical-state claims.

## Implementation Plan

1. Define generalized summaries/traces and migration.
2. Align repository, CSV, flow, and export behavior.
3. Add console history entry, all-mode labels, detail, and localization.

## Acceptance Criteria

- [x] Existing weighted records migrate without deletion or duplication.
- [x] Manual/timed/weighted histories preserve real weight/flow gaps and remain until clear.
- [x] Unified summary and trace CSVs include heater command and nullable weight fields.
- [x] Mobile tests, typecheck, and lint pass.

## Verification Strategy

- Run repository/migration/export/component tests, typecheck, lint, and native visual review when available.

## Dependencies

- STRM-005.

## Files Expected To Change

- `apps/mobile/src/history/`
- `apps/mobile/components/`
- `apps/mobile/src/localization/`
- `apps/mobile/test/`
