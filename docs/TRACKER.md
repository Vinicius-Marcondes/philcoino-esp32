# PRD-002 Tracker

PRD Status: Active
Current Task: None in requested range; PUMP-009 human functional review accepted, with broader PRD evidence deferred

Implementation Boundary: PUMP-001 through PUMP-009 are complete at their recorded review level. PRD-level target fault-injection, timer-wrap waveform, and separately authorized energized evidence remain deferred.

## Summary

Add mobile-controlled Manual and timed-profile extraction through a firmware-owned
GPIO10 pump command, explicit profile export, and API v2 while retaining API v1.

PRD: `docs/prds/PRD-002/PRD-002.md`

## Safety Boundary

- `running` and `off` describe only the GPIO10 command, not measured pump current,
  physical switch position, SSR output, flow, or confirmed de-energization.
- Software, simulator, host, target-build, and disconnected low-voltage work may
  proceed; energized work remains separately approval-gated under `docs/SAFETY.md`.
- Existing relevant security, timing, and mains-safety findings remain visible and
  are not closed by PRD-002 approval or the owner's report that the pump SSR works.

## Git

- Branch: `feature/PRD-002-pump-extraction`
- Base: `develop`
- Merge target: `develop`

## Execution State

| Task | Review | Status | Evidence | Decision Log | Commit | Blocked Reason | Requested Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [PUMP-001](prds/PRD-002/tasks/PUMP-001.md) | Agent | Done | OpenAPI validation, 69 protocol tests, protocol/mobile/simulator typechecks, mobile lint, 25 simulator tests, 4/4 firmware host tests, and 8 firmware contract captures passed; mobile suite had one pre-existing debug-env failure outside this task | API v2 uses four ordered immutable `profile-1`…`profile-4` slots, separate v2 errors, acknowledged phase-bound GPIO command state, same-key replay, and active conflict state; v1 paths/schemas/errors remain unchanged | Pending | None | None |
| [PUMP-002](prds/PRD-002/tasks/PUMP-002.md) | Human | Done | Refined preview passed 69 mobile tests/217 expectations, mobile lint/typecheck, Expo SDK 54 config, and debug web export; Human-approved 2026-07-12 | Debug-only bottom navigation separates Dashboard, Profiles, and Machine; compact extraction controls follow current machine state, profile configuration/export has its own page, and an active-extraction bar remains visible across pages | Pending | None | None |
| [PUMP-003](prds/PRD-002/tasks/PUMP-003.md) | Agent | Done | 43 simulator tests/212 expectations, simulator/protocol/mobile typechecks, 69 protocol tests, 69 mobile tests, OpenAPI validation, and mobile lint passed | Manual time owns extraction phases/cutoff; persisted profile is snapshotted at Start; same-key replay preserves elapsed time; profile replacement is whole-set/idle-only with one-shot failure injection; faults remain independent | Pending | None | None |
| [PUMP-004](prds/PRD-002/tasks/PUMP-004.md) | Agent | Done | 77 mobile tests, mobile lint/typecheck, 43 simulator tests/typecheck, 69 protocol tests/typecheck, OpenAPI validation, Expo SDK 54 config, and web export passed | Strict SecureStore profile set seeds once; one API v2 poll publishes machine/extraction together; all mutations serialize; local/machine sets update only after storage/device acknowledgement; unacknowledged Start retries reuse a key | Pending | None | None |
| [PUMP-005](prds/PRD-002/tasks/PUMP-005.md) | Agent | Done | Strict C++17 build and 4/4 host tests passed; 8 firmware v1 captures, 77 mobile tests, 43 simulator tests, 69 protocol tests, all configured typechecks/lint/OpenAPI checks, Expo config, and web export passed; ESP-IDF target build unavailable | GPIO10 initializes low before configuration and all noncritical startup; pump command and heater lease remain independent; profiles use one validated versioned NVS blob; failed writes report command `off` without physical claims | Pending | None | Target build and disconnected low-voltage acceptance remain in later tasks |
| [PUMP-006](prds/PRD-002/tasks/PUMP-006.md) | Agent | Done | Strict C++17 build and 4/4 host tests passed, including exact phase boundaries, delayed completion, same-key replay, conflicts, persistence rollback, output failure, disconnect equivalence, heater-fault independence, and timer wraparound | Dedicated monotonic extraction policy owns immutable profile snapshots, idempotency, phase transitions, and pump fail-off; a high-priority task keeps deadlines independent from heater/network/display/persistence work | Pending | None | Target build and disconnected low-voltage acceptance remain in PUMP-007/PUMP-009 |
| [PUMP-007](prds/PRD-002/tasks/PUMP-007.md) | Agent | Done | Strict C++17 build and 4/4 host tests, 13 firmware captures, OpenAPI validation, 69 protocol tests, and protocol typecheck passed; device log later exposed and guided correction of the default URI-handler limit; host/capture checks repassed | API v2 uses strict independent C++ parsing; bounded temperature/extraction locks are separate; profile NVS and HTTP transmission occur outside the extraction lock; HTTP handler capacity derives from the 12-route table; OLED labels only the GPIO10 command and phase | Pending | None | Rebuilt target must confirm HTTP/mDNS startup; full pinned target evidence remains PUMP-009 |
| [PUMP-008](prds/PRD-002/tasks/PUMP-008.md) | Agent | Done | 77 mobile tests/lint/typecheck, 43 simulator tests/typecheck, 69 protocol tests/typecheck, OpenAPI validation, strict C++17 build, 4/4 firmware host tests, and 13 captures passed | Cross-layer scenarios cover acknowledged export/phases/replay/conflict/Stop/fault/reset/failures; public docs distinguish command state and preserve security/mains findings | Pending | None | ESP-IDF target build unavailable and explicitly deferred |
| [PUMP-009](prds/PRD-002/tasks/PUMP-009.md) | Human | Done | Owner accepted the 2026-07-14 target functional checklist: rebuilt HTTP/mDNS reachability, Manual and seeded profiles, Stop/cutoff, disconnect continuation, reset/power-cycle no-resume, and command-only mobile wording; final regression passed 79 mobile, 69 protocol, 43 simulator, 4/4 firmware host tests, OpenAPI/lint/typechecks, and 13 captures; no agent-observed waveform or energized evidence | Human acceptance closes the functional task while raw GPIO captures, exact board/build/instrument identifiers, injected GPIO failure, target timer-wrap evidence, and any energized safety evidence remain explicitly deferred | Pending | None for task closure; broader PRD/hardware acceptance evidence remains incomplete | Preserve the deferred evidence and unresolved security/mains findings; do not infer physical pump state from `running`/`off` |

