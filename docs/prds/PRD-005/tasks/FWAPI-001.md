# FWAPI-001 — Freeze API behavior and establish resource baselines

Status: Done
Review Mode: Agent
Review Reason: Route behavior, golden responses, contract captures, compiler output, and resource reports are deterministic and reviewable from checked-in evidence.

## Goal

Create the compatibility and ESP32-C3 resource baselines that every later extraction must preserve.

## Scope

- Add a machine-readable matrix for both public and all twelve protected API routes, unsupported methods, and unknown paths.
- Characterize authentication variants, status/error mapping, representative exact bodies, and accepted/rejected request classes.
- Preserve existing firmware captures and add missing golden cases needed to freeze current behavior.
- Build the unchanged firmware with pinned ESP-IDF 6.0.2 and record baseline image/section/partition data.
- Define repeatable maximum-request scenarios for later heap and HTTP stack measurements.

## Non-Scope

- Moving production codec code, changing wire behavior, or adding target runtime instrumentation beyond what is required to make the approved measurements observable.

## Implementation Plan

1. Add the characterization matrix and route-level tests before production movement.
2. Generate and validate the complete deterministic response capture set.
3. Run the strict native suite and authoritative protocol validation.
4. Build the ESP32-C3 release configuration and record comparable baseline resource evidence.

## Acceptance Criteria

- [x] Every public/protected route and unsupported method/path behavior is represented in the machine-readable matrix.
- [x] Authentication, strict input classes, status codes, challenges, errors, and exact representative bodies are frozen by tests.
- [x] Existing firmware captures remain byte-stable and validate against the strict protocol schemas.
- [x] Pinned ESP-IDF 6.0.2 baseline image, partition, and section measurements are recorded.
- [x] Heap and stack request scenarios are documented, with unavailable target runtime measurements explicitly deferred rather than inferred.

Completion Evidence: `../evidence/IMPLEMENTATION.md`

## Verification Strategy

- Run strict C++ host build/CTest, capture generation/validation, OpenAPI validation, protocol tests, and pinned ESP32-C3 build/size commands.

## Dependencies

- PRD-005 approved.

## Stop Conditions

- Stop if characterization exposes OpenAPI drift or unsafe behavior that would require a wire change; record it for a separate decision.

## Files Expected To Change

- `firmware/espresso-machine/host-tests/`
- `firmware/espresso-machine/host-tests/CMakeLists.txt`
- `docs/prds/PRD-005/evidence/`
