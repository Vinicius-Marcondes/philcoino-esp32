# PRD-020 software verification

Date: 2026-08-06

Status: PASS — NATIVE VISUAL/LIFECYCLE AND CONNECTED-TARGET ACCEPTANCE PENDING

## Implemented boundary

- Device inspection advertises API generation `2`.
- Machine history and firmware profile operations, schemas, storage owners,
  routes, and captures are absent.
- Profile Start strictly carries and echoes the complete immutable profile;
  weighted Start also binds weight control into idempotency.
- Firmware keeps autonomous phase timing, cutoffs, outputs, faults, and the
  independent 320-sample extraction replay ring.
- Mobile profiles are app-wide SecureStore data only.
- Validated foreground states persist indefinitely in SQLite. Dashboard reads
  today; Machine exports all rows in batches and provides confirmed clear-all.
- Every identified extraction creates a durable summary and terminal replay
  upgrades it to complete or leaves it explicitly incomplete. `Shots` is the
  only history list/detail/export/clear surface.

## Automated results

| Area | Result |
| --- | --- |
| OpenAPI 3.1.1 validation | PASS |
| Protocol TypeScript typecheck | PASS |
| Protocol tests | PASS — 156 tests |
| Simulator TypeScript typecheck | PASS |
| Simulator tests | PASS — 90 tests |
| Mobile TypeScript typecheck | PASS |
| Mobile Expo lint | PASS |
| Mobile tests | PASS — 239 tests |
| Thermal-modeling export compatibility | STATIC PASS — current `pump_command` plus legacy aliases configured; targeted pytest unavailable in the installed runtimes |
| Firmware native host suite | PASS — 11/11 |
| Firmware ASan/UBSan host suite | PASS — 11/11 |
| Independent firmware contract captures | PASS — 34 responses |
| Firmware resource budget | PASS — `ControlSnapshot=160`, `BrewPiController=76`; extraction sample/ring/page compile-time limits passed |
| ESP-IDF target build | PASS — ESP-IDF 6.0.2, ESP32-C3 |

The target image is `0x11da80` bytes. The smallest `0x180000` app partition has
`0x62580` bytes (26%) free. The target was compiled only; it was not flashed.

## Evidence not produced

- No native iOS/Android five-tab visual, large-text, restart, locked-screen,
  export/share-sheet, or force-close acceptance was performed.
- No connected-target comparison of API latency, loop deadlines, heap/stack,
  SSE delivery/gaps, Wi-Fi recovery, or REST Stop availability was performed.
- No flashing, energized heater/pump test, wiring change, or physical-safety
  acceptance was performed or inferred.
- The thermal-modeling targeted pytest was not run: the documented `python3.12`
  executable is absent, while the available system and bundled Python runtimes
  do not include the repository's pytest/data-science dependencies. No package
  installation was performed. The alias and `running`/`off` test case were
  added for execution in the configured development environment.

PRD-019 connected acceptance remains pending. PRD-020 must compare the
simplified build against the prior streaming build and confirm that removing
backfill traffic and profile persistence improves or does not regress the
connected metrics above.