---

# PRD-001 Tracker (preserved incomplete work)

PRD Status: Active
Current Task: PHIL-012 (not started)

Implementation Boundary: PHIL-001 through PHIL-011 are complete. PHIL-012 is
the next task; PHIL-013 has not started.

## Summary

Build the local iPhone and ESP32-C3 system for discovery, authenticated monitoring, persisted temperature targets, and brew/steam temperature-mode selection.

PRD: `docs/prds/PRD-001/PRD-001.md`

## Current Hardware State

- The owner approved a permanent single-sensor design after two thermocouples
  attached to the metal boiler interfered with reliable readings.
- Firmware reads the boiler-base MAX6675 on SCK/SO/CS GPIO4/GPIO6/GPIO7 every
  500 ms. This one measurement controls both modes and is exposed as
  `boilerTemperatureC`; the removed second-sensor GPIOs and mirroring logic no
  longer exist.
- Wi-Fi is enabled. Brew/steam targets, mode-specific over-temperature limits,
  readiness timing, heating timeout, and steam timeout remain active.
- Current source has `kOledEnabled` set to `true`, so OLED initialization or
  rendering failure stops control startup. This conflicts with the earlier
  temporary disabled-OLED diagnostic decision and must be resolved before the
  next hardware test.
- PHIL-013 must validate the single sensor against an independent instrument
  and treat the lack of sensor redundancy as an accepted hardware limitation,
  not evidence of energized safety.
- Neither the unresolved OLED configuration discrepancy nor a disabled-display
  diagnostic configuration satisfies final OLED display acceptance.
- PHIL-009 mobile discovery and pairing work is not blocked by the temporary
  permanent single-sensor architecture.

## Git

- Branch: `feature/PRD-001-espresso-control`
- Actual branch point: `main` at `1246ad0`
- Planned merge target: `develop` (not present locally as of 2026-07-04)

## Execution State

