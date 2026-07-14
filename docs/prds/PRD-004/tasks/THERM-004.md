# THERM-004 — Integrate mobile cooldown and compensation state

Status: Todo
Review Mode: Agent
Review Reason: Strict parsing, acknowledged mutations, retry identity, polling races, and simulator integration are deterministic and testable after visual approval.

## Goal

Connect the approved mobile experience to API v2 while preserving acknowledged-state and cancellation guarantees.

## Scope

- Add strict cooldown API client operations and combined-state parsing.
- Extend serialized dashboard mutations for cooldown Start/Stop and workflow conflicts.
- Reuse a Start idempotency key after an unacknowledged transport outcome.
- Show compensation and cooldown only from validated acknowledgements.
- Disable conflicting extraction/profile/Steam actions with approved guidance.
- Integrate against deterministic simulator scenarios, localization, and accessibility behavior.

## Non-Scope

- Firmware implementation, changing the approved design without review, or physical-state claims.

## Implementation Plan

1. Extend the injected API client and strict error taxonomy.
2. Add cooldown mutations to the existing serialized polling/mutation session.
3. Connect acknowledged state to the THERM-002 presentation.
4. Add race, retry, rejection, disconnect, and simulator integration tests.

## Acceptance Criteria

- [ ] Requested cooldown/compensation values never appear as live state before acknowledgement.
- [ ] Start retry preserves its key and firmware deadline; Stop is idempotent.
- [ ] Polling never overlaps or overwrites acknowledgements, and disconnect clears unavailable live state.
- [ ] Steam/conflict/fault/cutoff outcomes remain distinguishable and actionable.
- [ ] Mobile tests, lint, typecheck, Expo config, web export, and simulator integration pass.

## Verification Strategy

- Unit-test the client and mutation session; run mobile-to-simulator scenarios for Start, replay, Stop, threshold, cutoff, stabilization, failure, and reconnect.

## Dependencies

- THERM-003.

## Files Expected To Change

- `apps/mobile/src/networking/`
- `apps/mobile/src/dashboard/`
- `apps/mobile/hooks/`
- `apps/mobile/components/`
- `apps/mobile/src/localization/`
- `apps/mobile/test/`
