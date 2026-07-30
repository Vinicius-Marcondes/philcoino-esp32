# TCAL-008 — Make 135°C an inclusive Steam target

Status: Todo
Review Mode: Human
Human Review Needs: Approve the exact raw/effective over-temperature boundary
above the inclusive `135°C` target before implementation, then review target
reachability, fail-off evidence, and native target-setting behavior.

## Goal

Allow the user to save and operate an effective Steam target of exactly
`135°C` without silently clamping it or immediately faulting at the target,
while retaining an explicit, independently enforced raw/effective safety margin
below the retained nominal `145°C` thermostat.

## Scope

- Resolve and document the exact raw and effective over-temperature trip
  boundaries that sit above the inclusive `135°C` Steam target.
- Raise the strict Steam target maximum from `120°C` to `135°C` across OpenAPI,
  TypeScript schemas/constants, firmware, simulator, mobile, fixtures, and docs.
- Recalculate offset-adjusted safe target bounds so `135°C` is offered only
  when its implied raw target is below the approved raw fault boundary.
- Reject calibration saves and later target mutations when the requested
  effective target is unreachable under the saved offset and approved raw
  ceiling; never clamp or rewrite persisted targets.
- Verify the heater turns off and latches `over_temperature` at both approved
  raw and effective boundaries, including offsets that separate the two paths.
- Preserve sensor validation, heating timeouts, safety lease, boot-off,
  fail-off output ownership, storage atomicity, and independent thermostat
  requirements.

## Non-Scope

- Energized testing, selecting a boundary without Human approval, changing the
  thermostat, claiming its tolerance or installed interruption, automatic steam
  detection, calibration workflow redesign, or weakening unrelated Brew limits.

## Implementation Plan

1. Record the Human-approved effective and raw fault boundaries above the
   inclusive `135°C` target.
2. Update the protocol first, including schemas, OpenAPI, examples, and strict
   boundary tests.
3. Align firmware reachability/control/fault policy and simulator behavior.
4. Align mobile target controls, debug behavior, localization, and tests.
5. Run the full affected verification matrix and retain energized acceptance
   for TCAL-009.

## Acceptance Criteria

- [ ] The Human-approved raw and effective trip boundaries are explicit,
  testable, above `135°C`, and retain documented margin below the nominal
  `145°C` thermostat.
- [ ] `135°C` is an inclusive strict Steam target in the protocol, firmware,
  simulator, debug client, and mobile Machine controls.
- [ ] An acknowledged `135°C` target does not immediately fault at an ordinary
  valid reading equal to its target.
- [ ] Raw and effective over-temperature paths independently latch and command
  the heater off at their approved boundaries.
- [ ] Offset-dependent unreachable targets and calibration saves are rejected
  without clamping or changing persisted values.
- [ ] All affected protocol, simulator, mobile, firmware host/sanitizer,
  capture, and available pinned target checks pass.
- [ ] Documentation distinguishes software evidence from the separately
  authorized physical acceptance in TCAL-009.

## Verification Strategy

- Add inclusive target boundary tests at `134°C`, `135°C`, and the first
  rejected value.
- Add independent raw/effective fault-boundary tests with positive and negative
  offsets.
- Re-run protocol validation/typecheck/tests, simulator tests/typecheck, mobile
  tests/typecheck/lint, firmware native/sanitizer suites, captures, and the
  pinned target build when available.

## Dependencies

- TCAL-007 complete.
- Human approval of the exact effective and raw fault boundaries.

## Stop Conditions

- Stop before implementation if the safety margin or raw/effective boundary is
  unspecified, inconsistent with an inclusive `135°C` target, or would rely on
  the nominal thermostat listing as proof of installed protection.

## Files Expected To Change

- `packages/protocol/`
- `firmware/espresso-machine/`
- `tools/device-simulator/`
- `apps/mobile/`
- `docs/`
- `docs/prds/PRD-017/evidence/`
- `docs/TRACKER.md`
