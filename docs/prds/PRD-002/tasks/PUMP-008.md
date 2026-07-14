# PUMP-008 — Validate extraction end to end and align documentation

Status: Done
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

- [x] Mobile and simulator complete every acknowledged profile/manual workflow and recover without false success after failures.
- [x] Firmware captures, simulator responses, Zod, and OpenAPI agree for v1 and v2.
- [x] Delayed work, disconnect, replay, conflict, reset, and fault scenarios preserve the 60-second/off invariants.
- [x] Documentation distinguishes GPIO command from physical pump state and keeps cleartext/security and mains findings visible.
- [x] All configured affected checks pass, with unavailable checks explicitly reported.

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

## Implementation Evidence

- Changed behavior: the mobile/simulator integration test now exercises profile
  export, pre-infusion, soak command-off, a concurrent heater fault, main
  extraction, same-key replay without timing reset, and acknowledged Stop.
  Firmware host coverage supplies delayed-update, wraparound, output-failure,
  reset/boot initialization, replay/conflict, and exact cutoff evidence.
- Cross-contract evidence: 13 firmware response captures (eight v1 classes and
  five v2 classes) parse through the shared strict Zod schemas; OpenAPI examples,
  fixtures, simulator responses, and mobile client parsing remain aligned.
- Documentation: architecture, API outlines, development workflow, GPIO10
  wiring, safety in both languages, side notes, README files, documentation
  indexes, and the codebase review addendum now describe implemented API v2 and
  preserve all command-state, cleartext, credential, heater, and mains findings.
- Verification: 77 mobile tests, mobile typecheck/lint, 43 simulator tests and
  typecheck, 69 protocol tests and typecheck, OpenAPI validation, strict C++17
  build, 4/4 firmware host executables, and 13 capture validations passed.
- Compatibility and safety: API v1 remains unchanged and temperature-only. API
  v2 is additive. `running`/`off` remain GPIO10 command state only; no software
  or simulator result claims current, flow, switch position, SSR output, or
  physical de-energization.
- Not run: pinned ESP-IDF 6.0.2 target build (`idf.py` unavailable), native
  iOS/Android review, flash, disconnected GPIO10 measurement, and all energized
  hardware work.
- Remaining human acceptance: all PUMP-009 target, low-voltage, hardware
  identity/instrument, mobile-on-target, and explicit owner acceptance steps.
