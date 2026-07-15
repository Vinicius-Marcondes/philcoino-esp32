# THERM-010 — Review target behavior and final mobile experience

Status: Review Deferred
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

- [ ] Target boots with both commands off and never restores an active workflow after reset/power loss.
- [ ] Brew/Steam conflicts, phase state, replay, Stop, cutoff, and stabilization match the contract on the target.
- [ ] Disconnected low-voltage observations cover GPIO10/GPIO20 command ordering and failure paths where safely injectable.
- [ ] Final mobile hierarchy, confirmation, Stop, status wording, accessibility, and disconnect behavior receive explicit human disposition.
- [ ] No result is presented as physical flow, heater current, cooling, or energized safety evidence.

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

- Vinicius must approve the checklist and distinguish directly observed behavior from reports or deferred checks.

## Stop Conditions

- Stop before any mains connection, energized load, wiring modification, or thermal test not separately authorized under THERM-011.

## Gate Preparation

- The exact disconnected target/mobile checklist is prepared in
  `docs/prds/PRD-004/HUMAN_REVIEW.md`.
- No target build/flash log, board/setup/instrument record, disconnected
  logic-level observation, physical-device accessibility review, or Human
  disposition has been supplied for PRD-004.
- Checklist preparation and Agent software evidence are not acceptance. This
  task remains at its Human gate and THERM-011 has not advanced.
