# Development

This guide covers local development and verification for the TypeScript workspaces and the independent ESP-IDF firmware project.

## Prerequisites

### TypeScript and mobile

- Bun, using the repository's committed lockfile.
- Node.js 20.19 or newer for Expo SDK 54.
- Xcode/iOS Simulator for local iOS builds, or Android Studio/SDK for local Android builds.
- A physical development build for native mDNS and realistic local-network permission testing.

Install declared workspace dependencies from the root:

```bash
bun install
```

Do not add or install a new dependency without approval and a documented reason.

### Firmware

- CMake and a C++17 compiler for host tests.
- ESP-IDF 6.0.2 for the ESP32-C3 target build.
- The managed `espressif/mdns` 1.11.3 component resolved by the firmware project.

Firmware is not a Bun workspace. Do not inspect or commit generated `build`, `managed_components`, `sdkconfig`, or toolchain caches.

## Continuous integration

GitHub Actions runs `.github/workflows/ci.yml` for every pull request targeting
`main`, every push to `main`, and manual dispatches. All three stable jobs run
for every workflow invocation. The ESP-IDF job performs its target build when
firmware, protocol, or its CI workflow changes; unrelated changes keep the
required check present and report the target build as not applicable. Manual
dispatches always run the target build, and an unavailable comparison revision
falls back to the safe full build. The workflow uses read-only repository
contents permission and cancels superseded runs for the same pull request or
branch.

The three stable status checks are:

- `TypeScript workspaces`: Node.js 20.19.0, repository-pinned Bun 1.3.14,
  `bun ci`, OpenAPI validation, protocol and simulator typechecks/tests, and
  mobile typecheck/tests/lint;
- `Firmware host`: sanitizer-enabled C++17 host build, all CTest targets, and
  independent validation of generated firmware contract captures;
- `Firmware ESP-IDF`: conditional compile/link of the complete ESP32-C3 project
  with ESP-IDF 6.0.2 for firmware-, protocol-, or CI-relevant changes, with a
  successful not-applicable result for unrelated changes.

The active `main` ruleset requires all three checks and requires the pull
request branch to be up to date before merging. Dependency installation is
lockfile-frozen: `bun ci` fails instead of changing `bun.lock` when manifests
and the committed lockfile disagree.

CI does not deploy, flash, sign, publish, upload firmware artifacts, access
secrets, or interact with hardware. Host tests and simulator checks are software
evidence; the ESP-IDF job is target compilation evidence only. None of these
checks demonstrate physical heater/pump behavior, de-energization, wiring, or
mains safety.

## Mobile workflows

Start Expo from the repository root:

```bash
bun run start
```

Platform shortcuts:

```bash
bun run ios
bun run android
bun run web
```

The app uses Expo Router's `apps/mobile/app` directory. Native discovery also depends on `react-native-zeroconf` and generated native configuration, so Expo Go/web cannot exercise the complete pairing path. Use manual address entry on unsupported platforms.

### Debug-device mode

For dashboard/UI work without a network device:

```bash
EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run start
```

This mode bypasses discovery, SecureStore, bearer authentication, and HTTP. It
acknowledges in-memory target/mode/heater changes, but temperatures and uptime
stay at zero. It also exposes the PRD-002 extraction design preview with local
profiles and deterministic mock actions. Those extraction actions never call a
device API and are unmistakably labeled as preview state. Debug mode is not an
integration or safety test.

The debug dashboard uses bottom navigation to separate live Dashboard,
extraction Profiles, and Machine configuration. Its in-memory client also
implements the strict temperature-calibration transaction. While a mock
extraction is active, a persistent bar above the navigation links back to its
Start/Stop and phase controls.

The mobile UI auto-rotates when the OS permits it. Portrait uses bottom
navigation; landscape phones use the transparent three-dot rail and responsive
columns. Tap a dot or swipe vertically anywhere to move among Dashboard,
Profiles, and Machine. Taller pages scroll until the matching boundary before
the page gesture takes over, and horizontal graph paging remains independent.
Confirm that page content fades and slides in the navigation direction while
the rail remains fixed. Rotate through both landscape directions and confirm
that the rail is compact on the plain edge and notch-inset on the cutout edge.
The Machine page contains an opt-in Keep screen awake preference for
mounted-screen review. Verify that it releases on backgrounding; this display
behavior is not part of the firmware control or safety loop.

On a connected production Dashboard, verify that equal-height status, cooldown,
and extraction cards form the top landscape row, with temperature and a
two-thirds-width graph directly beneath. Opening the quick-profile chooser must
overlay the lower content without resizing that row, with Manual spanning the
first row and the four slots in a 2-by-2 grid below. Selecting an unavailable
custom profile should keep the card height stable and show an action beneath
the selector that opens Profiles; cooldown and steam actions should open
Machine. Compact landscape should omit the pump-command line and let Start or
Stop fill the adjacent column; portrait should retain the full status copy.
Profiles should show the editor on the left and the 2-by-2 profile selection
above sync on the right without clipping. Its compact duration steppers should
render as unified rounded controls.

