# THERM-003 — Implement deterministic simulator workflows

Status: Done
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

- [x] Manual/main, pre-infusion, and soak expose compensation exactly as contracted.
- [x] Steam Start and Steam transition conflicts are enforced.
- [x] Cooldown stops pumping at threshold, 45 seconds, or Stop and stabilizes for exactly five seconds.
- [x] Replay preserves original elapsed time; reset/power-cycle never resumes a workflow.
- [x] Protocol, simulator tests, and simulator typecheck pass.

## Verification Strategy

- Use manual simulator time and injected readings/failures to test exact and adjacent boundaries, including timer progression after app disconnection.

## Dependencies

- THERM-002 approved.

## Files Expected To Change

- `tools/device-simulator/src/`
- `tools/device-simulator/test/`
- `tools/device-simulator/README.md`

## Completion Evidence

### Changed behavior

- API v2 simulator state now serves strict compensation and cooldown snapshots
  directly; the temporary THERM-002 mobile test envelope was removed.
- Extraction Start is Brew-only. Manual and profile main extraction acknowledge
  active compensation when heater permission/fault state allow it;
  pre-infusion and soak acknowledge inactive compensation. The simulator's
  logical heater-control target uses the fixed `+2°C` bias clamped to `97°C`
  without changing the displayed/persisted Brew target or readiness target.
- Authenticated cooldown Start/Stop routes implement target snapshot, Steam to
  Brew transition, independent heater inhibit, command ordering, 45-second
  cutoff, target/Stop termination, five-second stabilization, retained terminal
  outcomes, same-key replay, and idempotent Stop.
- Active extraction/cooldown/profile/Steam conflicts are enforced. Manual time
  continues without a client, while reset and power-cycle clear volatile
  workflow identity and never resume a pump command.
- A development-only failure control can arm one `heater-off`, `pump-running`,
  or `pump-off` command failure. Sensor/output failures produce a machine fault,
  terminal failed cooldown acknowledgement, and off command state.

### Decisions

- Cooldown elapsed time is total acknowledged workflow time: pumping elapsed
  plus stabilization elapsed. Pumping always satisfies
  `elapsedMs + remainingMs = 45_000`; stabilization remaining starts at exactly
  `5_000` and reaches terminal only after the full interval.
- Same-key replay is checked before terminal re-eligibility, so it returns the
  retained identity and timing. A different key may replace a terminal record
  only after current fault/temperature checks pass.
- The existing API v1 mode path and error schema remain unchanged. A request to
  enter Steam during either active workflow is rejected with its existing v1
  conflict code plus an actionable message; API v2 workflow operations retain
  their distinguishable strict conflict payloads.
- Simulator temperature and output behavior remain deterministic logical UI/API
  evidence. Command state never claims flow, cooling, current, SSR state,
  switch state, or physical de-energization.

### Compatibility and safety impact

- API v1 paths and success shapes are unchanged; API v2 now fulfills all
  THERM-001 additions. Existing v1 clients only observe the newly required
  rejection when attempting Steam during an active workflow.
- Profiles, persisted targets, heater permission, readiness, over-temperature
  limits, and reset persistence retain their existing ownership and semantics.
- No firmware, GPIO, scheduling, physical thermal model, or energized behavior
  changed. Simulator success is not firmware or heater/pump safety evidence,
  and no review finding is closed.

### Verification evidence

- `bun run validate:openapi` — passed.
- `bun run test:protocol` — passed: 111 tests / 224 expectations.
- `bun run typecheck:protocol` — passed.
- `bun run test:simulator` — passed: 59 tests / 359 expectations. Coverage
  includes exact phase boundaries, fixed compensation eligibility, Brew/Steam
  conflicts, target/44,999/45,000 ms cutoff boundaries, 4,999/5,000 ms
  stabilization, replay, Stop, mutual exclusion, disconnect-equivalent manual
  advancement, fault/output failures, and reset/power-cycle.
- `bun run typecheck:simulator` — passed.
- `bun test apps/mobile/test` — passed: 89 tests / 286 expectations against the
  real simulator v2 state envelope.
- Mobile typecheck and Expo lint passed after removing the temporary bridge.

### Checks not run

- Firmware host tests, captures, target build, native mobile rendering, and
  physical checks were not run because THERM-003 changes only deterministic
  simulator behavior plus its existing mobile integration tests.
- No package, program, CLI, SDK, or dependency was installed.

### Remaining blockers and human acceptance

- No Agent blocker remains for THERM-003.
- THERM-002 Human acceptance was deferred when this Agent task completed and
  was later accepted by the owner on 2026-07-16, as recorded in
  `docs/prds/PRD-004/HUMAN_REVIEW.md`.
