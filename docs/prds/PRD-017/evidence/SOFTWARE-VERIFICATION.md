# PRD-017 software verification

Date: 2026-07-30

Status: PASS for every configured software check; ESP-IDF target evidence
unavailable; physical calibration and protection checks not performed.

## Implemented boundary through TCAL-007

- One signed calibration offset is persisted by firmware and applied exactly
  once to Brew and Steam temperatures.
- A missing calibration record means `0°C`; an unreadable or corrupt record
  prevents ordinary startup and keeps the heater off.
- Calibration controls an uncorrected raw target from `90–120°C`, starts at
  `100°C`, changes by whole degrees, uses advisory-only stability, and never
  commands the pump or detects steam.
- Effective and raw Steam readings independently fault at `135°C`.
- The current strict Steam target range remains `110–120°C`. Making `135°C` an
  inclusive target is intentionally deferred to TCAL-008 because its raw and
  effective trip boundaries must first move above the target.
- Connected, energized, thermostat, SSR-current, and boiling-point acceptance
  remain Human-owned under TCAL-009.

## Documentation audit

Current architecture, development, safety, tuning, protocol, public README,
firmware, simulator, and mobile documentation describes a global offset with:

```text
temperatureOffsetC = 100 - observedRawBoilingTemperatureC
effectiveTemperatureC = rawTemperatureC + temperatureOffsetC
```

Current-runtime searches found no remaining claim that Steam alone receives a
fixed `+5°C` correction or that `130°C` is the active Steam over-temperature
boundary. Remaining `+5°C` and `130°C` references are explicitly historical:
PRD-003 and its accepted tasks, PRD-016 historical evidence, the historical
firmware-foundation table, positive-offset formatting tests, and PRD-017 text
that identifies the behavior being superseded.

PRD-003 remains unchanged as an acceptance record but is marked historical and
superseded by PRD-017 for current temperature semantics.

## Contract and TypeScript workspaces

From the repository root:

```text
bun run validate:openapi
bun run typecheck:protocol
bun run test:protocol
```

PASS — OpenAPI 3.1.1 valid; protocol typecheck; 157 tests / 336 expectations.

```text
bun run typecheck:simulator
bun run test:simulator
```

PASS — simulator typecheck; 92 tests / 731 expectations.

From `apps/mobile`:

```text
bun run test
bun run typecheck
bun run lint
```

PASS — 250 tests / 2,424 expectations; typecheck; Expo lint. This includes the
approved responsive calibration modal in portrait and both landscape
directions, acknowledged session behavior, lifecycle cancellation, manual
steam-wand guidance, whole-degree adjustment, and offset formatting.

## Firmware native, sanitizer, and captures

Native build:

```text
cmake -S firmware/espresso-machine/host-tests -B <temporary-native>
cmake --build <temporary-native>
ctest --test-dir <temporary-native> --output-on-failure
<temporary-native>/resource_budget_test
<temporary-native>/firmware_api_test <temporary-captures>
bun run firmware/espresso-machine/host-tests/validate_contract.ts \
  <temporary-captures>
```

PASS — native 10/10; 35 strict response captures.

Sanitizer build:

```text
cmake -S firmware/espresso-machine/host-tests -B <temporary-sanitizer> \
  -DPHILCOINO_ENABLE_SANITIZERS=ON
cmake --build <temporary-sanitizer>
ctest --test-dir <temporary-sanitizer> --output-on-failure
```

PASS — sanitizer 10/10 under the configured ASan/UBSan targets.

The suites cover `108°C → −8°C`, `95°C → +5°C`, and `100°C → 0°C`;
apply-once Brew/Steam behavior; missing, corrupt, failed, and restored
persistence; recalibration and cancellation; session conflicts and expiry;
unreachable targets; independent raw/effective `135°C` faults; and fail-off
sensor, permission, lease, output, timeout, and fault-dismissal paths.

## Available resource and timing evidence

Exact host layouts:

```text
HistorySample=40
HistoryBuffer=24072
HistoryPage=416
ControlSnapshot=128
BrewPiController=76
```

The configured host ceilings remain 48 bytes per history sample, 40 KiB for
the ring, and 2 KiB for a copied page. The serialized history response remains
bounded to 8 KiB.

The temperature-calibration NVS value is a versioned three-`int32_t` blob
(magic, version, signed offset) committed through the existing NVS adapter.
Save uses prepare/persist/adopt semantics, and a persistence failure rolls back
to the prior in-memory offset.

API workflow domains continue to share one bounded FreeRTOS mutex. Lock
acquisition times out after 50 ms and issues emergency pump/heater-off commands
on failure. Calibration NVS writes and HTTP transmission remain outside the
lock.

The controller interval remains exactly 500 ms and the heater safety lease
remains 1,500 ms. Native tests exercise schedule, lease renewal/trip, storage,
calibration conflicts, and fail-off behavior, but do not measure target
scheduling latency.

No host ceiling or configured check regressed after adding calibration.

## Unavailable target evidence

`idf.py --version` returned `command not found` in the configured shell. No
package, CLI, SDK, or dependency was installed. Consequently the pinned
ESP-IDF 6.0.2 target commands were not run:

```text
cd firmware/espresso-machine
idf.py set-target esp32c3
idf.py build
```

Flash/map size, target RAM and heap deltas, real task high-water marks, NVS
partition headroom, HTTP stack use, mutex latency, control-loop deadline
jitter, watchdog behavior, and real safety-lease timing remain unmeasured.
Source stack allocations and host object sizes are not substituted for this
target evidence.

## Compatibility and safety result

- API v2 calibration routes are additive. Existing v1 shapes and ordinary v2
  machine-state shapes remain compatible; temperature meaning changes
  deliberately from the historical Steam-only correction to one global
  effective value.
- Firmware remains the authority for persisted targets, calibration, sensor
  validity, readiness, conflicts, timeouts, heater permission, lease, faults,
  and fail-off output commands.
- Simulator and mobile evidence validates contract behavior and presentation,
  not heater safety.
- No connected, low-voltage, energized, boiling, thermostat-interruption,
  wiring, SSR-current, heater-power, or physical steam test was performed.
- TCAL-008 requires a Human decision on replacement raw/effective fault
  thresholds above an inclusive `135°C` target. TCAL-009 requires separate
  explicit authorization and supervision for physical acceptance.
