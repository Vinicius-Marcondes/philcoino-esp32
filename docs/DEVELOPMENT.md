# Development

This guide covers the Expo/TypeScript workspaces and independent ESP-IDF 6.0.2
ESP32-S3 firmware. Do not install a new package, CLI, SDK, or dependency
without explicit approval.

## Prerequisites

- Repository-pinned Bun dependencies and Node.js 20.19+ for Expo SDK 54.
- Xcode/iOS or Android tooling only when testing those existing targets.
- CMake/C++17 for firmware host tests.
- ESP-IDF 6.0.2 for the `esp32s3` target build.

Firmware resolves `espressif/mdns` 1.11.3 and the immutable
`rbdimmer/rbdimmerESP32` 2.0.1 source recorded in `dependencies.lock`.
Do not inspect or commit dependency directories, generated `sdkconfig`, build
output, caches, native generated projects, secrets, or local databases.

## Coordinated API v4 workflow

API changes proceed in this order:

1. Update `packages/protocol/openapi.yaml`.
2. Align strict Zod schemas, types, and valid/invalid v4 fixtures.
3. Align simulator behavior and tests.
4. Align mobile discovery/pairing/client/storage/presentation and tests.
5. Independently align firmware C++ routes, codecs, behavior, and captures.
6. Run every affected check and update architecture/safety/protocol docs.

API v1-v3 compatibility is intentionally absent. Changing v4 identity or
pairing requires a rebuilt native app and fresh pairing.

## TypeScript verification

From the repository root:

```bash
bun run validate:openapi
bun run test:protocol
bun run typecheck:protocol
bun run test:simulator
bun run typecheck:simulator
bun run typecheck
bun run --cwd apps/mobile test
bun run lint
```

Use `EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run start` for presentation-only
work without a device. Use `bun run simulator` for deterministic API v4
integration. Neither mode is firmware or physical-safety evidence.

Native mDNS, SRP/certificate binding, SecureStore, SQLite migration behavior,
and local-network permissions require rebuilt platform clients. Web and Expo Go
do not represent the complete production pairing path.

## Firmware host verification

Use temporary build/capture directories outside the repository:

```bash
cmake -S firmware/espresso-machine/host-tests -B /tmp/philcoino-host-tests
cmake --build /tmp/philcoino-host-tests
ctest --test-dir /tmp/philcoino-host-tests --output-on-failure
/tmp/philcoino-host-tests/firmware_api_test /tmp/philcoino-contract-v4
bun run ./firmware/espresso-machine/host-tests/validate_contract.ts \
  /tmp/philcoino-contract-v4
```

The capture validator independently parses 10 API v4 C++ responses, including
both calibration sensors, extraction transitions, settings, heater permission,
an unauthorized error, and a Steam-attributed over-temperature fault.

Sanitizer suite:

```bash
cmake -S firmware/espresso-machine/host-tests \
  -B /tmp/philcoino-host-tests-sanitized \
  -DPHILCOINO_ENABLE_SANITIZERS=ON
cmake --build /tmp/philcoino-host-tests-sanitized
ctest --test-dir /tmp/philcoino-host-tests-sanitized --output-on-failure
```

Host coverage includes both MAX6675 baselines and validation edges, independent
calibration/reachability, active/inactive failures, switching/no-fallback,
both-sensor over-temperature, fail-off output races, extraction, weighted
fallback, cooldown, OTA policy, strict API parsing, and telemetry format 2.

## ESP-IDF target

Activate the existing pinned ESP-IDF 6.0.2 environment, then from
`firmware/espresso-machine`:

```bash
idf.py set-target esp32s3
idf.py build
```

The configuration fixes 16 MB QIO/80 MHz flash, native USB Serial/JTAG, no
PSRAM, CPU1 control-side tasks, CPU0 networking, and existing OTA partitions
inside the first 4 MB. Configure secrets only with `idf.py menuconfig`; never
put credentials in defaults/source/tests/logs.

CI's firmware target job uses `esp32s3`. A green build validates compilation
and link integration only; it does not validate GPIO exposure, task timing on
the board, probes, dimmer, SSR, USB recovery, or mains behavior.

## Hardware boundary

Do not flash a control-capable build until the exact 44-pin board exposes the
fixed map in [S3 wiring](hardware/esp32-s3-n16r8-wiring.md) and both
thermocouples are electrically ungrounded.

With heater and pump loads disconnected, supervised low-voltage work may check
simultaneous readings, probe isolation, bus waveforms, boot/reset levels, native
USB recovery, isolated ZC input, dimmer 0%, and 90% timing. No repository task
authorizes energized mains work. Prior C3/single-sensor/SSR/RobotDyn evidence
does not apply to this hardware generation.

## Troubleshooting

### Discovery finds nothing

- Use a rebuilt iOS/Android development app on the same non-isolated LAN.
- Grant local-network/multicast permissions and use manual address fallback.
- Remove the remembered v3 machine and pair the S3/v4 identity freshly.

### TLS handshake failures repeat

Confirm the rebuilt app is using the v4 native transport and the certificate
binding from its fresh pairing. Stale clients, HTTP probes sent to the HTTPS
port, certificate mismatch, or resource pressure can abort a handshake. Do not
weaken certificate validation.

### Firmware does not start control

Startup deliberately aborts after bus/GPIO/NVS/initialization failures while
retrying heater and pump OFF. Resolve the owning adapter/hardware condition;
never bypass fail-off startup to energize loads.
