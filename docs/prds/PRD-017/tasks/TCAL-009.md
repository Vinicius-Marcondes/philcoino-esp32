# TCAL-009 — Perform supervised physical acceptance

Status: Todo
Review Mode: Human
Human Review Needs: Explicitly authorize and supervise the connected/energized
setup, verify instrumentation and independent protection, observe calibration
repeatability, review both software limits, and accept or reject the feature.

## Goal

Prepare and, only after separate explicit authorization, perform the Human
evidence needed to accept the guided calibration and retained independent
thermostat for the exact installed machine.

## Scope

- Prepare a bounded procedure recording firmware revision, offset, raw/effective
  temperatures, targets, controller build, ambient/start conditions, steam-wand
  observation, instruments, wiring, thermostat identity, and stop conditions.
- Repeat the calibration observation sufficiently to assess whether the chosen
  raw boiling point and saved offset are stable for the tested configuration.
- Confirm the app/firmware flow never commands the pump or valve and returns to
  Brew after Save, Cancel, disconnect, fault, and reset.
- Review the effective and raw Steam-cap fail-off evidence produced by
  TCAL-008 with independent instrumentation.
- Verify the retained `145°C`, 10 A, 250 V thermostat's installed series wiring
  and interruption through a qualified method that does not bypass software
  protection or intentionally overheat the machine.
- Record an explicit Human accept, reject, or defer decision limited to the
  exact tested configuration.

## Non-Scope

- Autonomous energized work, bypassing either software temperature limit, deliberately
  defeating the SSR/safety lease, relying on marketplace ratings as test
  evidence, rewiring without separate approval, or certification.

## Implementation Plan

1. Freeze the exact software build and inspect all software/target evidence.
2. Review instrumentation, independent protection, wiring evidence, procedure,
   abort controls, and stop conditions.
3. After explicit authorization, perform repeatable calibration observations.
4. Verify software fail-off and independent thermostat evidence through
   qualified bounded methods.
5. Record measurements, deviations, unresolved risks, and the Human decision.

## Acceptance Criteria

- [ ] No connected or energized work begins without explicit authorization,
  qualified supervision, verified abort controls, and suitable instrumentation.
- [ ] Repeated observations support or reject the selected offset without
  presenting it as general calibration or certification.
- [ ] Both software temperature boundaries fail off in the exact target build
  without bypassing either protection.
- [ ] The retained thermostat's identity, series wiring, thermal coupling, and
  heater-interruption evidence are independently reviewed.
- [ ] Any unavailable or unsafe physical check remains deferred and visible.
- [ ] A Human explicitly accepts, rejects, or defers PRD-017 for the exact
  tested configuration.

## Verification Strategy

- Human-supervised, instrumented, bounded physical procedure created from
  PRD-017 and repository safety documentation.
- Review raw records, exact build identity, stop conditions, and independent
  protection evidence; never substitute simulator or host results.

## Dependencies

- TCAL-008 complete with all available software and target evidence.

## Stop Conditions

- Stop on unexpected heating, invalid/disagreeing instruments, sensor or
  control fault, loss of supervision, unavailable cutoff evidence, unexpected
  SSR/pump state, water/pressure concern, or any need to bypass protection.

## Files Expected To Change

- `docs/prds/PRD-017/evidence/`
- `docs/prds/PRD-017/tasks/TCAL-009.md`
- `docs/SAFETY.md`
- `docs/side-notes.md`
- `docs/TRACKER.md`
