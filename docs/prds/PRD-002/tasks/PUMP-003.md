# PUMP-003 — Implement deterministic simulator extraction

Status: Done
Review Mode: Agent
Review Reason: Profile persistence, manual time, idempotency, conflicts, and reset behavior can be verified deterministically without hardware.

## Goal

Implement API v2 profiles and extraction behavior in the development simulator against the approved contract.

## Scope

- Persist an atomic four-slot machine profile set with the two defined defaults.
- Add manually advanced pre-infusion, soak, main, Manual, completion, and 60-second cutoff behavior.
- Implement same-key replay, competing-Start conflict, idle-only profile replacement, and idempotent Stop.
- Keep extraction independent of temperature/heater faults and reset volatile extraction state on power cycle.
- Add simulator-only controls needed for deterministic persistence and failure tests.

## Non-Scope

- Mobile networking, ESP-IDF timing, GPIO behavior, or physical safety evidence.

## Implementation Plan

1. Extend the deterministic model with profile and extraction state.
2. Add authenticated API v2 routes while retaining v1 routes.
3. Add atomic persistence-failure injection and manual-time phase advancement.
4. Cover success, conflict, reset, fault independence, and malformed input scenarios.

## Acceptance Criteria

- [x] Every profile phase transitions exactly at its monotonic simulated deadline.
- [x] Manual stops on request or at 60 seconds, and power cycle always returns idle.
- [x] Same-key replay cannot reset timing and competing Start is rejected.
- [x] Failed or active-time export preserves the prior complete profile set.
- [x] Temperature/heater faults do not interrupt extraction.
- [x] Simulator tests/typecheck and protocol compatibility checks pass.

## Verification Strategy

- Deterministic Bun tests using manual time, injected persistence failures, power cycles, and fault scenarios.

## Dependencies

- PUMP-002 human approval.

## Files Expected To Change

- `tools/device-simulator/src/`
- `tools/device-simulator/test/`

## Implementation Record

### Changed behavior

- Added authenticated API v2 combined state, profile read/replace, extraction Start, and idempotent Stop routes while retaining API v1.
- Added a deterministic extraction timeline for Manual, no-pre-infusion, pre-infusion, soak, main extraction, completion, and 60-second cutoff.
- Added same-key active replay, competing-key conflict with the current acknowledged extraction, empty-slot rejection, and power-cycle idle reset.
- Added atomic complete profile replacement and one-shot `/_simulator/fail-next-profile-save` failure injection.

### Decisions made

- Profile execution snapshots the persisted selected profile at Start; no active-time replacement is permitted.
- Extraction advances only through the existing manual simulator clock and remains independent from temperature mode, readiness, heater permission, and faults.
- Stop clears active extraction/idempotency state and always returns strict idle state.
- Power-cycle preserves targets and profiles but resets extraction/idempotency; full reset restores both seeded profiles and temperature defaults.

### Safety and compatibility impact

- API v1 routes and behavior remain available and temperature-control-only.
- Simulator `running`/`off` represents only the modeled GPIO10 command contract; it provides no firmware, GPIO, SSR, switch, flow, current, or physical safety evidence.
- Temperature faults retain heater fail-off behavior but intentionally do not stop modeled extraction.

### Verification evidence

- PASS — `bun run test:simulator` (43 tests, 212 expectations).
- PASS — `bun run typecheck:simulator`.
- PASS — `bun run validate:openapi`.
- PASS — `bun run test:protocol` (69 tests, 143 expectations).
- PASS — `bun run typecheck:protocol`.
- PASS — `bun run typecheck`.
- PASS — `bun run --cwd apps/mobile test` (69 tests, 217 expectations).
- PASS — `bun run lint`.

### Checks not run

- Firmware host/target, GPIO, low-voltage, and energized checks were not run because PUMP-003 changes only the development simulator.

### Remaining blockers or human acceptance

- None for PUMP-003. Simulator success is explicitly not firmware timing or pump-safety evidence.
