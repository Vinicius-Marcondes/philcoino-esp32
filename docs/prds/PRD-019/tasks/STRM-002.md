# STRM-002 — Implement deterministic simulator streaming

Status: Done
Review Mode: Agent
Review Reason: Deterministic time and HTTP contract tests cover simulator behavior without hardware.

## Goal

Implement the complete PRD-019 telemetry model and SSE route in the simulator.

## Scope

- Capture every extraction at 250 ms with baseline, replay, cursor, settling,
  continuity, and terminal behavior.
- Expose authenticated deterministic SSE without real-time sleeps.

## Non-Scope

- Firmware scheduling, mobile UI, physical scale accuracy, or safety evidence.

## Implementation Plan

1. Add the generic telemetry ring to the deterministic model.
2. Add authenticated stream response framing and subscriber ownership.
3. Add all-mode, reconnect, failure, and settling tests.

## Acceptance Criteria

- [x] Manual, timed, and weighted streams match the strict contract.
- [x] Advance-driven events, cursor replay, truncation/reset, heartbeat, and terminal closure are deterministic.
- [x] Simulator tests and typecheck pass.

## Verification Strategy

- Run the complete simulator suite and typecheck.

## Dependencies

- STRM-001.

## Files Expected To Change

- `tools/device-simulator/src/`
- `tools/device-simulator/test/`
- `docs/TRACKER.md`