From Machine, open Temperature Calibration and verify that its full-screen
modal rotates into both landscape directions, uses compact non-clipping columns,
and retains readable raw/effective, candidate, offset, heater, readiness,
advisory stability, safe-bound, lease, error, Cancel, and explicit Save-review
states. The user operates the steam wand manually; the app never commands the
pump or detects steam.

### Simulator-backed app

Start the API simulator in one terminal:

```bash
bun run simulator
```

The default process listens on `http://localhost:3000` and accepts `philcoino-dev-token`. Enter the reachable host address manually in the app. `localhost` from a physical phone refers to the phone, not the development computer; use the computer's LAN address and ensure both devices are on the same network.

Local HTTP is deliberately enabled for this device protocol. Do not generalize that configuration to arbitrary internet hosts.

## Device simulator

Production-compatible routes include the temperature-only API v1 and the
breaking extraction/compensation/cooldown API v2. Development controls are
separate:

```text
POST /_simulator/advance
PUT  /_simulator/raw-temperature
PUT  /_simulator/fault
POST /_simulator/power-cycle
POST /_simulator/reset
POST /_simulator/fail-next-temperature-calibration-save
POST /_simulator/corrupt-temperature-calibration
POST /_simulator/fail-next-steam-control-save
POST /_simulator/corrupt-steam-control
```

Examples:

```bash
curl -X POST http://localhost:3000/_simulator/advance \
  -H 'Content-Type: application/json' \
  -d '{"milliseconds":3000}'

curl -X PUT http://localhost:3000/_simulator/raw-temperature \
  -H 'Content-Type: application/json' \
  -d '{"boilerTemperatureRawC":93}'

curl http://localhost:3000/api/v1/state \
  -H 'Authorization: Bearer philcoino-dev-token'
```

Manual time never advances in the background. Power-cycle clears volatile state
and preserves targets, the signed temperature offset, and Steam
control settings; reset restores all persisted defaults and removes the
calibration record. The simple temperature model is for deterministic
app/contract scenarios only.

The mobile live poll uses only the strict queryless state shape:

```bash
curl 'http://localhost:3000/api/v2/state' \
  -H 'Authorization: Bearer philcoino-dev-token'
```

Any state query parameter, including the removed prediction opt-in, is rejected
as malformed.

After starting any extraction, inspect its authenticated SSE stream with:

```bash
curl -N http://localhost:3000/api/v2/extractions/stream \
  -H 'Authorization: Bearer philcoino-dev-token' \
  -H 'Accept: text/event-stream'
```

Advance simulator time from a second terminal while the stream is open. The
simulator immediately publishes deterministic 250 ms observations for every
crossed interval; it does not sleep in real time. Reconnect by supplying all
three values from `nextCursor` as `bootId`, `extractionId`, and
`afterSequence`. Supplying only part of the cursor is invalid. The mobile app
uses this stream for extraction telemetry and keeps the queryless one-second
combined-state poll for authoritative workflow/fault/connection state; it does
not fall back to high-frequency REST polling.

Power-cycle changes the extraction replay boot ID and clears retained stream
pages. Simulator diagnostics are deterministic logical values for contract/UI
testing; they do not reproduce firmware PI timing, SSR delivery, or physical
temperature response.

The simulator stores the injected raw temperature and applies the one persisted
signed global offset exactly once to produce effective
`boilerTemperatureC` in either mode. It implements the raw-target calibration
workflow, persistence failures, corrupt-record startup fault, offset-adjusted
target reachability, inclusive raw/effective `135°C` caps, and faults strictly
above either cap.
In Steam, the simulator deterministically adds the persisted linearly decaying
heat-soak estimate to the effective sensor value for control/readiness while
keeping `boilerTemperatureC` and its safety checks unchanged. It exposes the
estimate and settings in state and implements authenticated
`GET`/`PATCH /api/v2/settings/steam-control`. This does not model separate
boiler-base and upper-boiler temperatures, establish the real lag, or validate
a user-observed physical boiling point.

The simulator also serves authenticated API v2 state, inline-profile extraction
Start/Stop, cooldown Start/Stop, and the scale diagnostic/calibration/warning
endpoints. Manual time owns extraction and cooldown progress; power-cycle always
returns both workflows to idle. Cooldown deterministically stops at the first
sample at/below its target snapshot, at 45 seconds, or on Stop, followed by five
seconds of stabilization. Failure controls and temperature injection support
API/mobile integration only; they are not firmware scheduling, GPIO, pump-flow,
cooling, SSR, or heater-safety evidence.

