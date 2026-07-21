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
extraction Profiles, and Machine configuration. While a mock extraction is
active, a persistent bar above the navigation links back to its Start/Stop and
phase controls.

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

### Simulator-backed app

Start the API simulator in one terminal:

```bash
bun run simulator
```

The default process listens on `http://localhost:3000` and accepts `philcoino-dev-token`. Enter the reachable host address manually in the app. `localhost` from a physical phone refers to the phone, not the development computer; use the computer's LAN address and ensure both devices are on the same network.

Local HTTP is deliberately enabled for this device protocol. Do not generalize that configuration to arbitrary internet hosts.

## Device simulator

Production-compatible routes include the temperature-only API v1 and additive
profile/extraction/compensation/cooldown/history API v2. Development controls are
separate:

```text
POST /_simulator/advance
PUT  /_simulator/temperatures
PUT  /_simulator/fault
POST /_simulator/power-cycle
POST /_simulator/reset
POST /_simulator/fail-next-profile-save
```

Examples:

```bash
curl -X POST http://localhost:3000/_simulator/advance \
  -H 'Content-Type: application/json' \
  -d '{"milliseconds":3000}'

curl -X PUT http://localhost:3000/_simulator/temperatures \
  -H 'Content-Type: application/json' \
  -d '{"boilerTemperatureC":93}'

curl http://localhost:3000/api/v1/state \
  -H 'Authorization: Bearer philcoino-dev-token'
```

Manual time never advances in the background. Power-cycle clears volatile state and preserves targets; reset also restores default targets. The simple temperature model is for deterministic app/contract scenarios only.

Every manually crossed one-second boundary adds one history sample, capped at
600. Fetch retained pages with the development bearer token:

```bash
curl http://localhost:3000/api/v2/history \
  -H 'Authorization: Bearer philcoino-dev-token'
```

Use the returned `nextCursor.bootId` and `nextCursor.afterSequence` together for
the next page. Power-cycle changes the boot ID and clears retained history.

The simulator treats `boilerTemperatureC` as the already-effective logical
control temperature in either mode. It does not add the firmware Steam offset,
model separate boiler-base and upper-boiler temperatures, or validate that the
owner-selected physical correction is accurate.

The simulator also serves authenticated API v2 state, complete profile-set
read/replace, extraction Start/Stop, and cooldown Start/Stop. Manual time owns
extraction and cooldown progress; power-cycle preserves profiles but always
returns both workflows to idle. Cooldown deterministically stops at the first
sample at/below its target snapshot, at 45 seconds, or on Stop, followed by five
seconds of stabilization. Failure controls and temperature injection support
API/mobile integration only; they are not firmware scheduling, GPIO, pump-flow,
cooling, SSR, or heater-safety evidence.

## Protocol workflow

Change the wire contract in this order:

1. edit `packages/protocol/openapi.yaml`;
2. align `src/schemas.ts` and exports;
3. update valid and invalid fixtures;
4. update simulator, mobile, and independent firmware behavior;
5. update tests and documentation.

The OpenAPI file is JSON-compatible YAML, so the project validator parses it without adding a YAML dependency.

## Firmware workflows

### Host tests

Host tests exercise pure C++ configuration, peripheral policies, control, and API serialization without ESP-IDF or hardware:

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

The generated capture set includes unchanged API v1 responses plus strict API
v2 extraction, compensation, cooldown Start/replay/conflict/Stop/terminal,
history, eligibility errors, and failed terminal state. Capture validation proves only
that independent C++ serialization matches the wire schemas.

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

Current source permanently uses one boiler-base thermocouple on
GPIO4/GPIO5/GPIO7 for both control modes and has OLED support enabled
(`kOledEnabled = true`). Firmware validates the raw sample, reports it unchanged
in Brew, and applies the compile-time `kSteamTemperatureOffsetC = 5` correction
once in Steam before control, safety, API, and OLED use. Manual/main extraction
adds a separate compile-time `+2°C` bias only to the private heater-duty target;
pre-infusion uses `0°C`. Cooldown uses the validated Brew-effective sample,
fixed 45-second pump cutoff, and fixed five-second stabilization. None of these
values is configurable through NVS, HTTP, mDNS, simulator controls, OLED, or
mobile. Check [Safety](SAFETY.md), the tracker, and hardware documents before
any device test. The owner accepted the configuration tested on 2026-07-16;
that acceptance does not authorize a different setup or unattended use.

### Low-voltage only

Repository development does not authorize mains power. With heater and pump loads disconnected, supervised checks may validate boot, the single boiler sensor against an independent instrument, open-probe behavior, display output, network discovery, and the heater/pump control GPIO inactive levels. Record physical evidence in the tracker/side notes only after the responsible human confirms it.

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

Startup fails off when SSR, station MAC, NVS, MAX6675 setup, enabled OLED, initial sensor/render, or synchronization setup fails. Inspect logs without exposing credentials and resolve the owning hardware/adapter boundary. Do not bypass a failure merely to energize the heater.
