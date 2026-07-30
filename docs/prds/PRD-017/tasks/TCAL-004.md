# TCAL-004 — Model calibration in the deterministic simulator

> TCAL-008 supersedes this task's original fault-at-`135°C` equality:
> exact `135°C` is permitted and values strictly above either simulated cap
> fault.

Status: Done
Review Mode: Agent
Review Reason: Manual time advancement, injected persistence failures, strict
route tests, and deterministic state transitions fully define acceptance.

## Goal

Implement the PRD-017 contract in the development simulator so mobile work can
exercise calibration without claiming physical temperature or steam evidence.

## Scope

- Separate simulator raw and effective temperatures and apply the saved signed
  offset exactly once in both normal modes.
- Implement calibration status, start, candidate, save, cancel, conflicts, and
  deterministic inactivity expiry.
- Preserve saved calibration across power cycle; reset restores no record and a
  `0°C` default.
- Model transactional persistence failure, corrupt-load behavior, target
  reachability, effective `135°C`, and raw `135°C`.
- Update history/state output to effective-temperature semantics.
- Extend simulator-only controls only as needed to set raw temperature, advance
  advisory/lease time, and inject the next calibration persistence failure.
- Document that steam-wand observation and calibration accuracy are not
  simulated.

## Non-Scope

- Firmware changes, mobile code, UI, physical gradients, pressure, steam
  detection, heater validation, or energized testing.

## Implementation Plan

1. Extend persisted and volatile simulator state with raw/effective calibration
   ownership.
2. Add strict protected routes and conflict/error mapping.
3. Integrate calibration with target mutations, power cycle, reset, history,
   fault injection, and manual time advancement.
4. Add route/model tests for arithmetic, states, persistence, expiry, conflicts,
   dual limits, and unsafe targets.
5. Update simulator documentation and run its full matrix.

## Acceptance Criteria

- [x] Simulator state and history use effective temperature while controls can
  inject and inspect raw temperature explicitly.
- [x] Calibration routes and session transitions match the protocol exactly.
- [x] Power cycle preserves calibration; reset removes it; failed persistence
  keeps the prior value; corrupt storage fails off.
- [x] Manual time deterministically controls advisory stability and inactivity
  expiry without background time.
- [x] Both `135°C` limits and offset-dependent unsafe targets are covered.
- [x] Simulator tests and typecheck pass without physical-calibration claims.

## Completion Evidence

- Current simulator suite: 92 tests and 741 expectations passed.
- Simulator TypeScript typecheck passed.
- Route tests cover authentication, strict query/body parsing, all five
  calibration operations, opaque ownership, late/mismatched sessions, guarded
  starts, conflicting workflow cancellation, and contract error mappings.
- Deterministic model tests cover `108→−8`, `95→+5`, `100→0`, one-time offset
  application in both modes/history, advisory-only stability, renewals beyond
  one lease duration, exact inactivity expiry, failed persistence, power-cycle,
  reset, corrupt load, unsafe save/target rejection, and both `135°C` limits.

## Decision Log

- Raw temperature is an explicit simulator value; effective temperature is
  derived once from the saved offset for API state, history, readiness, and
  normal control.
- The compatibility temperature-injection route remains, but a dedicated raw
  control returns both raw and effective values for calibration tests.
- Calibration persistence and corruption are modeled independently from
  volatile sessions so power-cycle and reset have firmware-like semantics.
- Steam-wand observation, boiling accuracy, physical cooling, thermostat
  interruption, and heater safety remain outside simulator evidence.

## Verification Strategy

- Add model tests plus authenticated route integration tests for every state,
  transition, conflict, injected failure, power event, and numeric boundary.
- Run the complete simulator test suite and TypeScript typecheck.

## Dependencies

- TCAL-003 complete.

## Files Expected To Change

- `tools/device-simulator/src/`
- `tools/device-simulator/test/`
- `tools/device-simulator/README.md`
- `docs/TRACKER.md`
