# HIST-007 — Human mobile and target acceptance

Status: Todo
Review Mode: Human
Human Review Needs: Validate native iPhone graph interaction and synchronization feedback, and provide connected ESP32-C3 runtime resource/timing evidence that is unavailable to automated host checks.

## Goal

Complete the Human/native acceptance gates for PRD-007.

## Scope

- Validate minimize/restore and force-close/reopen at representative durations.
- Inspect thirty-second paging and older-page stability while live samples arrive.
- Validate status/error copy, reboot/overflow gaps, and CSV export.
- Record connected-target history request heap/stack and timing observations.

## Non-Scope

- Energized mains work, certification, or new product behavior.

## Implementation Plan

1. Run the documented native scenarios on the approved test configuration.
2. Record observations and target measurements without exposing credentials.
3. Accept or return specific findings to the owning task.

## Acceptance Criteria

- [ ] Human accepts native paging, synchronization, fallback, gaps, and export behavior.
- [ ] Connected-target evidence satisfies approved resource/timing budgets or records a reviewed exception.
- [ ] Acceptance remains limited to the tested configuration and is not represented as certification.

## Verification Strategy

- Human iPhone exercise and supervised low-voltage/connected-target diagnostics under repository safety rules.

## Dependencies

- HIST-006 complete.

## Files Expected To Change

- `docs/prds/PRD-007/evidence/`
- `docs/TRACKER.md`
- relevant acceptance/status documentation