`POST /_simulator/scale` controls deterministic mass, stability, drift,
disconnection, and saturation. Weighted profile Start performs automatic tare;
advancing mass can trigger cutoff in any profile phase, while an injected scale
failure exercises the original-profile timer fallback. These controls validate
the API/mobile workflow only and do not characterize a physical HX711.

## Protocol workflow

Change the wire contract in this order:

1. edit `packages/protocol/openapi.yaml`;
2. align `src/schemas.ts` and exports;
3. update valid and invalid fixtures;
4. update simulator, mobile, and independent firmware behavior;
5. update tests and documentation.

The OpenAPI file is JSON-compatible YAML, so the project validator parses it without adding a YAML dependency.

## Offline thermal modeling

The Python 3.12+ tool in `tools/thermal-modeling` consumes exported CSV files and
produces analysis, predictor, plant-model, simulation, and candidate firmware
artifacts. This is preserved historical/offline research; current firmware does
not consume predictor artifacts. Minimum non-predictive exports are supported,
and legacy prediction columns are accepted but ignored by default for modeling
inputs. It never edits or flashes firmware. Create an isolated environment,
install the declared project dependencies, and run its tests:

```bash
python3.12 -m venv tools/thermal-modeling/.venv
tools/thermal-modeling/.venv/bin/python -m pip install -e './tools/thermal-modeling[test]'
tools/thermal-modeling/.venv/bin/pytest tools/thermal-modeling/tests
```

Dependency installation requires explicit owner approval under the repository
working agreements. See `tools/thermal-modeling/README.md` for every CLI command,
artifact path, promotion rule, session-boundary policy, brew-only default, and
daily-export workflow. The mobile app exports the current local day; assemble a
weekly run from separate daily CSVs rather than relying on an automatic age
filter.

## Firmware workflows

### Host tests

Host tests exercise pure C++ configuration, peripheral policies, control,
fixed extraction telemetry buffers, cursor/continuity rules, serialization,
and resource bounds without ESP-IDF or hardware:

```bash
cmake -S firmware/espresso-machine/host-tests -B /tmp/philcoino-host-tests
cmake --build /tmp/philcoino-host-tests
ctest --test-dir /tmp/philcoino-host-tests --output-on-failure
/tmp/philcoino-host-tests/firmware_api_test \
  /tmp/philcoino-firmware-contract
bun run firmware/espresso-machine/host-tests/validate_contract.ts \
  /tmp/philcoino-firmware-contract
```

Use a temporary build directory outside the repository to avoid generated output in the worktree.

The generated capture set includes unchanged API v1 and queryless API v2 state
responses plus strict inline-profile API v2 extraction,
compensation, cooldown Start/replay/conflict/Stop/terminal,
Steam-control settings/state,
temperature-calibration status/Start/candidate/Save/Cancel, eligibility errors,
and failed terminal state.
Capture validation proves only that independent C++ serialization matches the
wire schemas.

`extraction_telemetry_test` additionally covers all extraction modes,
best-effort baseline behavior, the 250 ms/ten-second lifecycle, retention and
wrap-safe timing, zero-wait contention gaps, and bounded sixteen-sample pages.
The async ESP-IDF server path, one-client enforcement, socket send failure, and
task stack/heap behavior still require the pinned target build and connected
acceptance below.

Run the pure API codec/property targets and deterministic mutation campaign
under AddressSanitizer and UndefinedBehaviorSanitizer with:

```bash
cmake -S firmware/espresso-machine/host-tests \
  -B /tmp/philcoino-host-tests-sanitized \
  -DPHILCOINO_ENABLE_SANITIZERS=ON
cmake --build /tmp/philcoino-host-tests-sanitized
ctest --test-dir /tmp/philcoino-host-tests-sanitized --output-on-failure
```

`api_codec_mutation_test` applies fixed-seed truncation, byte mutation,
whitespace, permutation, duplicate/unknown-field, scalar substitution,
malformed token/composite, and size-bound cases to every pure request parser.
Its `LLVMFuzzerTestOneInput` entry point can be linked to an already-available
coverage-guided engine, but PRD-005 does not require or authorize installing
one.

### ESP-IDF target

Activate the pinned ESP-IDF 6.0.2 environment, then run from `firmware/espresso-machine`:

```bash
idf.py set-target esp32c3
idf.py build
```

Configure Wi-Fi SSID, Wi-Fi password, and bearer token through `idf.py menuconfig` under `PhilcoINO`. Values belong only in generated, ignored `sdkconfig`; never put them in source, defaults, logs, screenshots, tests, or documentation.

