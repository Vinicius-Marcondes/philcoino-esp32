# PERF-002 — Bound mobile scale polling

Status: Done
Implementation Commit: `8fee5ab`
Review Mode: Agent
Review Reason: Poll completion, concurrency, and request cadence are
deterministic through injected clocks and clients.

## Goal

Remove stale scale-polling state while preserving completion-driven,
non-overlapping requests at one-second idle cadence and 250 ms only on the
visible Scale page or during acknowledged weighted extraction.

## Scope

- Drive the next delay from the latest validated scale response and current
  Scale-page visibility.
- Keep one request in flight at most and preserve stop/unmount cancellation.
- Keep idle/disconnected polling at one second and approved fast polling at
  250 ms.
- Add deterministic request-rate, transition, failure, and cancellation tests.

## Non-Scope

- Protocol, simulator, firmware, generic Dashboard polling, new dependencies,
  UI redesign, or any other PERF task.

## Implementation Plan

1. Extract a pure completion-driven scale polling session with an injected
   scheduler.
2. Connect `useScale` without restarting an in-flight request for cadence-only
   state changes.
3. Remove generic/manual/timed extraction from the fast-polling decision.
4. Add focused cadence and maximum-concurrency regression coverage.

## Acceptance Criteria

- [x] Idle and disconnected steady-state delay is at least 1,000 ms.
- [x] Scale-page visibility or fresh weighted activity selects 250 ms.
- [x] Returning from weighted to idle state selects 1,000 ms immediately from
  the fresh response.
- [x] Manual and timed extraction do not select fast scale polling.
- [x] Requests never overlap; stop/unmount aborts and prevents late publish.
- [x] Mobile tests, typecheck, and lint pass.

## Completion Evidence

- Added a pure scheduler-injected `ScalePollingSession` that owns the immediate
  read, fresh-response cadence, one timer, one active request, and cancellation.
- `useScale` no longer reads render-closure scale state or recreates polling for
  cadence-only visibility changes.
- Dashboard passes only Scale-page visibility; generic Manual/timed extraction
  state cannot enable fast scale polling.
- PASS — focused polling tests: 6 tests, 21 expectations.
- PASS — complete mobile suite: 173 tests, 1,136 expectations.
- PASS — TypeScript typecheck and warning-free Expo lint.
- Before/after deterministic request-rate evidence is recorded in
  `docs/prds/PRD-013/evidence/PERF-002-MOBILE-POLLING.md`.

## Verification Strategy

- Focused Bun tests with deferred requests and a fake scheduler.
- Complete configured mobile test, typecheck, and lint matrix.

## Dependencies

- PERF-001 locally available unchanged-code baseline captured; unavailable
  connected-target/Human measurements explicitly recorded.

## Files Expected To Change

- `apps/mobile/hooks/use-scale.ts`
- `apps/mobile/src/scale/`
- `apps/mobile/components/dashboard-screen.tsx`
- `apps/mobile/test/`
- `docs/prds/PRD-013/evidence/`
- `docs/TRACKER.md`
