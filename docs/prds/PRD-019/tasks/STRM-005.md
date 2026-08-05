# STRM-005 — Implement the mobile stream lifecycle

Status: Done
Review Mode: Agent
Review Reason: Injected fetch, schedulers, lifecycle events, and repositories make the behavior deterministic in tests.

## Goal

Consume, validate, persist, and resume extraction SSE while removing extraction-time scale/trace polling.

## Scope

- Add the incremental `expo/fetch` SSE parser and retrying cursor session.
- Abort/resume with AppState, keep one-Hertz state polling, suppress scale/trace
  polling while streaming is expected, and expose degraded/unsupported states.

## Non-Scope

- UI redesign, cloud sync, background execution guarantees, or REST command changes.

## Implementation Plan

1. Add an injected strict stream client and chunk parser.
2. Add lifecycle/retry/session orchestration with commit-before-cursor.
3. Replace the runtime weighted trace poller and test no-fallback behavior.

## Acceptance Criteria

- [x] Fragmented/multiple/malformed SSE events are handled strictly.
- [x] Retries use 250/500/1000/2000 ms and resume only after durable commit.
- [x] Stream failure never blocks acknowledged Start/Stop or hides the one-Hertz fault state.
- [x] Mobile tests and typecheck pass.

## Verification Strategy

- Run mobile tests and typecheck with injected stream/failure scenarios.

## Dependencies

- STRM-001 and STRM-002.

## Files Expected To Change

- `apps/mobile/src/networking/`
- `apps/mobile/src/scale/`
- `apps/mobile/hooks/`
- `apps/mobile/test/`
