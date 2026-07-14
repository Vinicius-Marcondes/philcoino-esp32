# THERM-008 — Expose firmware API v2 and OLED workflow state

Status: Todo
Review Mode: Agent
Review Reason: Strict parsing/serialization, route behavior, captures, and command-state display mapping are deterministic and testable without hardware.

## Goal

Expose the integrated compensation and cooldown policies through strict independent C++ API v2 handling and truthful OLED state.

## Scope

- Add cooldown Start/Stop routing, parsing, idempotency, conflicts, and serialization.
- Extend combined state with contract-valid compensation and cooldown snapshots.
- Enforce Steam/extraction/workflow conflicts at the authoritative firmware API boundary.
- Render compact compensation/cooldown phase and command wording on OLED without claiming flow or de-energization.
- Add host API tests and contract captures for success, replay, conflicts, failures, and exact states.

## Non-Scope

- Contract redesign, mobile changes, runtime tuning, or physical OLED/GPIO acceptance.

## Implementation Plan

1. Implement strict request parsing and response serialization from THERM-001.
2. Route operations through the bounded coordinator without holding locks during transmission.
3. Add OLED mapping from acknowledged controller snapshots.
4. Generate and validate firmware captures against the shared contract.

## Acceptance Criteria

- [ ] Firmware independently rejects unknown/malformed input and returns every contracted conflict shape.
- [ ] Same-key cooldown replay and idempotent Stop serialize acknowledged original state correctly.
- [ ] Combined state and OLED agree on workflow/command state without physical claims.
- [ ] API v1 parsing, serialization, routes, and captures remain unchanged.
- [ ] Strict host API tests and all firmware contract captures pass.

## Verification Strategy

- Run strict C++ host tests, route/capture generation, OpenAPI fixture validation, and protocol drift checks.

## Dependencies

- THERM-007.

## Files Expected To Change

- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`
- `packages/protocol/fixtures/firmware/`
