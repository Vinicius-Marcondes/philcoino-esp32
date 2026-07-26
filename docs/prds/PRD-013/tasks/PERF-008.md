# PERF-008 — Use deterministic temperature scheduling

Status: Todo
Review Mode: Agent
Review Reason: Fixed-period deadline arithmetic and bounded lateness are
deterministic in host tests and observable through PERF-001 diagnostics.

## Goal

Run temperature control on a fixed 500 ms schedule with bounded lateness
measurement while preserving current priorities and control policy.

## Scope

- Replace relative delay with `vTaskDelayUntil` fixed-period scheduling.
- Measure missed or late periods through bounded diagnostics.
- Preserve temperature, prediction, history, heater-window, lease, and
  workflow behavior.

## Non-Scope

- Priority changes, PID/predictive activation, heater-lease changes, or broad
  interrupt-disabled regions.

## Implementation Plan

1. Add wrap-safe fixed-period scheduling coverage.
2. Adopt one retained wake deadline for the temperature loop.
3. Record bounded lateness without hot-path logging.
4. Exercise representative load scenarios in available verification layers.

## Acceptance Criteria

- [ ] Temperature updates use a fixed 500 ms period.
- [ ] Lateness is bounded/observable without changing priorities.
- [ ] Heater lease, timeouts, history, profiles, and passive prediction remain
  behaviorally unchanged.
- [ ] Firmware host, sanitizer, capture, and available target checks pass.

## Verification Strategy

- Scheduling arithmetic tests, firmware suites, and PERF-001 target diagnostics
  when available.

## Dependencies

- PERF-007 complete.

## Files Expected To Change

- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`
- `docs/TRACKER.md`
