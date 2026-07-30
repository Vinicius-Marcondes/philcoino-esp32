# TCAL-003 — Implement the firmware calibration transaction

Status: Done
Review Mode: Agent
Review Reason: The workflow, API transitions, persistence transaction, conflicts,
lease expiry, and fail-off behavior are deterministic under host tests.

## Goal

Implement the firmware-owned guided calibration session and authenticated API
transaction without allowing the phone, NVS latency, or another workflow to
become a heater-safety owner.

## Scope

- Add one calibration workflow owner under the existing bounded workflow
  synchronization domain.
- Implement start, candidate update, status/lease renewal, save, cancel, and
  15-second inactivity expiry for the opaque active session.
- Control uncorrected raw candidate targets from `90–120°C` in `1°C` steps and
  publish raw/effective preview, heater state, readiness, and advisory stable
  time.
- Reset advisory stability on candidate changes without gating test or Save.
- Prepare the save candidate under lock, persist outside the workflow mutex,
  then adopt the exact candidate after reacquiring it; failure retains the old
  calibration.
- Reject faults, invalid sensors, disabled heater permission, Steam mode,
  extraction, cooldown, scale calibration, and conflicting mutations.
- On cancel, expiry, reset, fault, or conflict, restore ordinary Brew control
  without changing temperature targets or commanding the pump.
- Wire the strict API routes/codecs and preserve authentication and response
  bounds.

## Non-Scope

- Simulator, mobile, UI, automatic steam detection, pump/valve commands,
  physical calibration, thermostat testing, or energized work.

## Implementation Plan

1. Add the pure calibration-session state machine and transition tests.
2. Integrate temporary raw-target control with existing temperature ownership
   and fail-off paths.
3. Add the prepare/save/adopt persistence transaction outside the workflow
   mutex.
4. Add API route metadata, request parsing, orchestration, and serialization.
5. Cover conflicts, expiry, replay/late calls, reset, fault, and resource bounds.

## Acceptance Criteria

- [x] Only one authenticated opaque calibration session can own a candidate,
  and inactivity expires it after 15 seconds without imposing a total duration.
- [x] Candidate control uses raw temperature and ignores the saved offset while
  normal effective-temperature safety and the raw ceiling remain authoritative.
- [x] Save adopts only the exact persisted candidate; failure retains the old
  offset and returns rejection.
- [x] Cancel, expiry, reset, fault, and workflow conflicts return to ordinary
  Brew control without changing targets or commanding the pump.
- [x] All invalid transitions, conflicts, bounds, and late session identifiers
  return the contract-defined errors.
- [x] Firmware native/sanitizer tests, API characterization, captures, mutex
  assertions, and response-size checks pass.

## Completion Evidence

- Native firmware host suite: 10/10 CTest targets passed.
- Sanitizer firmware host suite: 10/10 CTest targets passed.
- Firmware contract validation: 35 strict response captures passed.
- Host tests cover authenticated opaque ownership, all five operations,
  wrap-safe inactivity-only expiry, advisory stability, exact candidate
  persistence/adoption, failed persistence rollback, unsafe-save rejection,
  late and mismatched sessions, workflow conflicts, and fail-off restoration.
- Firmware API storage backends assert that NVS writes occur outside the
  workflow synchronization lock; API routing and bounded serializers remain
  covered by characterization, mutation, and response-budget tests.

## Decision Log

- Calibration temporarily owns the existing temperature controller but keeps
  mode restoration, heater permission, safety lease, and output failure paths
  inside firmware.
- Candidate control uses the uncorrected raw measurement while normal state,
  diagnostics, readiness, and independent raw/effective safety checks retain
  their contract meanings.
- Save is a prepare/persist/adopt transaction: the heater is forced off before
  persistence, storage occurs outside the mutex, and only the exact prepared
  record may be adopted after reacquiring synchronization.
- Conflicting mutations explicitly abort the unsaved session and return a
  calibration-active conflict; they never silently execute after cancellation.

## Verification Strategy

- Add pure workflow transition and wrap-safe lease tests.
- Add firmware API tests for every route, conflict, persistence outcome,
  session mismatch, expiry, and recovery path.
- Run native/sanitizer host suites and contract capture validation.

## Dependencies

- TCAL-002 complete.

## Files Expected To Change

- `firmware/espresso-machine/components/control/`
- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`
- `firmware/espresso-machine/README.md`
- `docs/TRACKER.md`
