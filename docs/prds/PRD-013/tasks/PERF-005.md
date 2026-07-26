# PERF-005 — Add event-driven HX711 acquisition

Status: Software Complete — Target Pending
Review Mode: Agent
Review Reason: Notification, coalescing, timeout, and recovery policy are
host-testable; target interrupt timing is isolated in PERF-009.

## Goal

Wake the scale task from the HX711 data-ready GPIO while retaining a bounded
unavailable-scale timeout and task-owned sampling work.

## Scope

- Configure GPIO data-ready notification.
- Keep ISR work to task notification only.
- Handle ready-before-wait, coalescing, timeout, disconnect, and recovery.
- Keep GPIO clocking, filtering, publication, allocation, and logging in task
  context.

## Non-Scope

- Cached scale math, calibration transaction changes, priority changes, public
  APIs, or logic-analyzer acceptance.

## Implementation Plan

1. Add an injected notification boundary and host-testable wait policy.
2. Register the minimal cache-safe GPIO ISR.
3. Replace unconditional 10 ms sampling wakeups with notify-or-timeout.
4. Cover unavailable and recovery paths.

## Acceptance Criteria

- [ ] ISR only notifies and is allocation-free/logging-free/cache-safe.
  Source/configuration review passes; target map/cache-suspension evidence is
  pending.
- [x] No GPIO clocking or controller work occurs in ISR context.
- [x] Missing data-ready still becomes unavailable within a bounded timeout.
- [x] Ready-before-wait and notification coalescing cannot lose availability.
- [ ] Host, sanitizer, and available target-build checks pass.
  Host and sanitizer checks pass; the pinned target toolchain is unavailable.

## Evidence

- `../evidence/PERF-005-HX711-NOTIFICATION.md`

## Verification Strategy

- Host notification policy tests, firmware suites, target build, and deferred
  PERF-009 logic-analyzer evidence.

## Dependencies

- PERF-004 complete.

## Files Expected To Change

- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`
- `docs/TRACKER.md`
