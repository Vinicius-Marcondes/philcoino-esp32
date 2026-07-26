# PERF-001 unchanged-code baseline and target procedure

Date: 2026-07-26

Baseline production source: commit
`39f5ab3786538d031a8c7783846e10c2c939568b` on
`feature/esp32c3-firmware-performance`, before PERF-001 firmware or PERF-002
mobile production-code changes. The only pre-existing working-tree addition was
the owner-supplied untracked `docs/prds/PRD-013/` PRD.

## Evidence boundary

This record separates:

- **Host:** native C++ behavior, sanitizer-configured tests, contract captures,
  mobile tests, and source/configuration characterization.
- **Target build:** current ESP32-C3 image, sections, map placement, and
  effective configuration.
- **Connected target:** task timing/load, mutex exposure, heap, stack, request
  latency, resets, and lease observations.
- **Logic analyzer / Human:** HX711 GPIO timing and the GPIO20 lease cutoff on
  an approved disconnected low-voltage setup.

Host results do not establish FreeRTOS scheduling, ESP-IDF allocation, GPIO
timing, physical output state, thermal response, or mains safety.

## Locally available unchanged-code baseline

Environment:

- CMake 4.3.4
- Apple clang 21.0.0
- Bun 1.3.14
- ESP-IDF `idf.py`: unavailable in `PATH`
- `IDF_PATH`: unset
- Connected ESP32-C3 / logic analyzer: unavailable

Strict firmware host baseline:

- PASS — native CMake build with configured `-Wall -Wextra -Werror`.
- PASS — native CTest 7/7 in 1.93 seconds.
- PASS — sanitizer-configured CTest 7/7 in 1.32 seconds. As configured by the
  repository, ASan/UBSan instrumentation applies to the two API codec targets;
  the complete suite still runs in that build.
- PASS — 32 generated firmware response captures validated against the strict
  shared protocol schemas.

Native executable file sizes are host-only comparison aids, not ESP32 image
measurements:

| Executable | Bytes |
| --- | ---: |
| `firmware_config_test` | 37,192 |
| `peripherals_test` | 249,248 |
| `control_test` | 295,280 |
| `prediction_test` | 57,008 |
| `firmware_api_test` | 428,592 |
| `api_codec_test` | 280,464 |
| `api_codec_mutation_test` | 293,560 |

Unchanged mobile baseline:

- PASS — TypeScript typecheck.
- PASS — 167 Bun tests with 1,115 expectations.
- PASS — Expo lint.
- Source characterization — the existing scale loop schedules after completion,
  so a slow request cannot create a timer-driven overlap.
- Source characterization — `useScale` reads the render-closure `scale` value
  when selecting its next delay. After a weighted run ends, the effect can be
  recreated with the last active scale response and retain a 250 ms idle delay:
  up to four steady-state requests per second instead of one.
- Source characterization — generic pending/running extraction state also
  selects 250 ms, so Manual and timed extraction incorrectly receive the
  weighted/Scale-page cadence.

The historical ESP-IDF figures in PRD-005 are not reused as this baseline. They
belong to an older refactor/commit and explicitly lack connected request-heap
and HTTP-stack evidence.

## Unchanged runtime configuration

- Single ESP32-C3 CPU.
- Main/temperature task stack: 4,096 bytes.
- Workflow task: 4,096-byte stack, priority `configMAX_PRIORITIES - 2`, fixed
  10 ms wake period.
- Scale task: 3,072-byte stack, priority `configMAX_PRIORITIES - 3`, fixed 10 ms
  wake period; current code reads and enters workflow synchronization even for
  `NotReady`.
- Network bootstrap task: 6,144-byte stack, priority 5.
- HTTP server task stack: 6,144 bytes.
- Workflow mutex acquisition timeout: 50 ms.
- Temperature loop: relative 500 ms delay before PERF-008.
- Heater safety lease: 1,500 ms with cache-safe GPTimer/GPIO configuration
  defaults; this value is not changed by PRD-013.

## Default-off bounded instrumentation

PERF-001 adds `CONFIG_PHILCOINO_PERFORMANCE_DIAGNOSTICS`, default `n`.
When enabled for supervised target measurement it:

- stores fixed-size atomic counters, maximums, and eight-bucket histograms;
- records workflow/scale/temperature period deviation and work duration;
- records workflow-mutex wait/hold, acquisitions, timeouts, and deadline misses;
- records accepted/NotReady scale samples;
- records per-request latency, internal-heap decrease, request count, and HTTP
  stack high-water;
- samples free/minimum/largest internal heap and
  temperature/workflow/scale/HTTP/reporter stack high-water on the cold
  reporting path;
- records reset reason at boot and observes a heater-lease trip from task
  context;
- reports at most once per minute from a dedicated low-priority 3,072-byte
  reporter task, adds no public API, performs no persistence, and does not
  modify either ISR.

The fixed diagnostic owner is limited by a 512-byte compile-time assertion.
Hot-path recording is allocation-free and logging-free. Normal builds compile
with the feature disabled.

## Repeatable target scenario matrix

Use the same ESP-IDF 6.0.2 version, commit/configuration, target, power source,
network, run duration, request script, measurement points, and diagnostic flag
for the PERF-001 baseline and PERF-012 comparison. Never include Wi-Fi
credentials or bearer tokens in evidence.

| Scenario | Required observations |
| --- | --- |
| Boot/reset and idle scale ready | Reset cause, watchdog count, loop timing, mutex wait/hold/acquisitions, heap/largest block, all task stacks, API latency, lease trips |
| Scale `NotReady` then disconnected timeout/recovery | Scale wake/read/NotReady counts, mutex acquisitions/timeouts, workflow/temperature timing, GPIO0 ready behavior |
| Heating idle | Temperature/workflow timing, heater lease renewal/trips, heap/stack, reset/watchdog state |
| Timed extraction | Workflow timing, pump/heater command-state regressions, API state/scale latency |
| Weighted extraction and automatic tare | HX711 notification/sample path, ready window, cutoff/fallback/settling, GPIO0/GPIO1 timing |
| Calibration NVS commit | Mutex wait/hold, temperature/workflow timing, heap, lease behavior; verify NVS remains outside the mutex |
| API state/scale load | Per-route latency, request heap decrease, HTTP stack, mutex wait/hold |
| Maximum history-page load | Response latency, heap/largest block, HTTP stack, live-loop timing |
| Cooldown | Workflow/temperature timing and unchanged pump/heater ordering/timeouts |
| Wi-Fi reconnect | Loop timing, heap/stack, resets/watchdogs, API recovery |
| mDNS degradation/recovery | Loop timing, heap/stack, API-by-address availability |
| Controlled lease expiry, loads disconnected | GPIO20 low at or before 1,500 ms, task-side trip observation, no re-enable |

## Pending evidence

Target-build evidence is unavailable because the pinned ESP-IDF toolchain is
not present. Current image/partition size, `.text`, `.rodata`, `.data`, `.bss`,
map/IRAM placement, and effective target configuration remain pending.

Connected-target CPU/load, loop distributions, mutex distributions, heap,
largest block, task/HTTP stack, per-route latency, reset/watchdog observations,
and lease-trip evidence remain pending because no target is connected.

Logic-analyzer checks for HX711 ready/clock timing and GPIO20 lease cutoff remain
Human-gated. They authorize no energized mains testing and cannot prove SSR,
pump, wiring, current, thermal, or physical de-energization behavior.