| Task | Review | Status | Evidence | Decision Log | Commit | Blocked Reason | Requested Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [PHIL-001](prds/PRD-001/tasks/PHIL-001.md) | Agent | Done | `bun run lint`, `bun run typecheck`, Expo SDK 54 config, and 7-route web export passed | Mobile isolated in `apps/mobile`; root delegates scripts; workspace globs reserve apps/packages/tools; firmware stays outside Bun and empty reserved directories are deferred per architecture | `01ebbe1` | None | None |
| [PHIL-002](prds/PRD-001/tasks/PHIL-002.md) | Agent | Done | 35 protocol tests, protocol/mobile typechecks, mobile lint, and OpenAPI validation passed | OpenAPI 3.1.1 JSON-compatible YAML is authoritative; Zod 4.4.3 schemas are strict; the original paired-temperature snapshot was superseded by one `boilerTemperatureC`; faults require heater off and mutations return acknowledged persisted state | `fc047a7` | None | None |
| [PHIL-003](prds/PRD-001/tasks/PHIL-003.md) | Agent | Done | 20 simulator tests, simulator/protocol/mobile typechecks, 35 protocol tests, mobile lint, OpenAPI validation, and localhost health smoke test passed | Hono 4.12.27 is pinned; manual time drives deterministic readiness and steam timeout; power-cycle preserves targets while full reset restores defaults; simulator-only controls remain outside `/api/v1` | `35305be` | None | None |
| [PHIL-004](prds/PRD-001/tasks/PHIL-004.md) | Human | Done | ESP-IDF v6.0.2 ESP32-C3 build, 1 host test, 55 protocol/simulator tests, all typechecks, mobile lint, and OpenAPI validation passed; human-approved 2026-07-04 | IDF 6.0.2 and mDNS 1.11.3 pinned; MAC-derived ID and PhilcoINO name; approved thermal/time/GPIO/OLED constants; secrets stay in ignored sdkconfig; direct GPIO20 SSR drive without pull-down retained as documented human-approved risk | `d627a99` | None | None |
| [PHIL-005](prds/PRD-001/tasks/PHIL-005.md) | Agent | Done | ESP-IDF v6.0.2 ESP32-C3 build, 2/2 host tests, and strict C++17 syntax check passed; user confirmed low-voltage verification 2026-07-04 | Pure C++ boundaries wrap IDF SPI/I2C/NVS/GPIO; MAX6675 reads are sequential at 220 ms; targets use one validated NVS blob; SSR is driven low before output configuration; OLED renders four essential-state lines; portable integer formatting uses `PRId32` | `dd6c90b` | None | None |
| [PHIL-006](prds/PRD-001/tasks/PHIL-006.md) | Agent | Done | Host CMake build and 3/3 host tests passed; ESP-IDF build could not run because local IDF v6.0.2 export/idf.py is unavailable; approved 2026-07-05 | Pure C++ control component owns brew boot default, validated persisted targets, readiness timing, steam timeout, fault latching, and SSR fail-off; its original dual-sensor scope is superseded by the permanent single-boiler-sensor decision | This commit | None | None |
| [PHIL-007](prds/PRD-001/tasks/PHIL-007.md) | Agent | Done | ESP-IDF v6.0.2 ESP32-C3 build, 4/4 host tests, 7 firmware contract captures, 35 protocol tests, 20 simulator tests, OpenAPI validation, and protocol/simulator typechecks passed; user confirmed full build 2026-07-05 | Strict host-testable API owns constant-time bearer verification, parsing, serialization, and control delegation; asynchronous ESP-IDF networking serves port 80 and advertises camelCase identity/version TXT metadata without blocking control; factory app partition is 1.5 MiB | This commit | None | None |
| [PHIL-008](prds/PRD-001/tasks/PHIL-008.md) | Agent | Done | 15 mobile tests, mobile/protocol/simulator typechecks, mobile lint, 35 protocol tests, 20 simulator tests, OpenAPI validation, and Expo SDK 54 config introspection passed; user-approved 2026-07-05 | Strict protocol schemas gate all returned data; Expo fetch is isolated behind an injected client; requests use a 5 s default/30 s maximum timeout and first-cause cancellation; one strict SecureStore record holds device ID, normalized address, and token; cancelled requests do not change connection state | This commit | None | None |
| [PHIL-009](prds/PRD-001/tasks/PHIL-009.md) | Human | Done | 23 mobile tests including simulator pairing/recovery, mobile lint/typecheck, 20 simulator tests/typecheck, 35 protocol tests/typecheck, OpenAPI validation, Expo SDK 54 config introspection, and web export passed; human-approved 2026-07-05 with physical-iPhone checks deferred in `docs/side-notes.md` | `react-native-zeroconf` 0.14.0 is isolated behind a discovery adapter; firmware TXT metadata is strictly parsed; pairing saves only after public identity and authenticated-state verification; startup tries the cached address first and re-verifies stable ID plus authentication before saving a rediscovered address; owner approved software completion while deferring hardware review | `024d740` | None | None |
| [PHIL-010](prds/PRD-001/tasks/PHIL-010.md) | Human | Done | 30 mobile tests, mobile/protocol/simulator typechecks, mobile lint, 35 protocol tests, 20 simulator tests, OpenAPI validation, Expo SDK 54 config introspection, and web export passed; human-approved 2026-07-05 with physical-iPhone checks deferred in `docs/side-notes.md` | Completion-driven one-second polling prevents overlap; Expo Router focus and React Native AppState cancel active work; connection failures clear live values; app connection and firmware status remain separate; dashboard controls stay read-only; owner approved software completion while deferring hardware review | This commit | None | None |
| [PHIL-011](prds/PRD-001/tasks/PHIL-011.md) | Human | Done | 38 mobile tests, mobile lint/typecheck, 35 protocol tests/typecheck, 20 simulator tests/typecheck, OpenAPI validation, Expo SDK 54 config introspection, and web export passed; human-approved 2026-07-06 with physical-iPhone checks deferred in `docs/side-notes.md` | Whole-degree bounded steppers keep edits as drafts until inline confirmation; polling pauses during mutations; only validated firmware acknowledgements update displayed targets/mode; firmware rejections remain visible and disconnects clear live state without false success; owner approved software completion while deferring physical-iPhone review | This commit | None | None |
| [PHIL-012](prds/PRD-001/tasks/PHIL-012.md) | Agent | Todo | Pending | Pending | Pending | None | None |
| [PHIL-013](prds/PRD-001/tasks/PHIL-013.md) | Human | Todo | Pending | Pending | Pending | None | None |
