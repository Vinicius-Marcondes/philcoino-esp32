# STRM-004 — Add the ESP-IDF asynchronous SSE adapter

Status: In Review — Connected resource verification pending
Review Mode: Agent
Review Reason: Adapter tests plus the pinned target build provide deterministic software acceptance; runtime evidence stays separate.

## Goal

Serve the telemetry ring through one bounded authenticated asynchronous SSE connection.

## Scope

- Register the stream URI, authenticate before streaming, enforce one client,
  send replay/live pages and heartbeats, and close slow/failed clients.
- Keep HTTP transmission and JSON serialization outside the workflow mutex.

## Non-Scope

- TLS, multiple subscribers, cloud transport, commands, or energized testing.

## Implementation Plan

1. Add stream lifecycle and async request ownership.
2. Queue bounded network work from telemetry notifications.
3. Measure stack/heap/latency and build the pinned ESP32-C3 target.

## Acceptance Criteria

- [x] Busy/unavailable/authentication responses are strict.
- [x] A slow client cannot queue unbounded work or block REST/control tasks.
- [x] Host checks and the pinned ESP-IDF 6.0.2 ESP32-C3 build pass.
- [ ] Connected heap, stack, latency, and control-deadline budgets are recorded.

## Verification Strategy

- Run host tests, target build/size, and disconnected low-voltage runtime diagnostics when available.

## Dependencies

- STRM-003.

## Files Expected To Change

- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/components/firmware_config/`
- `firmware/espresso-machine/main/app_main.cpp`
- `firmware/espresso-machine/host-tests/`
