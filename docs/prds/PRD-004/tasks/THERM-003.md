# THERM-003 — Implement deterministic simulator workflows

Status: Todo
Review Mode: Agent
Review Reason: Simulator state, manual time, idempotency, phase boundaries, and reset behavior are deterministic and fully testable.

## Goal

Implement the API v2 compensation and cooldown contract in the development simulator for mobile integration and failure scenarios.

## Scope

- Model Brew-only extraction eligibility and compensation activity by exact extraction phase.
- Model cooldown Start/Stop, target snapshot, pump cutoff at 45 seconds, and five-second stabilization.
- Preserve heater permission independently from the transient cooldown inhibit.
- Implement replay/conflict behavior, disconnect equivalence, power-cycle/reset semantics, and injected sensor/output failures.
- Serve every THERM-001 route and strict error shape.

## Non-Scope

- Firmware scheduling, GPIO behavior, real thermal dynamics, or physical validation.

## Implementation Plan

1. Extend the deterministic model without adding background time.
2. Add strict Hono routes and versioned error mapping.
3. Add controls only where needed for deterministic failure/temperature scenarios.
4. Cover exact transitions, conflicts, replay, reset, and recovery with tests.

## Acceptance Criteria

- [ ] Manual/main, pre-infusion, and soak expose compensation exactly as contracted.
- [ ] Steam Start and Steam transition conflicts are enforced.
- [ ] Cooldown stops pumping at threshold, 45 seconds, or Stop and stabilizes for exactly five seconds.
- [ ] Replay preserves original elapsed time; reset/power-cycle never resumes a workflow.
- [ ] Protocol, simulator tests, and simulator typecheck pass.

## Verification Strategy

- Use manual simulator time and injected readings/failures to test exact and adjacent boundaries, including timer progression after app disconnection.

## Dependencies

- THERM-002 approved.

## Files Expected To Change

- `tools/device-simulator/src/`
- `tools/device-simulator/test/`
- `tools/device-simulator/README.md`
