# PUMP-007 — Serve API v2 from firmware

Status: Todo
Review Mode: Agent
Review Reason: Strict parsing, serialization, authentication, command delegation, and contract captures are deterministic and independently testable.

## Goal

Expose the firmware extraction controller through authenticated API v2 without regressing API v1 or real-time pump timing.

## Scope

- Parse/serialize v2 state, profiles, export, Start, Stop, replay, and conflict responses.
- Delegate under bounded synchronization without holding locks across NVS, HTTP transmission, display work, or pump deadlines.
- Preserve v1 endpoints and authentication behavior during migration.
- Add extraction information to OLED only where it remains legible on the 128×32 display and does not displace fault-critical information.
- Produce firmware contract captures validated by shared schemas.

## Non-Scope

- API v1 retirement, TLS/security redesign, mobile visual changes, or physical pump claims.

## Implementation Plan

1. Extend the host-testable API dispatcher with strict v2 routes.
2. Add bounded controller/profile synchronization and response snapshots.
3. Integrate network handlers and compact OLED extraction presentation.
4. Validate captures against OpenAPI/Zod and run target builds.

## Acceptance Criteria

- [ ] Firmware accepts only strict authenticated v2 requests and returns contract-valid acknowledgements/errors.
- [ ] Profile persistence and HTTP response work cannot extend active pump-on deadlines.
- [ ] API v1 captures and behavior remain compatible.
- [ ] OLED prioritizes fault and safety-critical state and labels pump command without claiming measured state.
- [ ] Firmware API/host tests, capture validation, protocol checks, and pinned target build pass when available.

## Verification Strategy

- Native API tests for malformed input, auth, conflicts, replay, persistence failure, bounded locking, captures, and v1 regression; ESP-IDF build.

## Dependencies

- PUMP-006.

## Files Expected To Change

- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`
