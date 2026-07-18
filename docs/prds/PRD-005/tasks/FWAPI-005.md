# FWAPI-005 — Consolidate routing and current bearer access policy

Status: Done
Review Mode: Agent
Review Reason: Route registration, protection, dispatch, and pre-body authentication are deterministic and covered by the frozen route matrix.

## Goal

Give route metadata and current access policy one authoritative owner while leaving thin, explicit orchestration handlers.

## Scope

- Consolidate method/path/access metadata used by ESP-IDF registration, pre-body authentication, and dispatch.
- Preserve both public routes, all twelve protected routes, 404 behavior, bearer challenge, and constant-time bearer comparison.
- Keep header/body bounds, receive deadlines, timeout counts, and response transmission in the ESP-IDF adapter.
- Keep locks, persistence transactions, controller calls, idempotency decisions, and domain-outcome mapping in explicit handlers.
- Record post-stage target resource evidence.

## Non-Scope

- FW-005 encrypted sessions, future authentication abstractions, endpoint changes, codec changes, or controller/persistence semantics.

## Implementation Plan

1. Introduce one immutable route descriptor table and access classification API.
2. Make registration, early authentication, and dispatch consume the same metadata.
3. Reduce `api.cpp` to orchestration without changing call ordering or lock/persistence boundaries.
4. Re-run route, behavior, contract, timing-boundary, and resource gates.

## Acceptance Criteria

- [x] Route registration, access classification, and dispatch cannot drift between separate method/path lists.
- [x] Unauthorized protected requests are rejected before body reads with unchanged challenges and errors.
- [x] Transport limits/deadlines and orchestration safety semantics remain unchanged.
- [x] No speculative FW-005 session interface is introduced.
- [x] Host/capture/protocol checks pass and final cumulative static target resource limits remain satisfied.

Completion Evidence: `../evidence/IMPLEMENTATION.md`

## Verification Strategy

- Run route characterization, early-auth tests, full firmware host suite, capture validation, OpenAPI/protocol checks, and pinned ESP32-C3 build/size comparison.

## Dependencies

- FWAPI-004 complete.

## Files Expected To Change

- `firmware/espresso-machine/components/networking/include/philcoino/`
- `firmware/espresso-machine/components/networking/src/`
- `firmware/espresso-machine/components/networking/CMakeLists.txt`
- `firmware/espresso-machine/host-tests/`
- `docs/prds/PRD-005/evidence/`
