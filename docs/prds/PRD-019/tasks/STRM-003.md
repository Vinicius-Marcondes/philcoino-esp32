# STRM-003 — Add bounded firmware telemetry capture

Status: Done
Review Mode: Agent
Review Reason: Pure C++ host tests can deterministically verify capture, paging, gaps, and fixed budgets.

## Goal

Capture resumable all-extraction telemetry without delaying control work.

## Scope

- Add a fixed 320-sample ring, zero-wait lock, 250 ms cadence, all-shot
  settling, best-effort Manual/timed baseline, and strict serialization.
- Keep the current weighted trace endpoint behavior unchanged.

## Non-Scope

- ESP-IDF socket ownership, mobile runtime, or physical validation.

## Implementation Plan

1. Implement compact generic samples and metadata.
2. Wire capture into the workflow snapshot path.
3. Add cursor/page/serializer host coverage and resource assertions.

## Acceptance Criteria

- [x] Capture never waits on network work and skipped attempts remain sequence gaps.
- [x] Manual/timed baseline cannot block Start; weighted net weight remains authoritative.
- [x] Native and sanitizer host suites pass within fixed memory bounds.

## Verification Strategy

- Run native/sanitizer firmware host suites and resource-budget tests.

## Dependencies

- STRM-001.

## Files Expected To Change

- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/main/app_main.cpp`
- `firmware/espresso-machine/host-tests/`
