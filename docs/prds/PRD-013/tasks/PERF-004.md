# PERF-004 — Contain API lock and allocation exposure

Status: Done
Review Mode: Agent
Review Reason: Lock lifetime, response equivalence, and bounded allocation
behavior are deterministic in host and target-build evidence.

## Goal

Copy coherent API snapshots under the workflow mutex, then serialize and build
HTTP responses after unlocking while removing known bounded duplicate work.

## Scope

- Snapshot v1/v2 state, scale, extraction, cooldown, and profiles under lock.
- Serialize after unlock.
- Remove duplicate route/header work and reserve bounded response capacity.
- Preserve byte/shape compatibility and error behavior.

## Non-Scope

- Wholesale codec rewrite, new JSON dependency, public schema change, or
  network-security migration.

## Implementation Plan

1. Characterize current lock ownership per route.
2. Introduce immutable route-specific snapshot inputs.
3. Move serialization/response construction outside the mutex.
4. Measure host behavior and available target resource deltas.

## Acceptance Criteria

- [x] No covered response serialization occurs under the workflow mutex.
- [x] Route/auth/error and wire behavior remain compatible.
- [x] Response storage is bounded and known duplicate work is removed.
- [x] Firmware host, sanitizer, capture, and available target checks pass.

## Evidence

- `../evidence/PERF-004-API-LOCKS.md`

## Verification Strategy

- Lock-aware host fakes, byte-compatible captures, sanitizers, and target
  size/runtime evidence when available.

## Dependencies

- PERF-003 complete.

## Files Expected To Change

- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/host-tests/`
- `docs/TRACKER.md`
