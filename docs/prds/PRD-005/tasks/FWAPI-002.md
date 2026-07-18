# FWAPI-002 — Extract the bounded generic JSON boundary

Status: Done
Review Mode: Agent
Review Reason: The extraction is pure C++ and must preserve golden behavior under direct unit, property, contract, and target-build checks.

## Goal

Move JSON syntax parsing and low-level encoding helpers into a bounded, domain-neutral, host-testable module.

## Scope

- Extract JSON object/string/number/composite parsing without machine-domain knowledge.
- Extract generic escaping/encoding primitives used by response serializers.
- Expose explicit success/failure interfaces bounded to the existing 1,024-byte transport limit.
- Add direct tests for whitespace, duplicate keys, escapes, number grammar, truncation, nesting, and trailing data.
- Record post-extraction target resource evidence against FWAPI-001.

## Non-Scope

- Moving domain validation, route/authentication policy, orchestration, or changing accepted JSON semantics.

## Implementation Plan

1. Introduce internal JSON types and parser/encoder interfaces with no ESP-IDF or control dependencies.
2. Move existing syntax behavior without cleanup that changes classification.
3. Add direct boundary/property tests and retain the route-level baseline.
4. Re-run host, capture, protocol, sanitizer-ready, and target resource gates.

## Acceptance Criteria

- [x] Generic JSON code has no controller, storage, output, route, authentication, or ESP-IDF dependency.
- [x] Existing accepted/rejected JSON behavior and deterministic bodies remain unchanged.
- [x] Direct tests cover every syntax boundary identified by FWAPI-001.
- [x] Host/capture/protocol checks pass and final cumulative static target resource limits remain satisfied.

Completion Evidence: `../evidence/IMPLEMENTATION.md`

## Verification Strategy

- Run the generic JSON tests, complete firmware host suite, capture validation, OpenAPI/protocol checks, and pinned ESP32-C3 build/size comparison.

## Dependencies

- FWAPI-001 complete.

## Files Expected To Change

- `firmware/espresso-machine/components/networking/include/philcoino/`
- `firmware/espresso-machine/components/networking/src/`
- `firmware/espresso-machine/components/networking/CMakeLists.txt`
- `firmware/espresso-machine/host-tests/`
- `docs/prds/PRD-005/evidence/`
