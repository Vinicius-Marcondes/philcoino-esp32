# STEAM-003 — Validate firmware surfaces and align documentation

Status: Todo
Review Mode: Agent
Review Reason: API serialization, OLED input, contract captures, compatibility,
and documentation claims can be checked deterministically without energized
hardware.

## Goal

Prove that API and OLED surfaces publish the controller's corrected Steam
temperature without a second correction, then align project documentation and
run the complete affected software verification matrix.

## Scope

- Verify firmware API v1/v2 state serialization exposes effective
  `boilerTemperatureC` from the controller snapshot.
- Verify OLED rendering consumes the same effective Steam value and that Brew
  rendering remains raw.
- Cover an unchanged raw sample across Brew-to-Steam and Steam-to-Brew mode
  changes, including the expected `5°C` presentation change and state resets.
- Validate firmware response captures against the unchanged OpenAPI/Zod schema.
- Confirm mobile displays the acknowledged API value without applying its own
  offset and that no offset setting appears in mobile, API, OLED, simulator, or
  persistence surfaces.
- Update architecture, development, tuning, safety, side notes, public safety
  translations, and review visibility to describe implemented behavior and
  deferred calibration evidence accurately.
- Run affected protocol, simulator, mobile, firmware host, contract-capture, and
  target-build checks; record unavailable checks explicitly.

## Non-Scope

- Instrumented boiler calibration, energized testing, dynamic offset controls,
  UI redesign, or changing the approved `5°C` value.
- Closing existing single-sensor, cutoff, SSR, timing, security, or mains-safety
  findings without separate evidence.

## Implementation Plan

1. Add API and display boundary tests around corrected Steam snapshots.
2. Validate all firmware captures against the unchanged shared contract.
3. Run cross-workspace regressions to prevent client- or simulator-side double
   correction.
4. Align current-behavior and safety documentation, explicitly separating
   software evidence from physical calibration.
5. Run the pinned ESP-IDF build when available and record the exact evidence
   level achieved.

## Acceptance Criteria

- [ ] Raw `115°C` in Steam is serialized and rendered as `120°C` exactly once.
- [ ] The same raw sample in Brew is serialized and rendered as `115°C`.
- [ ] Switching modes with an unchanged raw sample produces the documented
  `5°C` value change and preserves all controller reset semantics.
- [ ] Mobile uses the acknowledged `boilerTemperatureC` unchanged and exposes
  no offset control.
- [ ] API v1/v2 shapes, target persistence, target ranges, and mutation flows
  remain compatible.
- [ ] Firmware captures validate through the shared protocol schemas.
- [ ] Documentation identifies the correction as owner-selected and the
  physical gradient as pending repeatable validation.
- [ ] Existing safety blockers remain visible and no software result is
  presented as proof of heater de-energization or physical accuracy.
- [ ] All affected configured checks pass, with unavailable target/hardware
  checks explicitly reported.

## Verification Strategy

- Run OpenAPI validation, protocol tests/typecheck, simulator tests/typecheck,
  and mobile tests/lint/typecheck.
- Build and run the complete firmware host CMake/CTest suite in `/tmp`.
- Generate firmware contract captures and validate them with the existing
  TypeScript capture validator.
- Run the pinned ESP-IDF 6.0.2 target build when its environment is available;
  do not inspect generated firmware directories.
- Review Portuguese and English safety text for matching claims.

## Dependencies

STEAM-002.

## Files Expected To Change

- `firmware/espresso-machine/components/networking/src/api.cpp`
- `firmware/espresso-machine/main/app_main.cpp`
- `firmware/espresso-machine/host-tests/firmware_api_test.cpp`
- `firmware/espresso-machine/host-tests/peripherals_test.cpp`
- `firmware/espresso-machine/host-tests/validate_contract.ts`
- `packages/protocol/fixtures/`
- `apps/mobile/test/`
- `tools/device-simulator/test/`
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/hardware/temperature-control-tuning.md`
- `docs/SAFETY.md`
- `docs/en/SAFETY.md`
- `docs/side-notes.md`
- `CODEBASE_REVIEW_REPORT.md`
