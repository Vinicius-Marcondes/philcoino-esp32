# PRD-001 Tracker

PRD Status: Active
Current Task: PHIL-003

## Summary

Build the local iPhone and ESP32-C3 system for discovery, authenticated monitoring, persisted temperature targets, and brew/steam temperature-mode selection.

PRD: `docs/prds/PRD-001/PRD-001.md`

## Git

- Branch: `feature/PRD-001-espresso-control`
- Base: `develop`
- Merge target: `develop`

## Execution State

| Task | Review | Status | Evidence | Decision Log | Commit | Blocked Reason | Requested Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [PHIL-001](prds/PRD-001/tasks/PHIL-001.md) | Agent | Review | `bun run lint`, `bun run typecheck`, Expo SDK 54 config, and 7-route web export passed | Mobile isolated in `apps/mobile`; root delegates scripts; workspace globs reserve apps/packages/tools; firmware stays outside Bun and empty reserved directories are deferred per architecture | Pending | None | None |
| [PHIL-002](prds/PRD-001/tasks/PHIL-002.md) | Agent | Done | 35 protocol tests, protocol/mobile typechecks, mobile lint, and OpenAPI validation passed | OpenAPI 3.1.1 JSON-compatible YAML is authoritative; Zod 4.4.3 schemas are strict; snapshots expose brew/steam temperatures and require heater off on faults; mutations return acknowledged persisted state | Pending | None | None |
| [PHIL-003](prds/PRD-001/tasks/PHIL-003.md) | Agent | Done | 20 simulator tests, simulator/protocol/mobile typechecks, 35 protocol tests, mobile lint, OpenAPI validation, and localhost health smoke test passed | Hono 4.12.27 is pinned; manual time drives deterministic readiness and steam timeout; power-cycle preserves targets while full reset restores defaults; simulator-only controls remain outside `/api/v1` | This commit | None | None |
| [PHIL-004](prds/PRD-001/tasks/PHIL-004.md) | Human | Done | ESP-IDF v6.0.2 ESP32-C3 build, 1 host test, 55 protocol/simulator tests, all typechecks, mobile lint, and OpenAPI validation passed; human-approved 2026-07-04 | IDF 6.0.2 and mDNS 1.11.3 pinned; MAC-derived ID and PhilcoINO name; approved thermal/time/GPIO/OLED constants; secrets stay in ignored sdkconfig; direct GPIO20 SSR drive without pull-down retained as documented human-approved risk | This commit | None | None |
| [PHIL-005](prds/PRD-001/tasks/PHIL-005.md) | Agent | Review | ESP-IDF v6.0.2 ESP32-C3 build, 2/2 host tests, and strict C++17 syntax check passed; user confirmed low-voltage verification 2026-07-04 | Pure C++ boundaries wrap IDF SPI/I2C/NVS/GPIO; MAX6675 reads are sequential at 220 ms; targets use one validated NVS blob; SSR is driven low before output configuration; OLED renders four essential-state lines; portable integer formatting uses `PRId32` | This commit | None | None |
| [PHIL-006](prds/PRD-001/tasks/PHIL-006.md) | Agent | Todo | Pending | Pending | Pending | None | None |
| [PHIL-007](prds/PRD-001/tasks/PHIL-007.md) | Agent | Todo | Pending | Pending | Pending | None | None |
| [PHIL-008](prds/PRD-001/tasks/PHIL-008.md) | Agent | Todo | Pending | Pending | Pending | None | None |
| [PHIL-009](prds/PRD-001/tasks/PHIL-009.md) | Human | Todo | Pending | Pending | Pending | None | None |
| [PHIL-010](prds/PRD-001/tasks/PHIL-010.md) | Human | Todo | Pending | Pending | Pending | None | None |
| [PHIL-011](prds/PRD-001/tasks/PHIL-011.md) | Human | Todo | Pending | Pending | Pending | None | None |
| [PHIL-012](prds/PRD-001/tasks/PHIL-012.md) | Agent | Todo | Pending | Pending | Pending | None | None |
| [PHIL-013](prds/PRD-001/tasks/PHIL-013.md) | Human | Todo | Pending | Pending | Pending | None | None |
