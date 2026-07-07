# PRD-001 Tracker

PRD Status: Active
Current Task: PHIL-012 (not started)

Implementation Boundary: PHIL-001 through PHIL-011 are complete. PHIL-012 is
the next task; PHIL-013 has not started.

## Summary

Build the local iPhone and ESP32-C3 system for discovery, authenticated monitoring, persisted temperature targets, and brew/steam temperature-mode selection.

PRD: `docs/prds/PRD-001/PRD-001.md`

## Temporary Hardware State

- Dual-MAX6675 low-voltage testing became stable after the wiring and protoboard
  were replaced and both sensors reached thermal equilibrium. Earlier bus
  contention was not confirmed as a module defect.
- `kDualThermocouplesEnabled` is temporarily `false`. Firmware reads only the
  brew sensor on SCK/SO/CS GPIO4/GPIO6/GPIO7 every 500 ms and mirrors its value
  for steam-mode control. The steam sensor bus remains disabled by control logic.
- Wi-Fi is enabled. Brew/steam targets, mode-specific over-temperature limits,
  readiness timing, heating timeout, and steam timeout remain active.
- This single-sensor diagnostic configuration does not satisfy final PHIL-013
  dual-sensor acceptance.
- PHIL-009 mobile discovery and pairing work is not blocked by the temporary
  sensor mode.

## Git

- Branch: `feature/PRD-001-espresso-control`
- Actual branch point: `main` at `1246ad0`
- Planned merge target: `develop` (not present locally as of 2026-07-04)

## Execution State

