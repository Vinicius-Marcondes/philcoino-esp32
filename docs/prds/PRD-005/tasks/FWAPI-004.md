# FWAPI-004 — Extract workflow codecs

Status: Done
Review Mode: Agent
Review Reason: Profile, extraction, compensation, and cooldown shapes are strictly specified and deterministically testable.

## Goal

Move profile/extraction/cooldown request validation and workflow response serialization into pure typed codec owners.

## Scope

- Extract complete profile-set, extraction Start, and cooldown Start parsing/validation.
- Extract profile, extraction, compensation, cooldown, combined-state, and workflow-conflict serialization.
- Preserve slot order, names/durations, idempotency keys, replay/conflict shapes, command-state wording, and exact bodies.
- Add direct codec tests and post-stage target resource evidence.

## Non-Scope

- Workflow state-machine behavior, pump/heater commands, persistence, locking, route/authentication policy, or mobile/simulator changes.

## Implementation Plan

1. Define typed workflow request and immutable serialization interfaces.
2. Move each domain codec separately while retaining route-level baselines.
3. Add direct strict-shape, boundary, conflict, and golden tests.
4. Re-run all compatibility and resource gates.

## Acceptance Criteria

- [x] Workflow codecs have no controller mutation, storage, lock, ESP-IDF, or output dependency.
- [x] Profile, extraction, compensation, cooldown, conflict, and combined-state bodies remain byte-stable.
- [x] Strict unknown/duplicate fields, slot/order, duration, selection, and key constraints remain covered.
- [x] Host/capture/protocol checks pass and final cumulative static target resource limits remain satisfied.

Completion Evidence: `../evidence/IMPLEMENTATION.md`

## Verification Strategy

- Run direct workflow codec tests, complete firmware host suite, capture validation, OpenAPI/protocol checks, and pinned ESP32-C3 build/size comparison.

## Dependencies

- FWAPI-003 complete.

## Files Expected To Change

- `firmware/espresso-machine/components/networking/include/philcoino/`
- `firmware/espresso-machine/components/networking/src/`
- `firmware/espresso-machine/components/networking/CMakeLists.txt`
- `firmware/espresso-machine/host-tests/`
- `docs/prds/PRD-005/evidence/`
