# PRD-018 software verification

Date: 2026-07-30

Status: PASS for every configured software check and the pinned ESP-IDF 6.0.2
target build. Native-device visual/accessibility review and connected physical
acceptance were not performed.

## Verified behavior

- Firmware starts one volatile Steam heat-soak episode on Steam entry and uses
  a wrap-safe linear decay from the configured initial compensation to zero.
- The estimate affects Steam control, readiness, recovery, duty, demand, and
  timeout behavior without changing the calibrated sensor value.
- Raw and calibrated temperatures retain independent, inclusive `135°C` Steam
  caps; the transient estimate is excluded from both checks.
- Persisted settings use `12°C`, 12 minutes, and 5 minutes by default, with
  strict whole-unit ranges of `0–20°C`, `1–30` minutes, and `1–15` minutes.
- Active setting changes command the heater off before persistence and preserve
  the heat-soak and post-ready timeout origins.
- Simulator, mobile state, retained history, and CSV expose the estimate,
  applied compensation, elapsed episode time, and settings explicitly.

## Contract and TypeScript workspaces

From the repository root:

```text
bun run validate:openapi
bun run typecheck:protocol
bun run test:protocol
```

PASS — OpenAPI 3.1.1 valid; protocol typecheck; 165 tests / 363 expectations.

```text
bun run typecheck:simulator
bun run test:simulator
```

PASS — simulator typecheck; 95 tests / 776 expectations.

From `apps/mobile`:

```text
bun run typecheck
bun run test
bun run lint
```

PASS — typecheck; 253 tests / 2,460 expectations; Expo lint.

The mobile checks cover strict acknowledged settings reads/writes, debug-client
parity, Steam estimate and sensor presentation, retained history migration, and
CSV export. A native iOS/Android visual pass, maximum-text-size pass, and
assistive-technology pass remain unexecuted.

## Firmware host, sanitizer, and captures

Native and sanitizer builds used separate temporary build directories:

```text
cmake -S firmware/espresso-machine/host-tests -B <temporary-native>
cmake --build <temporary-native>
ctest --test-dir <temporary-native> --output-on-failure

cmake -S firmware/espresso-machine/host-tests -B <temporary-sanitizer> \
  -DPHILCOINO_ENABLE_SANITIZERS=ON
cmake --build <temporary-sanitizer>
ctest --test-dir <temporary-sanitizer> --output-on-failure
```

PASS — native 10/10; ASan/UBSan 10/10.

Strict firmware response capture validation:

```text
<temporary-native>/firmware_api_test <temporary-captures>
bun run firmware/espresso-machine/host-tests/validate_contract.ts \
  <temporary-captures>
```

PASS — 36 captures.

The suites cover decay endpoints and midpoint behavior, timer wraparound,
episode preservation and clearing, original-ready-timestamp timeout changes,
missing/corrupt/failed settings storage, rollback, fail-off output, strict
settings parsing, history serialization, and unchanged sensor and heater safety
paths.

## Resource evidence

Exact host layouts:

```text
HistorySample=48
HistoryBuffer=28872
HistoryPage=480
ControlSnapshot=160
BrewPiController=76
```

The history sample remains within its 48-byte ceiling, the ring remains below
40 KiB, and a copied page remains below 2 KiB. The serialized response remains
bounded by the existing 8 KiB limit.

## Pinned target build and size

The existing pinned environment was activated without installing or updating
anything:

```text
source /Users/vinicius/.espressif/tools/activate_idf_v6.0.2.sh
cd firmware/espresso-machine
idf.py --version
idf.py build
idf.py size
```

PASS — ESP-IDF v6.0.2, firmware `0.4.1`, target `esp32c3`.

```text
Application binary: 0x11df10 bytes
Smallest app partition: 0x180000 bytes
App partition free: 0x620f0 bytes (26%)
Flash code: 920082 bytes
Flash data: 153900 bytes
DRAM: 162796 / 321296 bytes (50.67%)
DRAM remaining: 158500 bytes
RTC SLOW: 60 / 8192 bytes (0.73%)
Total image size: 1170834 bytes
Bootloader: 0x5260 bytes, 0x2da0 bytes (36%) free
```

The initial sandboxed build was blocked because the component manager could not
perform its macOS process-list `sysctl`. The same pinned build passed with that
host permission. Nothing was installed and no device was flashed.

## Remaining evidence boundary

No connected runtime, low-voltage output observation, energized boiler test,
independent top-of-boiler reference trace, SSR-current observation, thermostat
interruption test, native mobile visual review, or physical steam run was
performed. These checks remain Human-owned and are not implied by the green
software matrix.