| Task | Review | Status | Evidence | Decision Log | Commit | Blocked Reason | Requested Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [PHIL-001](prds/PRD-001/tasks/PHIL-001.md) | Agent | Done | `bun run lint`, `bun run typecheck`, Expo SDK 54 config, and 7-route web export passed | Mobile isolated in `apps/mobile`; root delegates scripts; workspace globs reserve apps/packages/tools; firmware stays outside Bun and empty reserved directories are deferred per architecture | `01ebbe1` | None | None |
| [PHIL-002](prds/PRD-001/tasks/PHIL-002.md) | Agent | Done | 35 protocol tests, protocol/mobile typechecks, mobile lint, and OpenAPI validation passed | OpenAPI 3.1.1 JSON-compatible YAML is authoritative; Zod 4.4.3 schemas are strict; snapshots expose brew/steam temperatures and require heater off on faults; mutations return acknowledged persisted state | `fc047a7` | None | None |
| [PHIL-003](prds/PRD-001/tasks/PHIL-003.md) | Agent | Done | 20 simulator tests, simulator/protocol/mobile typechecks, 35 protocol tests, mobile lint, OpenAPI validation, and localhost health smoke test passed | Hono 4.12.27 is pinned; manual time drives deterministic readiness and steam timeout; power-cycle preserves targets while full reset restores defaults; simulator-only controls remain outside `/api/v1` | `35305be` | None | None |
| [PHIL-004](prds/PRD-001/tasks/PHIL-004.md) | Human | Done | ESP-IDF v6.0.2 ESP32-C3 build, 1 host test, 55 protocol/simulator tests, all typechecks, mobile lint, and OpenAPI validation passed; human-approved 2026-07-04 | IDF 6.0.2 and mDNS 1.11.3 pinned; MAC-derived ID and PhilcoINO name; approved thermal/time/GPIO/OLED constants; secrets stay in ignored sdkconfig; direct GPIO20 SSR drive without pull-down retained as documented human-approved risk | `d627a99` | None | None |
| [PHIL-005](prds/PRD-001/tasks/PHIL-005.md) | Agent | Done | ESP-IDF v6.0.2 ESP32-C3 build, 2/2 host tests, and strict C++17 syntax check passed; user confirmed low-voltage verification 2026-07-04 | Pure C++ boundaries wrap IDF SPI/I2C/NVS/GPIO; MAX6675 reads are sequential at 220 ms; targets use one validated NVS blob; SSR is driven low before output configuration; OLED renders four essential-state lines; portable integer formatting uses `PRId32` | `dd6c90b` | None | None |
| [PHIL-006](prds/PRD-001/tasks/PHIL-006.md) | Agent | Done | Host CMake build and 3/3 host tests passed; ESP-IDF build could not run because local IDF v6.0.2 export/idf.py is unavailable; approved 2026-07-05 | Pure C++ control component owns brew boot default, validated persisted targets, readiness timing, steam timeout, fault latching, and SSR fail-off; both sensors are checked for validity and over-temperature in every mode | This commit | None | None |
| [PHIL-007](prds/PRD-001/tasks/PHIL-007.md) | Agent | Done | ESP-IDF v6.0.2 ESP32-C3 build, 4/4 host tests, 7 firmware contract captures, 35 protocol tests, 20 simulator tests, OpenAPI validation, and protocol/simulator typechecks passed; user confirmed full build 2026-07-05 | Strict host-testable API owns constant-time bearer verification, parsing, serialization, and control delegation; asynchronous ESP-IDF networking serves port 80 and advertises camelCase identity/version TXT metadata without blocking control; factory app partition is 1.5 MiB | This commit | None | None |
| [PHIL-008](prds/PRD-001/tasks/PHIL-008.md) | Agent | Done | 15 mobile tests, mobile/protocol/simulator typechecks, mobile lint, 35 protocol tests, 20 simulator tests, OpenAPI validation, and Expo SDK 54 config introspection passed; user-approved 2026-07-05 | Strict protocol schemas gate all returned data; Expo fetch is isolated behind an injected client; requests use a 5 s default/30 s maximum timeout and first-cause cancellation; one strict SecureStore record holds device ID, normalized address, and token; cancelled requests do not change connection state | This commit | None | None |
| [PHIL-009](prds/PRD-001/tasks/PHIL-009.md) | Human | Done | 23 mobile tests including simulator pairing/recovery, mobile lint/typecheck, 20 simulator tests/typecheck, 35 protocol tests/typecheck, OpenAPI validation, Expo SDK 54 config introspection, and web export passed; human-approved 2026-07-05 with physical-iPhone checks deferred in `docs/side-notes.md` | `react-native-zeroconf` 0.14.0 is isolated behind a discovery adapter; firmware TXT metadata is strictly parsed; pairing saves only after public identity and authenticated-state verification; startup tries the cached address first and re-verifies stable ID plus authentication before saving a rediscovered address; owner approved software completion while deferring hardware review | `024d740` | None | None |
| [PHIL-010](prds/PRD-001/tasks/PHIL-010.md) | Human | Done | 30 mobile tests, mobile/protocol/simulator typechecks, mobile lint, 35 protocol tests, 20 simulator tests, OpenAPI validation, Expo SDK 54 config introspection, and web export passed; human-approved 2026-07-05 with physical-iPhone checks deferred in `docs/side-notes.md` | Completion-driven one-second polling prevents overlap; Expo Router focus and React Native AppState cancel active work; connection failures clear live values; app connection and firmware status remain separate; dashboard controls stay read-only; owner approved software completion while deferring hardware review | This commit | None | None |
| [PHIL-011](prds/PRD-001/tasks/PHIL-011.md) | Human | Done | 38 mobile tests, mobile lint/typecheck, 35 protocol tests/typecheck, 20 simulator tests/typecheck, OpenAPI validation, Expo SDK 54 config introspection, and web export passed; human-approved 2026-07-06 with physical-iPhone checks deferred in `docs/side-notes.md` | Whole-degree bounded steppers keep edits as drafts until inline confirmation; polling pauses during mutations; only validated firmware acknowledgements update displayed targets/mode; firmware rejections remain visible and disconnects clear live state without false success; owner approved software completion while deferring physical-iPhone review | This commit | None | None |
| [PHIL-012](prds/PRD-001/tasks/PHIL-012.md) | Agent | Todo | Pending | Pending | Pending | None | None |
| [PHIL-013](prds/PRD-001/tasks/PHIL-013.md) | Human | Todo | Pending | Pending | Pending | None | None |
