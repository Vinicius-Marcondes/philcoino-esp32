# HIST-002 — Add deterministic simulator history

Status: Done
Review Mode: Agent
Review Reason: Simulator time, pagination, retention, reset, and authentication behavior are deterministic and automated.

## Goal

Implement the PRD-007 history contract in the development simulator.

## Scope

- Capture full-context samples at one Hertz under manually advanced time.
- Retain 600 samples and implement strict cursor pagination/reset/overflow.
- Add route, authentication, failure, and state-transition tests.

## Non-Scope

- Firmware scheduling evidence, mobile synchronization, or UI.

## Implementation Plan

1. Add a deterministic boot identity and rolling history model.
2. Expose the authenticated history route with strict query handling.
3. Cover paging, overflow, power-cycle, faults, modes, and pump/heater commands.

## Acceptance Criteria

- [x] Manual time advance produces ordered one-Hertz samples without synthesis beyond modeled state.
- [x] Pagination, cursor reset, and truncation match the protocol.
- [x] Unauthorized and malformed requests are rejected consistently.
- [x] Simulator and protocol integration tests pass.

## Completion Evidence

- Added deterministic boot identity, one-Hertz capture, 600-sample retention, and strict cursor paging.
- Added authenticated route coverage for initial, continuous, truncated, reset, malformed, duplicate, and future cursors.
- `bun run test:simulator` passed: 65 tests, 410 expectations.
- `bun run typecheck:simulator` passed.

## Verification Strategy

- Run simulator tests, thermal workflow tests, and protocol fixture validation.

## Dependencies

- HIST-001 complete.

## Files Expected To Change

- `tools/device-simulator/src/`
- `tools/device-simulator/test/`
- `tools/device-simulator/README.md`
