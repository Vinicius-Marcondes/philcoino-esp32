# PRD-016 Tracker

PRD Status: Software Complete — Target/Physical A/B Pending
Current Task: None — Awaiting pinned target environment and explicit Human authorization

Implementation Boundary: Replace the Brew nonlinear curve with a
compile-time-selected shadow/active PI policy, remove predictive runtime and
public/mobile surfaces, preserve research assets, and keep every existing
firmware safety and Steam boundary authoritative.

## Summary

Implement bounded Brew-only PI diagnostics and control ownership at the fixed
500 ms schedule through the existing ten-second SSR window. Remove passive
prediction from current firmware, protocol, simulator, mobile history, and new
CSV exports as an intentional matched firmware/mobile API v2 break. Preserve
desktop thermal modeling, raw captures, historical specifications, and PRD-012.

PRD: `docs/prds/PRD-016/PRD-016.md`

## Compatibility and Safety Boundary

- API v1 and queryless API v2 ordinary behavior remain unchanged; prediction
  query/payload compatibility is intentionally removed.
- `CONFIG_PHILCOINO_BREW_PI_CONTROL` is build-time only: disabled keeps legacy
  Brew authority with shadow PI; enabled gives PI Brew requested-duty authority.
- Steam behavior, the fixed Brew Manual/main `+2°C` private target bias, the
  ten-second SSR window, faults, timeouts, cooldown, permission, safety lease,
  persistence, and fail-off ownership remain unchanged.
- Diagnostics are firmware command/request observations, not measured SSR
  current, heater power, pump flow, physical temperature safety, or proof of
  de-energization.
- No physical or energized A/B work is authorized by software implementation.

## Git

- Planned branch: `feature/PRD-016-brew-pi-control`
- Base: `main`
- Merge target: `main`

## Execution State

| Task | Review | Status | Evidence | Decision Log | Commit | Blocked Reason | Requested Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [BPI-001](prds/PRD-016/tasks/BPI-001.md) | Agent | Done | OpenAPI valid; protocol 138 tests/280 expectations; typecheck | Removed prediction opt-in/types and legacy 60-sample compatibility; strict controller config/diagnostics with eight-sample pages | Pending | None | None |
| [BPI-002](prds/PRD-016/tasks/BPI-002.md) | Agent | Done | Native/sanitizer 10/10; 32 captures; HistorySample 40 B, ring 24,072 B, page 416 B | Removed all active prediction runtime/codec/history ownership; strict controller diagnostics | Pending | None | None |
| [BPI-003](prds/PRD-016/tasks/BPI-003.md) | Agent | Done | Pure PI plus transition coverage in native/sanitizer 10/10 | Fixed 500 ms PI; EMA alpha 0.25; Kp 0.08/Ki 0.01 shadow candidates; bounded conditional anti-windup | Pending | None | None |
| [BPI-004](prds/PRD-016/tasks/BPI-004.md) | Agent | Done | Separate legacy/active authority tests; native/sanitizer 10/10; 32 captures | Default-off legacy authority; active flag changes Brew only; Steam/window/fail-off retained | Pending | None | None |
| [BPI-005](prds/PRD-016/tasks/BPI-005.md) | Agent | Done | Simulator 77 tests/556 expectations; typecheck | Removed state prediction opt-in; bounded deterministic legacy-controller history diagnostics | Pending | None | None |
| [BPI-006](prds/PRD-016/tasks/BPI-006.md) | Agent | Done | Mobile 180 tests/1,188 expectations; typecheck; Expo lint; in-memory v4 migration | Queryless state polling; transactional v5 ordinary-row preservation; controller-only CSV | Pending | None | None |
| [BPI-007](prds/PRD-016/tasks/BPI-007.md) | Agent | Done | Desktop 32 tests; preservation/current-claim searches | Legacy prediction CSV accepted but ignored by default; research preserved; current docs aligned to PI and pending physical gate | Pending | None | None |
| [BPI-008](prds/PRD-016/tasks/BPI-008.md) | Agent | Software Complete — Target Pending | Protocol 138; simulator 77; mobile 180; desktop 32; native/sanitizer 10/10; 32 captures; exact resource report | All configured software passes; `idf.py` unavailable, so target stack/heap/flash/map/timing remain unmeasured | Pending | ESP-IDF 6.0.2 environment unavailable in configured shell | Run pinned legacy/PI target builds and map/size checks |
| [BPI-009](prds/PRD-016/tasks/BPI-009.md) | Human | Software Complete — Target/Human Pending | Bounded preconditions, stop conditions, run record, metrics, thresholds, and decision template | No connected/energized work inferred from software; active PI remains unaccepted | Pending | Target builds, connected setup, independent instruments/cutoff, authorization, and Human reviewer unavailable | Explicitly authorize and supervise only after every precondition passes |

