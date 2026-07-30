# TCAL-007 — Align documentation and software verification

Status: Done
Review Mode: Agent
Review Reason: Repository-wide searches, configured test matrices, contract
captures, target resource checks, and documentation assertions are objective.

## Goal

Verify the complete software change, remove stale fixed-offset claims, and
record compatibility, resource, safety, and unavailable-target evidence before
any physical acceptance.

## Scope

- Align architecture, development, safety, tuning, protocol, firmware/mobile/
  simulator READMEs, side notes, and current review claims with PRD-017.
- Mark PRD-003 as superseded for current runtime behavior without rewriting its
  historical acceptance record.
- Verify no current source or documentation claims a fixed Steam-only `+5°C`.
- Run all affected protocol, simulator, mobile, firmware native/sanitizer, and
  contract-capture checks.
- Run the pinned ESP-IDF 6.0.2 target build and record flash, RAM, stack, API
  response, NVS, workflow-mutex, and 500 ms deadline evidence when available.
- Record unavailable checks explicitly and keep software evidence separate from
  raw temperature, thermostat, SSR current, and physical steam evidence.

## Non-Scope

- Energized calibration, thermostat cutoff testing, wiring changes,
  certification, task approval, or inferring physical acceptance.

## Implementation Plan

1. Audit current fixed-offset and temperature-limit claims.
2. Align public and internal documentation with the implemented contract and
   safety boundaries.
3. Run the complete affected workspace and firmware host matrices.
4. Run target/resource checks when the pinned environment is available.
5. Record exact evidence and remaining Human gates in PRD-017 evidence and the
   tracker.

## Acceptance Criteria

- [x] Current documentation consistently describes one global signed offset,
  zero default, effective temperature, and independent `135°C` limits.
- [x] PRD-003 remains historical and is clearly superseded for current runtime.
- [x] All affected configured software checks and captures pass.
- [x] Available host resource/timing evidence shows no unexpected object-size,
  lease, NVS, mutex-policy, or response-bound regression.
- [x] Unavailable target checks and all physical/Human evidence remain visible
  rather than inferred from software.

## Verification Strategy

- Run repository searches for stale `+5°C` and `130°C` current-runtime claims.
- Run the root/workspace verification matrix, firmware native/sanitizer suite,
  captures, and pinned target build/resource checks.

## Dependencies

- TCAL-006 complete.

## Evidence

- `docs/prds/PRD-017/evidence/SOFTWARE-VERIFICATION.md`
- OpenAPI valid; protocol typecheck and 157 tests / 337 expectations pass.
- Simulator typecheck and 92 tests / 741 expectations pass.
- Mobile typecheck, Expo lint, and 252 tests / 2,438 expectations pass.
- Firmware native and sanitizer suites pass 10/10; 35 strict captures pass.
- Host resource report: `HistorySample=40`, `HistoryBuffer=24072`,
  `HistoryPage=416`, `ControlSnapshot=128`, `BrewPiController=76`.
- The pinned ESP-IDF 6.0.2 target build became available during TCAL-008 and
  passes. Runtime heap, stack high-water, NVS headroom, mutex timing, watchdog,
  and real lease evidence remain explicitly unmeasured.

## Decision

Agent review accepted the configured software and documentation evidence on
2026-07-30. TCAL-007 does not approve an inclusive `135°C` Steam target or any
connected/energized acceptance; those remain TCAL-008 and TCAL-009.

## Files Expected To Change

- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/SAFETY.md`
- `docs/hardware/temperature-control-tuning.md`
- `docs/protocol/`
- `docs/side-notes.md`
- affected package/firmware/mobile/simulator READMEs
- `docs/prds/PRD-017/evidence/`
- `docs/TRACKER.md`
