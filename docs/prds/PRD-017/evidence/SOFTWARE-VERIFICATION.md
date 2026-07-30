# PRD-017 software verification

Date: 2026-07-30

Status: PASS for every configured software check and the pinned ESP-IDF 6.0.2
target build; physical calibration and protection checks not performed.

## Implemented boundary through TCAL-008

- One signed calibration offset is persisted by firmware and applied exactly
  once to Brew and Steam temperatures.
- A missing calibration record means `0°C`; an unreadable or corrupt record
  prevents ordinary startup and keeps the heater off.
- Calibration controls an uncorrected raw target from `90–120°C`, starts at
  `100°C`, changes by whole degrees, uses advisory-only stability, and never
  commands the pump or detects steam.
- Effective and raw Steam readings are independently permitted through
  `135°C` and fault strictly above it.
- The strict Steam target range is `110–135°C`, inclusive. Offset-adjusted
  reachability still rejects targets whose implied raw value exceeds `135°C`.
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

## Completion audit corrections

A requirement-by-requirement audit after the initial green matrix found and
fixed four consistency gaps:

- the mounted calibration modal now clears local Save-review and deferred-close
  state whenever hidden, requiring fresh confirmation after reopening;
- the mobile debug client now cancels active calibration before target, mode,
  or heater-permission mutations and rejects later offset-unreachable targets;
- unsafe-target wire copy now says the requested target would **exceed** the raw
  ceiling, because exact equality is permitted by TCAL-008.
- the Machine page now places the heater-permission switch before the control
  cards and gives its landscape controls the full viewport width; Mode and
  Targets share a wrapping row while Calibration occupies the next row instead
  of overflowing horizontally.

The dedicated native iOS/Android, maximum-text-size, and assistive-technology
checklist remains unexecuted. The owner approved the revised responsive UI, but
that approval is not represented as platform-specific accessibility evidence.

## Contract and TypeScript workspaces

From the repository root:

```text
bun run validate:openapi
bun run typecheck:protocol
bun run test:protocol
```

PASS — OpenAPI 3.1.1 valid; protocol typecheck; 157 tests / 337 expectations.

```text
bun run typecheck:simulator
bun run test:simulator
```

PASS — simulator typecheck; 92 tests / 741 expectations.

From `apps/mobile`:

```text
bun run test
bun run typecheck
bun run lint
```

PASS — 252 tests / 2,438 expectations; typecheck; Expo lint. This includes the
approved responsive calibration modal in portrait and both landscape
directions, acknowledged session behavior, lifecycle cancellation, manual
steam-wand guidance, whole-degree adjustment, offset formatting, and clearing
local Save-confirmation state whenever the modal closes. It also covers the
heater-first Machine layout and the full-width wrapping landscape control
cards. Debug mode now also cancels calibration on conflicting dashboard
mutations and rejects later offset-unreachable targets with the same
acknowledged semantics as firmware.

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
unreachable targets; exact-cap and above-cap raw/effective behavior; and fail-off
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

## Pinned target build and size evidence

The owner provided the existing activation script:

```text
source /Users/vinicius/.espressif/tools/activate_idf_v6.0.2.sh
cd firmware/espresso-machine
idf.py --version
idf.py build
idf.py size
```

PASS — `ESP-IDF v6.0.2`, firmware `0.4.1`, target `esp32c3`.

```text
Application binary: 0x11c730 bytes
Smallest app partition: 0x180000 bytes
App partition free: 0x638d0 bytes (26%)
Flash code: 915092 bytes
Flash data: 152788 bytes
DRAM: 157924 / 321296 bytes (49.15%)
DRAM remaining: 163372 bytes
RTC SLOW: 60 / 8192 bytes (0.73%)
Total image size: 1164716 bytes
Bootloader: 0x5260 bytes, 0x2da0 bytes (36%) free
```

The first sandboxed build attempt was blocked because the ESP-IDF component
manager could not call the macOS process-list `sysctl`. Re-running the same
build with the required host permission succeeded; no package, CLI, SDK, or
dependency was installed.

Runtime heap behavior, real task high-water marks, NVS partition headroom,
HTTP stack use, mutex latency, control-loop deadline jitter, watchdog behavior,
real safety-lease timing, and physical GPIO/SSR behavior remain unmeasured.
Source stack allocations, a successful target link, and host object sizes do
not substitute for connected runtime evidence.

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
- TCAL-008 keeps the `135°C` software cap inclusive and faults strictly above
  it. TCAL-009 requires separate explicit authorization and supervision for
  physical acceptance.
