# HIST-003 — Add bounded firmware history and endpoint

Status: Done
Review Mode: Agent
Review Reason: Ring behavior, wire output, synchronization bounds, and resource limits are deterministic with host and target evidence.

## Goal

Implement compact RAM-only history and the authenticated endpoint without delaying firmware control.

## Scope

- Add a host-testable 600-sample ring, boot identity, cursor paging, and codec.
- Capture one-Hertz acknowledged control and fail-off pump command state.
- Register and serve the endpoint with authentication-before-query parsing.
- Record static RAM, image, stack, and available target runtime evidence.

## Non-Scope

- NVS history, control-policy changes, mobile behavior, or physical output claims.

## Implementation Plan

1. Build the compact pure history owner and host tests.
2. Add query parsing and deterministic response serialization.
3. Wire zero-wait capture and bounded page copying into ESP-IDF.
4. Validate captures, sanitizers, target build, and resource budgets.

## Acceptance Criteria

- [x] The ring retains 600 actual samples within 12 KiB and resets on boot.
- [x] History contention cannot wait on or extend the control loop.
- [x] The endpoint matches strict cursor/authentication semantics.
- [x] Firmware host, sanitizer, capture, and available target checks pass.

## Completion Evidence

- Added a 16-byte compact sample, 600-slot ring, zero-wait atomic capture/page lock, boot ID, cursor paging, strict parser, and serializer.
- Registered authenticated history before query parsing and preserved existing response payloads.
- Native host CTest passed 6/6; ASan/UBSan CTest passed 6/6.
- Thirty firmware captures validate against protocol schemas.
- The pinned ESP-IDF environment is unavailable in this workspace, so target image/heap/stack evidence remains deferred to HIST-006/007 and is not inferred from host tests.

## Verification Strategy

- Run native/sanitizer CTest, firmware capture validation, static assertions, and pinned ESP-IDF build/size checks.

## Dependencies

- HIST-002 complete.

## Files Expected To Change

- `firmware/espresso-machine/components/`
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`
