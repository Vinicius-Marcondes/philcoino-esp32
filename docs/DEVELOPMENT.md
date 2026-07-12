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

This mode bypasses discovery, SecureStore, bearer authentication, and HTTP. It acknowledges in-memory target/mode/heater changes, but temperatures and uptime stay at zero. It is not an integration or safety test.

### Simulator-backed app

Start the API simulator in one terminal:

```bash
bun run simulator
```

The default process listens on `http://localhost:3000` and accepts `philcoino-dev-token`. Enter the reachable host address manually in the app. `localhost` from a physical phone refers to the phone, not the development computer; use the computer's LAN address and ensure both devices are on the same network.

Local HTTP is deliberately enabled for this device protocol. Do not generalize that configuration to arbitrary internet hosts.

## Device simulator

Production-compatible routes match API v1. Development controls are separate:

```text
POST /_simulator/advance
PUT  /_simulator/temperatures
PUT  /_simulator/fault
POST /_simulator/power-cycle
POST /_simulator/reset
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

### ESP-IDF target

Activate the pinned ESP-IDF 6.0.2 environment, then run from `firmware/espresso-machine`:

```bash
idf.py set-target esp32c3
idf.py build
```

Configure Wi-Fi SSID, Wi-Fi password, and bearer token through `idf.py menuconfig` under `PhilcoINO`. Values belong only in generated, ignored `sdkconfig`; never put them in source, defaults, logs, screenshots, tests, or documentation.

<<<<<<< HEAD
Current source permanently uses one boiler-base thermocouple on GPIO4/GPIO6/GPIO7 for both control modes and has OLED support enabled (`kOledEnabled = true`). Check [Safety](SAFETY.md), the tracker, and hardware documents before any device test; physical acceptance remains incomplete.
||||||| 2610c05
Current source uses diagnostic single-thermocouple mode (`kDualThermocouplesEnabled = false`) and has OLED support enabled (`kOledEnabled = true`). Check [Safety](SAFETY.md), the tracker, and hardware documents before any device test; documentation currently records unresolved configuration/acceptance issues.
=======
Current source uses diagnostic single-thermocouple mode (`kDualThermocouplesEnabled = false`) and has OLED support enabled (`kOledEnabled = true`). Check [Safety](en/SAFETY.md), the tracker, and hardware documents before any device test; documentation currently records unresolved configuration/acceptance issues.
>>>>>>> main

### Low-voltage only

Repository development does not authorize mains power. With the heater/load disconnected, supervised checks may validate boot, the single boiler sensor against an independent instrument, open-probe behavior, display output, network discovery, and the SSR control GPIO's inactive level. Record physical evidence in the tracker/side notes only after the responsible human confirms it.

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

The host answered, but the success/error body failed strict API v1 validation. Compare it with `packages/protocol/openapi.yaml`; do not weaken the app schema as a workaround.

### A mutation is not shown

This is intentional until acknowledgement. A timeout, cancellation, invalid response, lost connection, or firmware rejection leaves the requested value out of live state.

### Firmware does not boot control

Startup fails off when SSR, station MAC, NVS, MAX6675 setup, enabled OLED, initial sensor/render, or synchronization setup fails. Inspect logs without exposing credentials and resolve the owning hardware/adapter boundary. Do not bypass a failure merely to energize the heater.
