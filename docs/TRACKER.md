# PRD-021 Tracker

PRD Status: Software Implemented — Disconnected Human Acceptance Pending
Current Task: [S3TEMP-007](prds/PRD-021/tasks/S3TEMP-007.md) — Verify and document the S3 dual-sensor system

Implementation Boundary: Replace the ESP32-C3/single-sensor generation with one
ESP32-S3 N16R8 generation whose firmware independently owns Boiler and Steam
temperature validation, calibration, control, and fail-off behavior.

## Summary

The S3 migration adds a near-valve Steam MAX6675, coordinated API v4, and
two-temperature mobile/simulator/history support without fallback, predictive
control, pressure regulation, or energized acceptance.

PRD: `docs/prds/PRD-021/PRD-021.md`

## Compatibility and Safety Boundary

- API v4 is a coordinated firmware/mobile cutover with no v3 compatibility shim.
- Brew uses the Boiler sensor and Steam uses the Steam sensor; firmware never
  blends or automatically falls back between them.
- Either raw sensor retains independent 135°C protection; an invalid active
  sensor commands heater OFF immediately.
- Software and simulator verification do not validate the new board, probe
  isolation, mains wiring, thermal response, or physical output state.

## Git

- Branch: `codex/esp32-s3-n16r8-migration`
- Base: `codex/robotdyn-pump-dimmer` at `5930b48`
- Merge target: `main` after the RobotDyn baseline is integrated

## Execution State

| Task | Review | Status | Evidence | Decision Log | Commit | Blocked Reason | Requested Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [S3TEMP-001](prds/PRD-021/tasks/S3TEMP-001.md) | Agent | Done | Protocol test/typecheck/OpenAPI validation | Coordinated API v4 cutover | Pending | None | None |
| [S3TEMP-002](prds/PRD-021/tasks/S3TEMP-002.md) | Agent | Done | Config/peripheral tests + clean S3 target build | Fixed S3 map/shared MAX6675 bus | Pending | None | None |
| [S3TEMP-003](prds/PRD-021/tasks/S3TEMP-003.md) | Agent | Done | Normal + ASan/UBSan control/storage/race tests | Fixed sensor ownership; no fallback | Pending | None | None |
| [S3TEMP-004](prds/PRD-021/tasks/S3TEMP-004.md) | Agent | Done | 9/9 host tests + 10 strict v4 captures + 6 OTA tests + S3 build | CPU1 control/CPU0 network affinity | Pending | None | None |
| [S3TEMP-005](prds/PRD-021/tasks/S3TEMP-005.md) | Agent | Done | 15 simulator tests + typecheck | Deterministic dual model only | Pending | None | None |
| [S3TEMP-006](prds/PRD-021/tasks/S3TEMP-006.md) | Agent | Done | 138 mobile tests + typecheck + lint | SQLite v8/null legacy Steam | Pending | None | None |
| [S3TEMP-007](prds/PRD-021/tasks/S3TEMP-007.md) | Human | Awaiting Review | Docs aligned; automated matrix passed | No flashing or energized evidence | Pending | None | Confirm disconnected board/probe/USB/waveform/dimmer checks |
