# SIMP-006 — Verify and document the simplified system

Status: Implemented — Human review pending
Review Mode: Human

## Goal

Align durable documentation and record complete software plus deferred Human evidence.

## Scope

- Update architecture, development, safety, public behavior, protocol outline,
  side notes, and tracker evidence.
- Run the affected full verification matrix and prepare native/connected review.

## Non-Scope

- Energized heater-safety approval or unrelated review findings.

## Implementation Plan

1. Align ownership, persistence, compatibility, and evidence documentation.
2. Run configured protocol/mobile/simulator/firmware checks.
3. Record unresolved native and connected-target acceptance explicitly.

## Acceptance Criteria

- [x] Documentation matches implemented routes, storage, UI, and safety authority.
- [x] Automated evidence is recorded without overstating physical validation.
- [ ] Human review checklist covers five-tab layout and connected performance.

## Verification Strategy

- Execute the repository verification matrix and inspect the final diff.

## Dependencies

- SIMP-001 through SIMP-005.

## Files Expected To Change

- `docs/`
- `README.md`
- `CONTRIBUTING.md`

## Human Review Needs

- Review native iOS/Android navigation, lifecycle, export/clear, and connected
  target latency/timing. No energized heater test is inferred.
