# PUMP-008 — Validate extraction end to end and align documentation

Status: Todo
Review Mode: Agent
Review Reason: Cross-workspace contract, timing, recovery, compatibility, and documentation claims can be checked deterministically without energized hardware.

## Goal

Prove API v2 extraction behavior across protocol, simulator, mobile, and firmware and align all public safety and architecture documentation.

## Scope

- Add end-to-end scenarios for profiles, export, Start replay/conflict, phases, Manual cutoff, Stop, disconnect, reset, faults, and malformed data.
- Validate firmware captures and simulator responses against OpenAPI/Zod.
- Prove API v1 compatibility and prevent undocumented physical-state claims.
- Update architecture, protocol outline, development workflows, wiring, safety, side notes, README files, and review visibility.
- Document exact evidence levels and remaining security/mains blockers.

## Non-Scope

- Energized tests, API v1 retirement, App Store release, or closing unrelated review findings without evidence.

## Implementation Plan

1. Add reusable v2 cross-workspace scenarios and drift checks.
2. Run full affected workspace and firmware verification matrices.
3. Update documentation to match implemented behavior and limitations.
4. Record unavailable toolchain/hardware checks explicitly for human follow-up.

## Acceptance Criteria

- [ ] Mobile and simulator complete every acknowledged profile/manual workflow and recover without false success after failures.
- [ ] Firmware captures, simulator responses, Zod, and OpenAPI agree for v1 and v2.
- [ ] Delayed work, disconnect, replay, conflict, reset, and fault scenarios preserve the 60-second/off invariants.
- [ ] Documentation distinguishes GPIO command from physical pump state and keeps cleartext/security and mains findings visible.
- [ ] All configured affected checks pass, with unavailable checks explicitly reported.

## Verification Strategy

- Root/workspace tests, lint/typechecks, OpenAPI validation, simulator integration, firmware host CMake suite, capture validation, and pinned ESP-IDF target build when available.

## Dependencies

- PUMP-004 and PUMP-007.

## Files Expected To Change

- `apps/mobile/test/`
- `packages/protocol/test/`
- `tools/device-simulator/test/`
- `firmware/espresso-machine/host-tests/`
- `docs/`
- `README.md`
