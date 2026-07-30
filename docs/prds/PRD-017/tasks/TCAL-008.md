# TCAL-008 — Make 135°C an inclusive Steam target

Status: Done
Review Mode: Agent
Review Reason: The owner kept `135°C` as the inclusive software cap. Strict
contract, host, simulator, mobile, sanitizer, capture, and target-build checks
can objectively verify equality, first-above-cap, reachability, and fail-off
behavior. Energized acceptance remains Human-owned in TCAL-009.

## Goal

Allow the user to save and operate an effective Steam target of exactly
`135°C` without silently clamping it or immediately faulting at the target,
while retaining independently enforced raw/effective `135°C` caps and the
separate nominal `145°C` thermostat.

## Scope

- Permit exact raw and effective readings of `135°C`; values strictly above
  either cap latch `over_temperature` and command the heater off.
- Raise the strict Steam target maximum from `120°C` to `135°C` across OpenAPI,
  TypeScript schemas/constants, firmware, simulator, mobile, fixtures, and docs.
- Recalculate offset-adjusted safe target bounds so `135°C` is offered only
  when its implied raw target is at or below the raw cap.
- Reject calibration saves and later target mutations when the requested
  effective target is unreachable under the saved offset and approved raw
  ceiling; never clamp or rewrite persisted targets.
- Verify the heater turns off and latches `over_temperature` at both approved
  raw and effective boundaries, including offsets that separate the two paths.
- Preserve sensor validation, heating timeouts, safety lease, boot-off,
  fail-off output ownership, storage atomicity, and independent thermostat
  requirements.

## Non-Scope

- Energized testing, raising either software cap above `135°C`, changing the
  thermostat, claiming its tolerance or installed interruption, automatic steam
  detection, calibration workflow redesign, or weakening unrelated Brew limits.

## Implementation Plan

1. Record the approved inclusive-cap and strict-above-cap semantics.
2. Update the protocol first, including schemas, OpenAPI, examples, and strict
   boundary tests.
3. Align firmware reachability/control/fault policy and simulator behavior.
4. Align mobile target controls, debug behavior, localization, and tests.
5. Run the full affected verification matrix and retain energized acceptance
   for TCAL-009.

## Acceptance Criteria

- [x] Raw and effective cap semantics are explicit: exact `135°C` is permitted
  and the first representable value above it faults, while the independent
  nominal `145°C` thermostat remains physically unverified.
- [x] `135°C` is an inclusive strict Steam target in the protocol, firmware,
  simulator, debug client, and mobile Machine controls.
- [x] An acknowledged `135°C` target does not immediately fault at an ordinary
  valid reading equal to its target.
- [x] Raw and effective over-temperature paths independently latch and command
  the heater off strictly above their caps.
- [x] Offset-dependent unreachable targets and calibration saves are rejected
  without clamping or changing persisted values.
- [x] All affected protocol, simulator, mobile, firmware host/sanitizer,
  capture, and available pinned target checks pass.
- [x] Documentation distinguishes software evidence from the separately
  authorized physical acceptance in TCAL-009.

## Verification Strategy

- Add inclusive target boundary tests at `134°C`, `135°C`, and the first
  rejected value.
- Add independent exact-cap and first-above-cap raw/effective tests with
  positive and negative offsets.
- Re-run protocol validation/typecheck/tests, simulator tests/typecheck, mobile
  tests/typecheck/lint, firmware native/sanitizer suites, captures, and the
  pinned target build when available.

## Dependencies

- TCAL-007 complete.

## Evidence

- Protocol OpenAPI validation, typecheck, and 157 tests / 337 expectations pass.
- Simulator typecheck and 92 tests / 741 expectations pass.
- Mobile typecheck, Expo lint, and 252 tests / 2,438 expectations pass.
- Firmware native and sanitizer suites pass 10/10; strict contract captures
  pass.
- The pinned ESP-IDF 6.0.2 target build passes using the owner-provided
  activation script: application `0x11c730` bytes with 26% of the smallest app
  partition free; DRAM 157,924 / 321,296 bytes (49.15%); exact output is
  recorded in PRD-017 evidence.
- Host and simulator tests permit equality at `135°C`, fault at `135.25°C`,
  accept persisted target `135°C`, reject `136°C`, and reject offset-dependent
  raw targets above the cap without clamping.

## Decision

The approved rule keeps `135°C` as both the maximum Steam target and the
maximum permitted raw/effective reading. Firmware commands the heater off at
the target through ordinary control and latches `over_temperature` only when a
raw or effective reading is strictly greater than `135°C`. This does not raise
the software cap to `140°C` and does not treat the nominal thermostat listing
as physical evidence.

## Files Expected To Change

- `packages/protocol/`
- `firmware/espresso-machine/`
- `tools/device-simulator/`
- `apps/mobile/`
- `docs/`
- `docs/prds/PRD-017/evidence/`
- `docs/TRACKER.md`