---

# PRD-015 Tracker

PRD Status: Active — Approved 2026-07-28
Current Task: Mobile software complete — native visual and target review pending

Implementation Boundary: Reduce the Dashboard graph to boiler temperature and
target, and move extraction controls and the complete weighted telemetry plot to a
new full-screen console, without changing firmware, protocol, persistence, or who
owns control.

PRD: `docs/prds/PRD-015/PRD-015.md`

## Compatibility and Safety Boundary

- Mobile presentation only. No firmware, protocol, simulator, or stored-data change.
- Firmware remains authoritative for temperature, scale validity, extraction,
  heater/pump commands, faults, timeouts, and persisted targets.
- Extraction mutations keep acknowledged-only feedback, profile-synchronization
  guards, and idempotency; the console never displays a requested value as live
  state.
- Weight and flow remain observation-only derived data and stay labelled
  unavailable rather than synthesized.
- Software evidence does not prove scale accuracy, water flow, pump operation,
  de-energization, or energized mains safety.

## Execution State

| Area | Status | Evidence | Blocked Reason |
| --- | --- | --- | --- |
| Contract and simulator | Not applicable | No wire or simulator change in scope; protocol 138 tests and simulator 77 tests unchanged and passing | None |
| Firmware | Not applicable | No firmware change in scope | None |
| Mobile | Software complete | 235 tests; typecheck; lint; behavioral tests for plot geometry, readouts and console model | Native device visual review pending; web bundling unavailable because `expo-sqlite` cannot resolve its wasm worker asset |
| Physical validation | Pending Human | Procedures remain bounded by safety docs | Connected low-voltage target and Human reviewer unavailable |

---

# PRD-014 Tracker

PRD Status: Active — Approved 2026-07-26
Current Task: Software implementation complete — Figma/Target/Human pending

Superseded: the Dashboard-graph requirement (PRD-014 line 61) and the
"Visually copying Gaggiuino" non-goal (line 29) are replaced by
`docs/prds/PRD-015/PRD-015.md`. All other PRD-014 requirements remain in force.

Implementation Boundary: Add observation-only weighted extraction telemetry,
derived beverage mass flow, durable trace history, and responsive graph-first
UI without allowing telemetry or the phone to influence firmware control.

PRD: `docs/prds/PRD-014/PRD-014.md`

## Compatibility and Safety Boundary

- Existing strict API responses are unchanged; `/api/v2/scale/trace` is
  additive, authenticated, and optional for older firmware.
- Firmware remains authoritative for temperature, scale validity, extraction,
  heater/pump commands, faults, timeouts, and persisted targets.
- Missing and skipped samples remain explicit gaps. Mobile flow is derived
  diagnostic data, not a physical flow sensor.
- Software evidence does not prove scale accuracy, water flow, pump operation,
  de-energization, or energized mains safety.

## Execution State

| Area | Status | Evidence | Blocked Reason |
| --- | --- | --- | --- |
| Contract and simulator | Software complete | Protocol validation and 138 tests; simulator 77 tests/typecheck | None |
| Firmware | Host complete | Native host 7/7; strict trace route and bounded ring | ESP-IDF target/map evidence unavailable |
| Mobile | Software complete | 180 tests; typecheck; lint; unified default telemetry surface | Native device visual review pending |
| Figma | Blocked after file creation | Named file created; all follow-up connector calls return `INVALID_ARGUMENT` | Figma connector/account access |
| Physical validation | Pending Human | Procedures remain bounded by safety docs | Connected low-voltage target and Human reviewer unavailable |

---

# PRD-013 Tracker

PRD Status: Active — Approved 2026-07-26
Current Task: None — Awaiting explicit task selection

Implementation Boundary: Reduce avoidable ESP32-C3 runtime work and mobile
scale polling without changing public wire schemas, firmware control authority,
profiles, ten-minute history, passive prediction, heater/pump policy, timeouts,
faults, or fail-off behavior.

## Summary

Capture an unchanged-code performance baseline, bound mobile scale polling, then
incrementally reduce firmware workflow-mutex exposure, scale wakeups and
processing, API allocation pressure, scheduling jitter, and abandoned OLED/code
surface under separate supervised task approvals.

PRD: `docs/prds/PRD-013/PRD-013.md`

## Compatibility and Safety Boundary

