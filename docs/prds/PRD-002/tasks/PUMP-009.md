# PUMP-009 — Review low-voltage pump behavior and hardware evidence

Status: Todo
Review Mode: Human

## Goal

Validate the exact GPIO10 command behavior on the target and record the boundary between observed low-voltage behavior, owner-reported installed operation, and any separately authorized energized evidence.

## Scope

- Build and flash the pinned firmware for the exact ESP32-C3 Super Mini.
- With pump/load mains disconnected, observe GPIO10 startup, reset, phases, Stop, cutoff, power loss, and injected failure behavior.
- Review the physical series switch model and the absence of switch/current feedback against UI wording.
- Record the owner-reported working SSR installation and any qualified evidence supplied for SSR/pump compatibility, wiring, enclosure, and failure cases.
- Confirm unresolved security and mains-safety findings remain visible.

## Non-Scope

- Unsupervised mains wiring changes, certification, automatic physical-state detection, or closing findings without evidence.

## Implementation Plan

1. Complete the target build and disconnected low-voltage GPIO10 test matrix.
2. Review mobile behavior on a debug build against observed command timing.
3. Record exact hardware identifiers, instruments, firmware build, measurements, and deferred checks.
4. Obtain explicit human acceptance only for the evidence actually observed.

## Acceptance Criteria

- [ ] GPIO10 is observed low through firmware startup/reset handling and returns low after every stop/failure/cutoff case tested.
- [ ] Manual and both seeded profiles match their commanded low-voltage timing on the target.
- [ ] Power loss/reset never resumes extraction.
- [ ] Mobile labels remain truthful when the physical series switch is off or pump current is unknown.
- [ ] Evidence records distinguish disconnected low-voltage, owner assertion, and any separately supervised energized observation.
- [ ] Remaining blockers and deferred physical checks are explicitly documented.

## Verification Strategy

- Human-observed target build, logic-level measurement, reset/power-cycle matrix, debug mobile review, and signed evidence record; no simulator result is accepted as physical proof.

## Dependencies

- PUMP-008.

## Files Expected To Change

- `docs/hardware/esp32-c3-wiring.md`
- `docs/SAFETY.md`
- `docs/side-notes.md`
- `CODEBASE_REVIEW_REPORT.md`

## Human Review Needs

- Vinicius must approve the mobile extraction behavior on the target and identify which hardware statements are personally observed versus inferred or deferred.

## Stop Conditions

- Stop before any energized wiring or test not separately and explicitly authorized for the exact setup.
