# HIST-004 — Synchronize and merge history on mobile

Status: Done
Review Mode: Agent
Review Reason: Transport lifecycle, timestamp mapping, SQLite migration, cursor durability, and fallback are deterministic and testable.

## Goal

Backfill device history into current-day mobile storage without blocking live behavior.

## Scope

- Add strict client history requests and an abortable lifecycle session.
- Anchor uptime to phone UTC and commit pages with durable cursors.
- Migrate SQLite for source boot/sequence metadata and overlap replacement.
- Preserve older-firmware fallback, current-day pruning, and CSV columns.

## Non-Scope

- Graph layout changes, background polling, multi-day retention, or firmware behavior.

## Implementation Plan

1. Add API client and pure synchronization/mapping helpers.
2. Extend repositories with transactional page merge and cursor operations.
3. Bind synchronization after fresh state and expose non-blocking status/error state.
4. Cover cancellation, restart, partial failure, reset, truncation, and fallback.

## Acceptance Criteria

- [x] Fresh live state and controls do not wait for history.
- [x] Pages resume only after durable cursor commits and do not duplicate rows.
- [x] Reboots/overflow remain gaps and older firmware falls back cleanly.
- [x] Mobile tests and typecheck pass without changing CSV columns.

## Completion Evidence

- Added strict authenticated history requests, abortable foreground sessions,
  first-page midpoint anchoring, and per-page incremental refresh.
- SQLite schema version 3 stores nullable boot/sequence provenance, explicit
  gap starts, a unique device-origin index, and transactional durable cursors.
- Page merge replaces overlapping phone-origin rows while leaving CSV columns
  and current-local-day pruning unchanged.
- HTTP 404 silently retains foreground-only history; other history failures
  remain graph-scoped and do not change polling, controls, or mutations.
- Mobile typecheck, lint, and 129 tests with 850 expectations pass, including
  partial-page failure, cursor restart, simulator pagination, and reboot reset.

## Verification Strategy

- Run focused mobile history/network/lifecycle tests, full mobile tests, typecheck, and lint.

## Dependencies

- HIST-003 complete.

## Files Expected To Change

- `apps/mobile/src/networking/`
- `apps/mobile/src/history/`
- `apps/mobile/hooks/`
- `apps/mobile/test/`
