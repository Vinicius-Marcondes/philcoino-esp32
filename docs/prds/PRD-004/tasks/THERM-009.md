# THERM-009 — Validate workflows end to end and align documentation

Status: Todo
Review Mode: Agent
Review Reason: Cross-layer contract scenarios, regression suites, and documentation consistency are deterministic and reviewable without physical operation.

## Goal

Prove mobile, simulator, protocol, and firmware agree on PRD-004 behavior and accurately document the remaining physical boundary.

## Scope

- Add cross-layer scenarios for Steam blocking, compensation phases, cooldown threshold/cutoff/Stop/stabilization, retry, conflict, disconnect, reset, and failures.
- Run all affected configured checks across protocol, simulator, mobile, and firmware.
- Align architecture, API v2 outline, tuning, development, safety, side notes, and review findings.
- Record compatibility, command-state limitations, checks not run, and deferred physical acceptance.

## Non-Scope

- Human visual approval, flashing hardware, low-voltage observation, energized testing, or changing fixed constants from unmeasured assumptions.

## Implementation Plan

1. Add shared scenario coverage and validate all firmware captures.
2. Run the complete affected verification matrix.
3. Update public/internal documentation and unresolved-finding references.
4. Prepare exact THERM-010 and THERM-011 human checklists without executing them.

## Acceptance Criteria

- [ ] All layers agree on state, errors, timing, idempotency, reset, and failure semantics.
- [ ] API v1 and unrelated PRD-002 extraction/profile behavior remain regression-safe.
- [ ] Documentation distinguishes requested/commanded/observed physical state and all evidence levels.
- [ ] Unresolved single-sensor, cutoff, SSR, timing, security, wiring, and enclosure findings remain visible.
- [ ] Every configured affected check passes or is explicitly recorded as unavailable/deferred.

## Verification Strategy

- Run OpenAPI validation; protocol, simulator, and mobile tests/typechecks; mobile lint/config/export; strict firmware host tests; capture validation; and pinned target build when available.

## Dependencies

- THERM-008.

## Files Expected To Change

- Cross-workspace tests and fixtures
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/protocol/api-v2-outline.md`
- `docs/hardware/temperature-control-tuning.md`
- `docs/SAFETY.md`
- `docs/en/SAFETY.md`
- `docs/side-notes.md`
- `CODEBASE_REVIEW_REPORT.md`
