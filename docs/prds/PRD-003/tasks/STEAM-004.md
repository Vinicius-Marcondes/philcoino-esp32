# STEAM-004 — Review the physical Steam temperature correction

Status: Done — Human Accepted 2026-07-16
Review Mode: Human

## Human Review Needs

Completed on 2026-07-16 through Vinicius's owner-reported instrumented
acceptance of the tested configuration and the fixed `+5°C` value.

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

- [x] The owner reported using technical equipment to check the energy-control
  behavior on the tested configuration.
- [x] The owner reported that all implemented Steam behavior worked as expected.
- [x] The evidence is classified as owner-reported instrumented testing rather
  than an independently retained measurement record.
- [x] The reviewer accepts and retains the fixed `+5°C` correction.
- [x] No scaling or curve is introduced under PRD-003.
- [x] Documentation retains unresolved engineering findings and accurately
  states the evidence level.

## Verification Strategy

- Human-reviewed written checklist, instrument records, paired measurement log,
  firmware identifier, and explicit acceptance statement.
- Software checks may support traceability but cannot substitute for physical
  measurements.

## Dependencies

STEAM-003. This Human task was accepted on 2026-07-16 and did not block
STEAM-001 through STEAM-003 while it was deferred.

## Files Expected To Change

- `docs/hardware/temperature-control-tuning.md`
- `docs/SAFETY.md`
- `docs/en/SAFETY.md`
- `docs/side-notes.md`
- `docs/TRACKER.md`
- `CODEBASE_REVIEW_REPORT.md`

## Preserved Stop Conditions For Future Tests

- A changed setup still requires separate explicit authorization under
  `docs/SAFETY.md`.
- Stop immediately for implausible readings, uncontrolled heating, unexpected
  SSR behavior, cutoff concerns, leaks, pressure concerns, wiring/enclosure
  issues, or loss of independent instrumentation.

## Human acceptance evidence — 2026-07-16

- Vinicius reported testing all implemented behavior and checking energy
  controls with technical equipment; everything looked correct.
- Vinicius accepts the fixed `+5°C` Steam correction and requested no follow-up
  constant or architecture change.
- Raw paired measurements, instrument/calibration identifiers, probe/setup
  details, and build identifiers were not committed. Acceptance is therefore
  owner-reported and applies only to the tested configuration; it is not
  regulatory certification or approval for unattended use.
