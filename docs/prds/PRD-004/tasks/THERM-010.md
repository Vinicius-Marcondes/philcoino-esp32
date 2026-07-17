# THERM-010 — Review target behavior and final mobile experience

Status: Done — Human Accepted 2026-07-16
Review Mode: Human

## Goal

Validate the exact target build, disconnected low-voltage command behavior, and final mobile experience without making energized thermal claims.

## Scope

- Build and flash the pinned firmware on the exact ESP32-C3 target.
- With heater and pump mains loads disconnected, observe startup/reset, Steam conflicts, extraction compensation state, cooldown Start/Stop/cutoff/stabilization, failures, and power loss.
- Review the final mobile flow on a physical device where available, including large text and screen-reader behavior.
- Record board, build, instruments, observations, owner reports, and deferred cases by evidence level.

## Non-Scope

- Energizing heater/pump loads, proving temperature stability, tuning constants, wiring changes, or closing unresolved mains/security findings.

## Implementation Plan

1. Approve the exact disconnected-load checklist and setup.
2. Run target and mobile functional scenarios with timestamps/logic-level evidence where available.
3. Classify each claim as observed, owner-reported, inferred, or deferred.
4. Record explicit acceptance only for the evidence actually produced.

## Acceptance Criteria

- [x] Target boots with both commands off and never restores an active workflow after reset/power loss.
- [x] Brew/Steam conflicts, phase state, replay, Stop, cutoff, and stabilization match the contract on the target.
- [x] Owner-reported technical-equipment observations accepted the energy-control behavior for the tested configuration.
- [x] Final mobile hierarchy, confirmation, Stop, status wording, accessibility, and disconnect behavior received explicit Human acceptance.
- [x] The evidence record remains owner-reported and is not represented as certification or a general physical-safety guarantee.

## Verification Strategy

- Human-reviewed target build/flash record, disconnected logic-level matrix, mobile session, screenshots/captures, and explicit acceptance statement.

## Dependencies

- THERM-009.

## Files Expected To Change

- `docs/TRACKER.md`
- `docs/side-notes.md`
- `docs/SAFETY.md`
- `CODEBASE_REVIEW_REPORT.md`

## Human Review Needs

- Completed on 2026-07-16 through Vinicius's owner-reported acceptance.

## Historical Stop Conditions

- This task did not itself authorize a mains connection, energized load, wiring
  modification, or thermal test; THERM-011 records the later owner acceptance.

## Human acceptance evidence — 2026-07-16

- Vinicius reported testing every implemented feature on the actual system and
  accepted the target and final mobile behavior without requesting revisions.
- Vinicius also reported checking the energy-control behavior with technical
  equipment and finding it correct.
- Raw traces, instrument identifiers, calibration records, exact build/setup
  identifiers, and per-row captures were not committed. The Human disposition
  is therefore explicitly owner-reported and limited to the tested setup.
- The detailed final disposition is recorded in
  `docs/prds/PRD-004/HUMAN_REVIEW.md`.
