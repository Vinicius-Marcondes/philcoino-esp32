# PHIL-003 — Build the ESP32 API simulator

Status: Done
Review Mode: Agent
Review Reason: HTTP behavior, authorization, state transitions, persistence simulation, and timers are fully testable.

## Goal

Provide a Bun/Hono simulator that implements API v1 for mobile development without physical hardware.

## Scope

- Implement public health/device endpoints and authenticated state/mutation endpoints.
- Simulate temperature movement, readiness, faults, mode switching, and steam timeout.
- Support deterministic test controls that are unavailable in production firmware.
- Validate requests and responses through the protocol package.

## Non-Scope

- mDNS emulation, production firmware, or mobile UI.

## Implementation Plan

1. Scaffold the Hono workspace.
2. Add bearer middleware and contract-validated handlers.
3. Add a deterministic in-memory machine model and reset controls.
4. Cover success and error behavior with tests.

## Acceptance Criteria

- [ ] Simulator implements every API v1 endpoint.
- [ ] Missing/invalid tokens return the contract error shape.
- [ ] Temperature and mode mutations obey constraints.
- [ ] Steam timeout and faults can be exercised deterministically.

## Verification Strategy

Run Bun tests against the in-process Hono application and validate all responses with Zod.

## Dependencies

PHIL-002.

## Files Expected To Change

`tools/device-simulator/**` and workspace metadata.
