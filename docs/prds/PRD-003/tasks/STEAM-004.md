# STEAM-004 — Review the physical Steam temperature correction

Status: Todo
Review Mode: Human

## Human Review Needs

Vinicius must separately authorize and supervise the exact physical test,
identify the independent reference instrument and probe placement, classify
each observation by evidence level, and decide whether the fixed `+5°C` value
remains acceptable. Qualified review is required before any energized setup or
wiring claim is accepted.

## Goal

Measure whether the owner-selected `+5°C` Steam correction is repeatable on the
actual machine while preserving every existing physical-safety boundary and
without making software implementation contingent on this deferred review.

## Scope

- Define and approve the exact instrumented procedure before physical work.
- Record the independent reference instrument, calibration status, probe
  mounting, firmware build, boiler fill/state, pressure context, ambient
  conditions, heat-soak duration, and supervision.
- Capture paired raw boiler-base and top-reference readings repeatedly near raw
  `110°C`, `115°C`, and `120°C` during rise, steady Steam operation, and
  recovery.
- Compare observed differences with the configured `+5°C` correction and
  record whether the value is retained or requires a new product decision.
- Preserve all independent cutoff, SSR, wiring, enclosure, grounding,
  pressure, single-sensor, and supervision limitations.

## Non-Scope

- Automatically changing firmware constants, adding scaling or a correction
  curve, certifying the machine, or approving unattended operation.
- Treating OLED/API agreement, simulator behavior, host tests, or a target build
  as physical temperature evidence.
- Energized work without separate explicit authorization for the exact setup.

## Implementation Plan

1. Prepare a written test matrix and satisfy every safety precondition before
   authorization.
2. Record paired raw/reference observations and exact environmental/setup
   context across the approved scenarios.
3. Classify variability and identify whether the fixed correction remains
   suitable without silently expanding PRD scope.
4. Record explicit human acceptance, deferral, or a request for a separate
   calibration PRD.

## Acceptance Criteria

- [ ] The exact test setup, instruments, probe locations, firmware build,
  conditions, and authorization are recorded.
- [ ] Repeated paired measurements near raw `110°C`, `115°C`, and `120°C`
  cover rise, steady operation, and recovery, or each unavailable scenario is
  explicitly deferred.
- [ ] Evidence distinguishes raw base readings, corrected firmware values, and
  independent top-reference readings.
- [ ] The reviewer explicitly accepts the fixed `+5°C`, defers judgment, or
  requests a separate scoped calibration change.
- [ ] No scaling or curve is introduced under PRD-003.
- [ ] Documentation retains all unresolved safety findings and accurately
  states the evidence level.

## Verification Strategy

- Human-reviewed written checklist, instrument records, paired measurement log,
  firmware identifier, and explicit acceptance statement.
- Software checks may support traceability but cannot substitute for physical
  measurements.

## Dependencies

STEAM-003. This task is deferred physical acceptance and does not block
STEAM-001 through STEAM-003.

## Files Expected To Change

- `docs/hardware/temperature-control-tuning.md`
- `docs/SAFETY.md`
- `docs/en/SAFETY.md`
- `docs/side-notes.md`
- `docs/TRACKER.md`
- `CODEBASE_REVIEW_REPORT.md`

## Stop Conditions

- Stop before any physical or energized work until the exact procedure and
  setup receive separate explicit authorization under `docs/SAFETY.md`.
- Stop immediately for implausible readings, uncontrolled heating, unexpected
  SSR behavior, cutoff concerns, leaks, pressure concerns, wiring/enclosure
  issues, or loss of independent instrumentation.
