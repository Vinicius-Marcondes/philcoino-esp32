# PRD-021 software verification

Date: 2026-08-14
Status: PASS — disconnected Human hardware acceptance remains pending

## Automated evidence

| Area | Result |
| --- | --- |
| Protocol | OpenAPI 3.1.1 validation PASS; 8 tests PASS; typecheck PASS |
| Simulator | 15 tests PASS; typecheck PASS |
| Mobile | 138 tests PASS; typecheck PASS; Expo lint PASS |
| Firmware OTA tool | 6 tests PASS; typecheck PASS |
| Firmware host | Normal CTest 9/9 PASS |
| Firmware sanitizers | ASan/UBSan CTest 9/9 PASS |
| Firmware captures | 10 API v4 C++ responses PASS strict Zod validation |
| ESP-IDF target | Clean ESP-IDF 6.0.2 `esp32s3` build PASS |

The clean target build reports firmware 0.5.0, ESP32-S3 image generation,
16 MB flash, the pinned `rbdimmerESP32` commit, OTA slots `0x20000..0x1fffff`
and `0x200000..0x3dffff`, and application size `0x12b620` (38% slot free).

## Covered policy

- Fixed GPIO map/reserved-pin uniqueness and the single 90% cap.
- Both MAX6675 decode paths, zero frame, exact 10°C, greater-than-10°C,
  independent retained baselines, open/reserved/transport/non-finite failure.
- Brew/Boiler and Steam/Steam selection, no fallback/blending, active/inactive
  failure behavior, mode-switch rejection/reset, and both-sensor raw cap.
- Independent calibration/reachability/storage and one global session.
- Existing output failure/race, extraction, weighted extraction, cooldown, OTA,
  synchronization, and watchdog policy.
- API v4 routes/pairing bindings/state/calibration/fault/telemetry agreement.
- Simulator dual values/fault injection/persistence.
- Mobile v4 pairing, dual live/chart/history/trace/CSV, and SQLite v8 migration.

## Not performed

No firmware was flashed. No GPIO, USB, probe, zero-cross, TRIAC, SSR, pressure,
thermal, or energized mains test was performed. Prior C3/single-sensor/SSR/
RobotDyn evidence does not cover this configuration.

Human review remains required with heater and pump loads disconnected for the
exact board headers, electrically ungrounded probes, simultaneous stability and
isolation, boot/reset levels, native USB recovery, CS/SCK/SO waveforms, ZC
detection, dimmer 0% cessation, and 90% timing. Any dual-probe interference
blocks Steam control.
