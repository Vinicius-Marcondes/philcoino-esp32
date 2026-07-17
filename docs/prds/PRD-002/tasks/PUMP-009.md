# PUMP-009 — Review low-voltage pump behavior and hardware evidence

Status: Done
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

- [x] GPIO10 is owner-reported low through firmware startup/reset handling and returns low after every stop/completion/cutoff case in the accepted functional matrix.
- [x] Manual and both seeded profiles are owner-reported to match their commanded timing on the target.
- [x] Power loss/reset is owner-reported to boot idle without resuming extraction.
- [x] Mobile labels remain truthful when the physical series switch is off or pump current is unknown.
- [x] Evidence records distinguish disconnected low-voltage, owner assertion, and any separately supervised energized observation.
- [x] Remaining blockers and deferred physical checks are explicitly documented.

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

## Pre-start Gate Status — 2026-07-12

- Dependencies PUMP-006 through PUMP-008 are complete at software/host level.
- The pinned `idf.py` target toolchain is unavailable in the current environment,
  so no exact ESP32-C3 build or flash was produced.
- No disconnected bench, logic-level instrument, exact target, or owner-observed
  mobile session is available to this agent. No physical or energized action ran.
- At gate preparation time this Human task remained `Todo`; the later owner
  acceptances below supersede that state.

## Human acceptance evidence — 2026-07-14

- Vinicius reported that the rebuilt target was reachable after the HTTP route-capacity fix and that HTTP/mDNS discovery, Manual control, seeded profiles, Stop/cutoff behavior, app-disconnection continuation, and reset/power-cycle non-resumption all ran successfully.
- Vinicius explicitly accepted the PUMP-009 functional checklist after it was presented with the disconnected-load and command-state limitations. This is owner-reported target evidence; it was not independently observed by the agent.
- The report does not include an instrument model, raw GPIO waveform captures, measured edge timestamps, firmware image hash, or exact ESP32-C3 board identifier. It therefore does not establish independent electrical timing evidence.
- No separately authorized energized evidence was recorded on 2026-07-14. Pump operation, SSR output, series-switch position, flow, and physical de-energization remain unmeasured by the software itself.
- Safe target hooks for injected GPIO-write failure and near-`uint64_t` timer-wrap execution were not documented as run. Those adversarial cases remain supported only by host tests and are deferred rather than inferred from the successful functional session.
- Final software regression on 2026-07-14 passed mobile tests (79), lint, and typecheck; protocol tests (69), typecheck, and OpenAPI validation; simulator tests (43) and typecheck; strict firmware host build and 4/4 CTest cases; and validation of 13 firmware contract captures.
- Human acceptance closes PUMP-009 for the observed functional scope. PRD-002 remains active until its broader target/failure-evidence acceptance items are either demonstrated or explicitly dispositioned; existing security and mains-safety findings remain open.

## Instrumented owner acceptance — 2026-07-16

- Vinicius reported checking all energy controls with technical equipment and
  that the tested configuration looked correct.
- Vinicius accepted the tested configuration and removed the electrical/
  energized scope from pending Human review.
- Raw waveforms, equipment identifiers, calibration/setup records, injected
  GPIO-write-failure evidence, and target timer-wrap captures were not committed.
  Those gaps remain engineering evidence limitations, not pending Human review.