- No OpenAPI or public wire-schema changes are planned.
- Firmware remains authoritative for all sensor, target, persistence, heater,
  pump, workflow, timeout, fault, and fail-off decisions.
- Every NVS/flash operation remains outside the workflow mutex.
- Application ISRs remain minimal, allocation-free, logging-free, and
  cache-safe; the heater safety lease remains 1,500 ms.
- Host, target-build, connected-target, logic-analyzer, and Human evidence are
  tracked separately. No software result proves physical de-energization or
  energized mains safety.

## Git

- Planned branch: `feature/esp32c3-firmware-performance`
- Base: `main`
- Merge target: `main`

## Execution State

| Task | Review | Status | Evidence | Decision Log | Commit | Blocked Reason | Requested Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [PERF-001](prds/PRD-013/tasks/PERF-001.md) | Human | Software Complete — Target/Human Pending | Unchanged-code host/mobile baseline; native/sanitizer 7/7; 32 captures; target procedure | Default-off fixed diagnostics; target evidence not inferred | `8fee5ab` | ESP-IDF toolchain and connected target unavailable | Run pinned target build and supervised low-voltage scenarios |
| [PERF-002](prds/PRD-013/tasks/PERF-002.md) | Agent | Done | Focused 6 tests; mobile 173 tests; typecheck; lint; request-rate bounds | Fresh acknowledged scale state owns cadence; Manual/timed remain idle cadence | `8fee5ab` | None | None |
| [PERF-003](prds/PRD-013/tasks/PERF-003.md) | Agent | Done | Native/sanitizer 7/7; 32 contract captures; repeated-read and cooldown-handoff regression | State GET copies only; workflow task unconditionally owns phase publication | `8fee5ab` | None | None |
| [PERF-004](prds/PRD-013/tasks/PERF-004.md) | Agent | Done | Native/sanitizer 7/7; 32 captures; lock-depth fake; bounded allocation audit | Coherent copies under lock; all response construction after unlock; one authorized route resolution | `8fee5ab` | ESP-IDF target resource delta unavailable | None |
| [PERF-005](prds/PRD-013/tasks/PERF-005.md) | Agent | Software Complete — Target Pending | Native/sanitizer 7/7; event policy regression; 32 captures; target procedure | Falling-edge notify plus 750 ms timeout; task retains all sampling/publication; PERF-006 untouched | `8fee5ab` | ESP-IDF target build/map and connected low-voltage target unavailable | Run pinned target build/map and cache-suspension/low-voltage checks |
| [PERF-006](prds/PRD-013/tasks/PERF-006.md) | Agent | Done | Native/sanitizer 7/7; cached filter, NotReady, age/wrap, saturation and recovery regression | `NotReady` bypasses mutex/publication; accepted samples refresh cached O(1) snapshots | `726d5c4` | Target diagnostics unavailable | None |
| [PERF-007](prds/PRD-013/tasks/PERF-007.md) | Agent | Done | Native/sanitizer 7/7; 32 captures; unlocked-save assertion; failure/reacquire/adopt/retry regressions | Tokenized prepare/save/adopt; old calibration retained; unresolved adoption blocks weighted Start | `2a5c09e` | Target NVS/runtime evidence unavailable | None |
| [PERF-008](prds/PRD-013/tasks/PERF-008.md) | Agent | Done | Native/sanitizer 7/7; 32 captures; on-time/late/multi-period/wrap arithmetic | ESP-IDF 6 `xTaskDelayUntil`; retained 500 ms deadline; missed slots skipped without rapid sensor reads | `ca88239` | Target lateness diagnostics unavailable | None |
| [PERF-009](prds/PRD-013/tasks/PERF-009.md) | Human | Software Complete — Target/Human Pending | Source/config call-graph audit; native/sanitizer 7/7; 32 captures; target/Human procedure | Explicit IRAM callbacks; no ISR logging/allocation/controller work; Human timing not inferred | `c7f5791` | ESP-IDF build/map, connected low-voltage target, logic analyzer, and Human reviewer unavailable | Run pinned build/map, cache-suspension stress, and GPIO0/GPIO1/GPIO20 captures |
| [PERF-010](prds/PRD-013/tasks/PERF-010.md) | Agent | Done | Native/sanitizer 7/7; 32 captures; active-source/dependency audit | Removed disabled OLED/I2C surface; GPIO8/GPIO9 unassigned; API and fail-off startup preserved | `34dafe0` | ESP-IDF target toolchain unavailable, so image delta unavailable | Run pinned target build/size when toolchain is available |
| [PERF-011](prds/PRD-013/tasks/PERF-011.md) | Agent | Done | Production call graph; native/sanitizer 7/7; 32 captures | Removed five test-only storage-owning helpers; retained transactional API paths and active features | `8f42f83` | None | None |
| [PERF-012](prds/PRD-013/tasks/PERF-012.md) | Human | Software Complete — Target/Human Pending | Protocol 135; simulator 72; mobile 173 + typecheck/lint; firmware native/sanitizer 7/7; 32 captures | All available software passes; target comparisons remain unmeasured | `6843013` | ESP-IDF 6.0.2, connected target, logic analyzer, and Human reviewer unavailable | Repeat PERF-001 scenarios and PERF-009 captures on exact target build |

