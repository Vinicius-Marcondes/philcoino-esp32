# THERM-011 — Validate physical thermal behavior

Status: Done — Human Accepted 2026-07-16
Review Mode: Human

## Goal

Measure whether extraction compensation and cooldown are repeatable on the actual machine while preserving every physical-safety prerequisite and evidence boundary.

## Scope

- Define and separately authorize the exact instrumented procedure before physical work.
- Record the independent reference instrument, calibration, probe placement, firmware build, water/boiler state, ambient conditions, dose/flow context, and supervision.
- Compare repeatable Manual/profile extractions with compensation inactive versus the fixed `+2°C` main bias; record lowest temperature, recovery, and overshoot.
- Observe pre-infusion `0°C`, main transition timing, cooldown target crossing, 45-second cutoff, five-second stabilization, and post-workflow recovery.
- Verify independent cutoff, SSR suitability, wiring/enclosure, water availability, leaks/pressure, and stop conditions before any authorized energized run.

## Non-Scope

- Unsupervised energized work, certification, automatic constant changes, runtime/per-profile tuning, or inferring safety from software/target results.

## Implementation Plan

1. Resolve or explicitly gate every applicable safety prerequisite and approve the written matrix.
2. Capture repeated synchronized temperature, phase, heater-command, pump-command, and reference observations.
3. Quantify stability, overshoot, cooldown completion, variability, and evidence limitations.
4. Explicitly retain the constants, defer judgment, or request a separate scoped calibration change.

## Acceptance Criteria

- [x] The owner reported instrumented checks of the energy-control behavior for the tested hardware configuration.
- [x] The owner reported that all implemented extraction and thermal-workflow features worked as expected.
- [x] The owner accepted cooldown target/cutoff/Stop/stabilization and recovery behavior for the tested configuration.
- [x] Independent cutoff, SSR/wiring/enclosure, pressure/leak, and single-sensor limitations remain explicit in the project safety documentation.
- [x] Human review retains the current constants and requests no constant or architecture change.

## Verification Strategy

- Human-supervised instrument logs, synchronized captures, setup photographs/identifiers, repeated scenario matrix, and explicit signed disposition. Software evidence is traceability only.

## Dependencies

- THERM-010 accepted for its limited target/low-voltage scope.

## Files Expected To Change

- `docs/hardware/temperature-control-tuning.md`
- `docs/SAFETY.md`
- `docs/en/SAFETY.md`
- `docs/side-notes.md`
- `docs/TRACKER.md`
- `CODEBASE_REVIEW_REPORT.md`

## Human Review Needs

- Completed on 2026-07-16 through Vinicius's owner-reported acceptance of the
  tested setup and current constants.

## Preserved Stop Conditions For Future Tests

- Do not treat this one-configuration acceptance as authorization for a changed
  setup; reapply `docs/SAFETY.md` prerequisites and explicitly disposition
  relevant BLOCKER/MAJOR findings.
- Stop immediately for implausible readings, uncontrolled heating, unexpected SSR behavior, cutoff concerns, insufficient water, leaks, pressure concerns, wiring/enclosure issues, or loss of independent instrumentation.

## Human acceptance evidence — 2026-07-16

Vinicius reported that the energy controls and related physical behavior were
tested with technical equipment and looked correct, and that every implemented
feature worked as expected. He explicitly removed this scope from pending Human
review. The repository does not contain the raw traces, instrument/calibration
identifiers, exact setup/build identifiers, or repeated-run measurements, so
the acceptance is owner-reported, applies to the tested configuration, and is
not regulatory certification or approval for unattended use.
