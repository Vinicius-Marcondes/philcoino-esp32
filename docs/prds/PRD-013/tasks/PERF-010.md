# PERF-010 — Remove OLED support

Status: Done
Implementation Commit: `34dafe0`
Review Mode: Agent
Review Reason: Source/configuration/dependency removal and target size are
deterministic through search, builds, and tests; physical GPIO reuse is absent.

## Goal

Remove the disabled OLED implementation, configuration, tests, ESP-IDF I2C
dependency, startup paths, and stale current-hardware claims.

## Scope

- Delete SSD1306 renderer/framebuffer and ESP-IDF I2C transport.
- Remove OLED flags, GPIO assignments, startup/render branches, tests, and
  component dependency.
- Mark GPIO8/GPIO9 unassigned.
- Preserve historical/safety documentation that still explains past decisions.

## Non-Scope

- Assigning GPIO8/GPIO9 to new hardware, changing APIs, removing active
  profiles/history/scale/prediction, or unrelated cleanup.

## Implementation Plan

1. Confirm every OLED symbol and caller.
2. Remove production, configuration, dependency, and test surface.
3. Align current-state documentation while preserving historical records.
4. Compare target image with PERF-001 when the toolchain is available.

## Acceptance Criteria

- [x] OLED symbols, source, configuration, tests, and `esp_driver_i2c` are
  absent from active firmware.
- [x] GPIO8/GPIO9 are unassigned.
- [x] Startup and safety behavior remain fail-off.
- [x] Firmware suites pass; the target build is unavailable.
- [x] Target image delta is explicitly pending because comparable target
  evidence is unavailable.

## Evidence

- `../evidence/PERF-010-OLED-REMOVAL.md`

## Verification Strategy

- Call-graph search, firmware host/sanitizer/capture tests, target build/size,
  and documentation link checks.

## Dependencies

- PERF-009 software/target audit complete; Human evidence may remain pending.

## Files Expected To Change

- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/components/firmware_config/`
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`
- current-state firmware/architecture/safety documentation
- `docs/TRACKER.md`
