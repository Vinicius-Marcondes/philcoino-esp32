# FWAPI-003 — Extract machine and temperature codecs

Status: Done
Review Mode: Agent
Review Reason: Typed parsing and immutable serialization have exact contract and behavior baselines with no product judgment.

## Goal

Give device, health, temperature, mode, heater, fault, and machine-state wire handling a single-purpose codec owner.

## Scope

- Extract temperature, mode, and heater request parsing/validation into typed results.
- Extract public identity/health, machine state, temperature/mode/heater acknowledgements, and common error serialization.
- Preserve exact v1 and nested-v2 machine bodies, numeric formatting, error messages, and strict field rejection.
- Add direct codec tests and post-stage target resource evidence.

## Non-Scope

- Profiles, extraction, cooldown, route/authentication policy, persistence transactions, locks, or controller mutations.

## Implementation Plan

1. Define immutable request/result and snapshot-to-wire codec interfaces.
2. Move machine-domain parsing and serialization without orchestration.
3. Test boundary, invalid, fault, and exact golden cases directly.
4. Re-run all compatibility and resource gates.

## Acceptance Criteria

- [x] Machine/temperature codecs cannot acquire locks, access storage, mutate control, or perform network I/O.
- [x] API v1 and nested API v2 machine wire behavior remains byte-stable.
- [x] Strict type, range, integer, duplicate, unknown-field, fault, and finite-number rules remain covered.
- [x] Host/capture/protocol checks pass and final cumulative static target resource limits remain satisfied.

Completion Evidence: `../evidence/IMPLEMENTATION.md`

## Verification Strategy

- Run direct codec tests, complete firmware host suite, capture validation, OpenAPI/protocol checks, and pinned ESP32-C3 build/size comparison.

## Dependencies

- FWAPI-002 complete.

## Files Expected To Change

- `firmware/espresso-machine/components/networking/include/philcoino/`
- `firmware/espresso-machine/components/networking/src/`
- `firmware/espresso-machine/components/networking/CMakeLists.txt`
- `firmware/espresso-machine/host-tests/`
- `docs/prds/PRD-005/evidence/`
