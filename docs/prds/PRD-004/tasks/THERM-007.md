# THERM-007 — Integrate bounded firmware workflow coordination

Status: Todo
Review Mode: Agent
Review Reason: Lock ordering, task deadlines, startup/reset behavior, and output failure paths are code-reviewable and testable at host/target-build level.

## Goal

Integrate compensation and cooldown into the ESP-IDF runtime without allowing cross-domain coordination, HTTP, display, or persistence to extend output deadlines.

## Scope

- Add a single explicit coordination boundary between temperature and pump workflows.
- Enforce Brew-only extraction Start and reject Steam transitions while extraction/cooldown is active.
- Advance cooldown temperature checks, pump cutoff, stabilization, and compensation through bounded synchronization.
- Preserve heater safety lease, dedicated pump timing, boot-off ordering, volatile workflow reset, and single-owner output writes.
- Define fatal/fault handling for missed locks and failed off commands without deadlock-prone nested acquisition.

## Non-Scope

- HTTP route parsing/serialization, mobile behavior, physical timing claims, or energized tests.

## Implementation Plan

1. Define and document lock ownership/order or message/snapshot handoff between domains.
2. Integrate policies into startup and dedicated runtime tasks.
3. Keep network, display, and NVS outside real-time deadlines.
4. Add host seams and run the pinned target build when available.

## Acceptance Criteria

- [ ] No unbounded or cyclic cross-domain lock path is introduced.
- [ ] Heater pulses, pump cutoff, and stabilization deadlines remain independent of HTTP/display/persistence work.
- [ ] Boot/reset/power-cycle state is Brew-compatible, cooldown idle, extraction idle, and both commands off before later startup work.
- [ ] Missed synchronization or failed output commands take the documented fail-off/fault path.
- [ ] Host tests and the pinned ESP-IDF target build pass, or target-toolchain unavailability is recorded.

## Verification Strategy

- Static lock-order review, host concurrency/failure seams, strict host tests, and ESP-IDF 6.0.2 target build.

## Dependencies

- THERM-006.

## Files Expected To Change

- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/components/control/`
- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/host-tests/`
