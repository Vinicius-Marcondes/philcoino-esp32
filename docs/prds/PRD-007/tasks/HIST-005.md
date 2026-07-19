# HIST-005 — Present synchronized thirty-second history

Status: Done
Review Mode: Agent
Review Reason: Window boundaries, follow-latest behavior, localization, accessibility, and graph state are deterministic with automated component/helper tests.

## Goal

Render recovered history in horizontally scrollable thirty-second Live windows with non-blocking synchronization feedback.

## Scope

- Change Live windows to thirty seconds while preserving Today.
- Preserve paging, hidden scrollbar, and latest/older-page navigation behavior.
- Add localized restoring and history-sync failure presentation.
- Extend gap handling for boot identity and truncated history.

## Non-Scope

- Contract, firmware, storage schema, or new graph libraries.

## Implementation Plan

1. Update pure window/gap helpers and tests.
2. Bind sync status/error to the graph without affecting controls.
3. Verify follow-latest and older-page stability during inserted/live samples.

## Acceptance Criteria

- [x] Live opens on and follows the newest thirty-second page.
- [x] Older pages remain selected while new samples arrive.
- [x] Multiple pages remain horizontally scrollable with no visible scrollbar.
- [x] Today, CSV, accessibility, localization, mobile tests, and typecheck remain valid.

## Completion Evidence

- Live uses stable consecutive thirty-second clock boundaries and opens at the
  newest window.
- Stable window keys plus remembered offsets preserve an older inspected page
  when backfill inserts earlier pages; only a latest-following user scrolls to
  a newly created latest page.
- Horizontal paging and the hidden scrollbar remain enabled for multiple pages.
- Gap detection now considers explicit truncation/reset starts, boot changes,
  sequence skips, uptime discontinuity, timestamp discontinuity, and device ID.
- Added localized English and Brazilian Portuguese restoring/warning copy;
  Today downsampling and the existing CSV schema are unchanged.

## Verification Strategy

- Run focused graph/history tests, mobile tests, typecheck, lint, and web export.

## Dependencies

- HIST-004 complete.

## Files Expected To Change

- `apps/mobile/components/dashboard-screen.tsx`
- `apps/mobile/src/history/`
- `apps/mobile/src/localization/`
- `apps/mobile/test/`
