# TCAL-005 — Add the mobile calibration session bridge

Status: Done
Review Mode: Agent
Review Reason: Injected API clients, lifecycle tests, reducer/session tests, and
simulator integration provide deterministic non-visual acceptance.

## Goal

Add mobile networking and lifecycle ownership for calibration so every draft,
heartbeat, cancellation, and Save remains acknowledged by firmware before it is
presented as live state.

## Scope

- Add strict device-client methods for calibration status, start, candidate,
  save, and cancel.
- Add a dedicated calibration session/service rather than placing orchestration
  in the screen component.
- Poll status while the calibration screen is active to renew the 15-second
  firmware lease and display validated raw/effective state.
- Serialize candidate and Save mutations; suppress stale/late responses and
  preserve first-cause cancellation semantics.
- Best-effort cancel on navigation away or backgrounding, while relying on the
  firmware lease for disconnection fail-safe behavior.
- Surface eligibility, expiry, conflict, unsafe target, persistence, sensor,
  and disconnection errors without retaining requested values as live state.
- Integrate with the existing dashboard client and debug/simulator client.

## Non-Scope

- Calibration screen layout, copy, localization, firmware, simulator model,
  target-control redesign, or physical testing.

## Implementation Plan

1. Add strict client methods and response parsing.
2. Implement a single-purpose calibration session with polling, mutation
   serialization, and cancellation ownership.
3. Connect the session to existing dashboard lifecycle/client injection.
4. Add debug-device behavior and simulator integration coverage.
5. Run focused and full mobile non-visual checks.

## Acceptance Criteria

- [x] Mobile accepts only strict validated calibration responses and maps all
  contract-defined errors.
- [x] Candidate drafts never replace acknowledged candidate/live state before a
  valid response.
- [x] Status polling renews the active lease only while the screen session is
  active and never overlaps requests.
- [x] Background, navigation, disconnection, expiry, and late responses cannot
  produce false Save or stale calibrated state.
- [x] Calibration orchestration contains no direct component `fetch` calls.
- [x] Focused tests, full mobile tests, typecheck, and lint pass.

## Completion Evidence

- Full mobile suite: 243 tests and 2,312 expectations passed.
- Focused session suite: 7 tests covering polling, serialization, races,
  lifecycle cancellation, disconnection, expiry, simulator integration, and
  malformed responses.
- Mobile TypeScript typecheck and Expo lint passed.
- Simulator-backed client coverage proves strict start, candidate, Save,
  reload, cancel, and expiry operations through the real injected transport.
- Debug-device coverage proves the same strict acknowledged method surface
  without direct component networking.

## Decision Log

- Calibration orchestration lives in a dedicated session and hook; components
  receive acknowledged state and actions and never issue fetch requests.
- Status reads and mutations share one completion-driven queue, preventing
  overlap and ensuring Save runs after any queued candidate acknowledgement.
- Requested candidates are never written into the acknowledged snapshot.
- Background, navigation, and disconnection invalidate the generation before
  best-effort Cancel; failed Cancel relies on the firmware-owned 15-second
  inactivity lease.
- Contract rejections remain visible with their exact API code, while transport
  and protocol loss clear the snapshot so stale state cannot appear live.

## Verification Strategy

- Use injected clients and fake clocks for polling, lease renewal, serialized
  mutations, cancellation races, stale responses, and lifecycle changes.
- Run simulator-backed start/adjust/save/reload and cancel/expiry flows.

## Dependencies

- TCAL-004 complete.

## Files Expected To Change

- `apps/mobile/src/networking/`
- `apps/mobile/src/dashboard/`
- `apps/mobile/hooks/`
- `apps/mobile/src/debug/`
- `apps/mobile/test/`
- `docs/TRACKER.md`
