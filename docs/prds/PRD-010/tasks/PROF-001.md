# PROF-001 — Add reviewed profile import and reliable synchronization

Status: Done
Review Mode: Agent
Review Reason: Import data flow, persistence ordering, recovery, and state
transitions are deterministic and testable; native layout remains a separate
Human acceptance item.

## Goal

Import the selected ESP32's complete profile set into mobile storage after an
explicit slot-by-slot review while resolving the profile read/save reliability
issues required by that workflow.

## Scope

- Recover local and remote profile loading independently.
- Serialize local editor and import writes with revision-safe publication.
- Add fresh machine read, comparison, confirmation, cancellation, and feedback.
- Add responsive localized UI, debug behavior, tests, and documentation.

## Non-Scope

- Protocol, simulator model, firmware, per-machine profile storage, partial
  merges, security migration, or physical validation.

## Implementation Plan

1. Add focused profile synchronization state and pure comparison helpers.
2. Connect fresh machine reads and serialized local persistence to the dashboard.
3. Add reviewed import controls to the Profiles page in both layouts.
4. Cover success, recovery, cancellation, and race behavior and update docs.

## Acceptance Criteria

- [x] Import is fresh, validated, reviewed, complete-set, and local-only.
- [x] Local state changes only after successful persistence.
- [x] Stale reads/writes cannot publish over newer state.
- [x] Initial remote failure recovers without remounting.
- [x] Blocking, feedback, localization, and debug behavior match PRD-010.
- [x] Configured affected checks pass and Human review is tracked separately.

## Completion Evidence

- Added a focused synchronization session with independent local/remote loads,
  abortable deduplicated reads, reconnect/focus retry, serialized local writes,
  revision-safe publication, and reviewed whole-set import.
- Added responsive Profiles-page review controls and English/Portuguese copy;
  import remains available during cooldown but disabled for extraction, stale
  connectivity, and conflicting profile work.
- PASS — mobile Bun suite: 158 tests, 1,045 expectations.
- PASS — simulator Bun suite: 65 tests, 410 expectations.
- PASS — mobile TypeScript typecheck and Expo lint.
- PASS — Expo public config inspection and debug web static export.
- Protocol and firmware checks were not run because no wire or firmware source
  changed. Native visual/touch acceptance is recorded in PROF-002.

## Verification Strategy

- Bun unit/component-model tests with deferred reads/writes and injected errors.
- Mobile typecheck and lint.
- Existing simulator integration regression suite.
- Human native portrait/landscape visual review in PROF-002.

## Dependencies

- PRD-010 approved.

## Files Expected To Change

- `apps/mobile/src/profiles/`
- `apps/mobile/hooks/use-machine-dashboard.ts`
- `apps/mobile/components/`
- `apps/mobile/test/`
- localization and architecture/review documentation