For PRD-019 connected acceptance, keep mains loads disconnected unless a
separate supervised safety procedure explicitly authorizes them. Compare the
pre-stream and streaming builds for request rate, ordinary HTTP latency,
free/minimum heap, stream-task stack high-water mark, workflow-mutex duration,
sequence gaps, Wi-Fi loss/recovery, and temperature/control-loop deadline
misses. Exercise Start, live samples, client disconnect, durable-cursor replay,
the ten-second settling tail, and terminal closure for Manual, timed-profile,
and weighted-profile shots on both native iOS and Android clients. Record raw
measurements in the PRD evidence; a successful target build alone is not this
runtime acceptance and neither is energized/physical-safety approval.

Current source permanently uses one boiler-base thermocouple on
GPIO4/GPIO5/GPIO7 for both control modes. Firmware validates the raw sample,
checks the independent raw `135°C` cap, and applies one persisted signed
global offset exactly once before Brew and Steam control, readiness, safety,
history, and API use. A missing calibration record is uncalibrated `0°C`;
corrupt or unreadable calibration storage faults with heater command off.
Steam then uses a separate volatile heat-soak estimate for control semantics
only. Its persisted defaults are `12°C` initial compensation, `12 min` linear
decay, and `5 min` post-ready timeout; allowed settings are `0–20°C`,
`1–30 min`, and `1–15 min`. Raw/effective safety evaluation never includes
this transient term.
Manual/main extraction
adds a separate compile-time `+2°C` bias only to the private heater-duty target;
pre-infusion uses `0°C`. Cooldown uses the validated Brew-effective sample,
fixed 45-second pump cutoff, and fixed five-second stabilization. Temperature
calibration is changed only through the authenticated API v2 firmware-owned
session; it starts at raw `100°C`, accepts whole-degree raw candidates from
`90–120°C`, and saves `100 - candidate` only after strict reachability and NVS
success. Check [Safety](SAFETY.md), the tracker, and hardware documents before
any device test. The 2026-07-16 acceptance predates this calibration change and
does not authorize it on an energized setup or unattended use.

The `CONFIG_PHILCOINO_BREW_PI_CONTROL` Kconfig selector defaults off. Disabled
builds keep the legacy Brew curve authoritative and run PI only as a bounded
shadow calculation; enabled builds select PI requested duty only for Brew.
Both use the same ten-second SSR window, minimum pulse, permission, inhibit,
fault, lease, and fail-off path. Steam always uses the legacy curve. The host
matrix builds authority tests in both modes, but changing the target selector
through `idf.py menuconfig` creates a different physical-test configuration.
Do not enable it for connected heater work without the supervised PRD-016 A/B
procedure and independent over-temperature protection.

### Low-voltage only

Repository development does not authorize mains power. With heater and pump loads disconnected, supervised checks may validate boot, the single boiler sensor against an independent instrument, open-probe behavior, network discovery, and the heater/pump control GPIO inactive levels. Record physical evidence in the tracker/side notes only after the responsible human confirms it.

## Verification matrix

Run commands from the repository root unless noted.

### Mobile

```bash
bun run typecheck
bun run --cwd apps/mobile test
bun run lint
```

For UI or platform changes, also exercise each affected target and note any platform not run.

### Protocol

```bash
bun run validate:openapi
bun run typecheck:protocol
bun run test:protocol
```

Because protocol changes affect consumers, also run mobile and simulator typechecks/tests plus firmware contract validation.

### Simulator

```bash
bun run typecheck:simulator
bun run test:simulator
```

### Firmware

Run the host commands above for pure C++ changes. Run the pinned `idf.py build` for ESP-IDF adapter, component, configuration, partition, or startup changes when the toolchain is available.

### Documentation

- check every command against `package.json`, package manifests, or CMake files;
- check internal links and case-sensitive paths;
- distinguish implemented, simulated, planned, and human-approved behavior;
- keep README, architecture, safety, package guides, tracker, and side notes consistent.

## Troubleshooting

### Discovery finds nothing

- use a physical iOS/Android development build;
- put phone and machine/computer on the same Wi-Fi;
- grant Local Network permission on iOS and required Wi-Fi/multicast permissions on Android;
- use manual IP/hostname entry when mDNS is unavailable;
- remember that some guest/corporate networks isolate clients or block multicast.

### The app reports protocol error

The host answered, but the success/error body failed strict API v1/v2
validation. The connection detail includes the endpoint, HTTP status, and up to
eight sanitized invalid-field paths when the parser provides them; it never
includes response values or credentials. Compare those paths with
`packages/protocol/openapi.yaml`; do not weaken the app schema as a workaround.

### A mutation is not shown

This is intentional until acknowledgement. A timeout, cancellation, invalid response, lost connection, or firmware rejection leaves the requested value out of live state.

### Firmware does not boot control

Startup fails off when SSR, station MAC, NVS, MAX6675 setup, initial sensor sampling, or synchronization setup fails. Inspect logs without exposing credentials and resolve the owning hardware/adapter boundary. Do not bypass a failure merely to energize the heater.