---

## Prior PRD-007 Tracker

PRD Status: Complete — Software Delivery Closed
Current Task: None — Deferred validation remains documented

Implementation Boundary: Add bounded observational device history, strict
history retrieval, mobile backfill, and thirty-second graph paging without
changing firmware control authority or existing API v1/v2 wire shapes.

## Summary

Capture ten minutes of one-Hertz ESP32 RAM history, synchronize it into the
phone's current-day SQLite history after reconnection, preserve real gaps, and
keep the Dashboard live while backfill runs.

PRD: `docs/prds/PRD-007/PRD-007.md`

## Compatibility and Safety Boundary

- History is observational RAM-only state and never participates in heater,
  pump, fault, timeout, readiness, target, or mutation decisions.
- Existing API v1 and queryless API v2 state/mutation payloads remain unchanged;
  PRD-012 adds an opt-in prediction state variant while history uses the current
  protected-route authentication policy.
- Firmware history work must be bounded and must not make the control loop wait.
- Software and target-build evidence do not prove physical operation,
  de-energization, flow, cooling, wiring, or mains safety.

## Git

- Planned branch: `feature/PRD-007-device-history`
- Base: `main`
- Merge target: `main`

## Execution State

| Task | Review | Status | Evidence | Decision Log | Commit | Blocked Reason | Requested Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [HIST-001](prds/PRD-007/tasks/HIST-001.md) | Agent | Done | Protocol validation; 123 tests; typecheck | Approved PRD decisions | Pending | None | None |
| [HIST-002](prds/PRD-007/tasks/HIST-002.md) | Agent | Done | 65 simulator tests; typecheck | Deterministic boot IDs; fixed paging | Pending | None | None |
| [HIST-003](prds/PRD-007/tasks/HIST-003.md) | Agent | Done | Native/sanitizer 6/6; 30 captures | Zero-wait atomic history lock | Pending | Target environment unavailable | Provide target evidence in HIST-006/007 |
| [HIST-004](prds/PRD-007/tasks/HIST-004.md) | Agent | Done | Mobile 133 tests; typecheck; lint | Native-safe cancellation; exclusive idempotent page/cursor commit | Pending | None | None |
| [HIST-005](prds/PRD-007/tasks/HIST-005.md) | Agent | Done | 30 s window/gap/follow tests; localization | Rolling newest window; user-driven follow state | Pending | None | None |
| [HIST-006](prds/PRD-007/tasks/HIST-006.md) | Agent | Done | All configured host/workspace checks pass | Host evidence is not target evidence | Pending | Target toolchain unavailable | Complete target evidence in HIST-007 |
| [HIST-007](prds/PRD-007/tasks/HIST-007.md) | Human | Deferred | Partial owner evidence: complete bounded pages, stable boot ID under repeated stress, and gap-free one-minute reopen; 0.3.3 retest pending | Gap-only recovery and stable timestamp page identity | Pending | Connected-target resource evidence unavailable | Flash/test 0.3.3 and complete target timing/resource checks |

## PRD-011 Brew by weight

PRD: `docs/prds/PRD-011/PRD-011.md`

Software status: Implemented on 2026-07-23. Protocol, deterministic simulator,
firmware host policy/adapters, mobile Scale page, local defaults, 90-day
history, and CSV export are present. This does not advance or replace the
pending PRD-007 Human task above.

Human status: Disconnected low-voltage HX711/load-cell wiring, GPIO0/GPIO1 boot
behavior, sample cadence, 0/35/100 g repeatability, automatic tare, and injected
disconnect validation remain Todo. Energized compensation tuning requires
separate authorization.

## PRD-012 Passive predictive boiler-temperature diagnostics

PRD: `docs/prds/PRD-012/PRD-012.md`

Software status: Passive prediction diagnostics are implemented without
connecting prediction output to the authoritative heater command path.

Human status: Connected-target resource/timing checks and passive physical
validation remain pending.
