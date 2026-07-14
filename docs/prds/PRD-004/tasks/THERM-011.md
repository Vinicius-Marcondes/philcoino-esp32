# THERM-011 — Validate physical thermal behavior

Status: Todo
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

- [ ] Exact setup, instruments, calibration, probes, build, conditions, authorization, and supervision are recorded.
- [ ] Repeated comparable extraction observations assess the `+2°C` bias without confusing command state with physical output.
- [ ] Cooldown observations distinguish target completion, cutoff, actual flow, water use, stabilization, and post-cycle recovery.
- [ ] Stop conditions, independent cutoff, SSR/wiring/enclosure, pressure/leak, and single-sensor limitations remain explicit.
- [ ] Human review explicitly accepts, defers, or requests a new PRD for any constant/architecture change.

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

- Vinicius must separately approve the exact procedure and setup, supervise or identify qualified supervision, and decide the disposition of each fixed constant.

## Stop Conditions

- Stop before energized work until all applicable `docs/SAFETY.md` prerequisites and unresolved BLOCKER/MAJOR findings are satisfied or explicitly dispositioned for the exact setup.
- Stop immediately for implausible readings, uncontrolled heating, unexpected SSR behavior, cutoff concerns, insufficient water, leaks, pressure concerns, wiring/enclosure issues, or loss of independent instrumentation.
