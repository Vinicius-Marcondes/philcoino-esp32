# STEAM-003 — Validate firmware surfaces and align documentation

Status: Done
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

- [x] Raw `115°C` in Steam is serialized and rendered as `120°C` exactly once.
- [x] The same raw sample in Brew is serialized and rendered as `115°C`.
- [x] Switching modes with an unchanged raw sample produces the documented
  `5°C` value change and preserves all controller reset semantics.
- [x] Mobile uses the acknowledged `boilerTemperatureC` unchanged and exposes
  no offset control.
- [x] API v1/v2 shapes, target persistence, target ranges, and mutation flows
  remain compatible.
- [x] Firmware captures validate through the shared protocol schemas.
- [x] Documentation identifies the correction as owner-selected and the
  physical gradient as pending repeatable validation.
- [x] Existing safety blockers remain visible and no software result is
  presented as proof of heater de-energization or physical accuracy.
- [x] All affected configured checks pass, with unavailable target/hardware
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

## Implementation Record

- Completed: 2026-07-14.
- API/OLED evidence: firmware host tests prove raw Steam `115°C` serializes
  through API v1/v2 and formats for OLED as `120°C` exactly once; Brew
  serializes the same raw value as `115°C`. Unchanged safe raw samples produce
  the documented `5°C` API/display input change across mode acknowledgements.
- Client/simulator boundary: mobile view-model tests prove the acknowledged
  `boilerTemperatureC` is used unchanged. Simulator tests prove its configured
  Steam temperature remains the already-effective logical value and receives
  no firmware correction.
- Regression evidence: OpenAPI validation passed; protocol passed 71 tests/147
  expectations and typecheck; simulator passed 44 tests/215 expectations and
  typecheck; mobile passed 79 tests/254 expectations, Expo lint, and typecheck;
  a fresh strict C++17 build in `/tmp/philcoino-prd003-final-host` passed 4/4
  CTest cases; 14 generated firmware response captures passed the shared Zod
  validator.
- Unavailable check: the pinned ESP-IDF 6.0.2 target build was not run because
  `idf.py` is absent from `PATH` and `IDF_PATH` is unset. No toolchain,
  dependency, package, CLI, or SDK was installed or modified.
- Compatibility: API paths, numeric schemas, field names, target ranges,
  persisted target/profile structures, error shapes, and mobile mutation flows
  are unchanged.
- Safety evidence: these are software checks only. No physical calibration,
  sensor-placement validation, heater/SSR observation, wiring work, or
  energized test was performed or inferred.
- Commit: This commit.
