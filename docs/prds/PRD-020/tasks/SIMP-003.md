# SIMP-003 — Simplify firmware ownership

Status: Done
Review Mode: Agent
Review Reason: Host, sanitizer, characterization, resource, and target checks are deterministic.

## Goal

Remove firmware history/profile persistence while preserving safe autonomous
execution of an inline profile.

## Scope

- Remove profile NVS interfaces/adapters/startup and machine-history capture/API.
- Validate, latch, serialize, and idempotently compare inline profiles.
- Preserve extraction replay, workflows, fail-off behavior, and safety limits.

## Non-Scope

- Mobile UI or energized physical approval.

## Implementation Plan

1. Simplify controller and codec types around one supplied profile.
2. Remove obsolete persistence, history, routes, and startup wiring.
3. Update host, characterization, resource, and target evidence.

## Acceptance Criteria

- [x] No profile NVS or machine-history code remains in the active firmware path.
- [x] A latched profile completes after disconnection and cannot change mid-shot.
- [x] Existing control and safety tests remain green.

## Verification Strategy

- Run native/ASan/UBSan host suites, capture validation, resource checks, and the
  pinned ESP-IDF 6.0.2 ESP32-C3 build when available.

## Dependencies

- SIMP-001 and SIMP-002.

## Files Expected To Change

- `firmware/espresso-machine/components/`
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`
