# Philcoino

[Português do Brasil](../../README.md)

Philcoino is a local-first espresso-machine monitoring, temperature-control,
and extraction prototype. It combines an Expo 54 app, OpenAPI contract,
deterministic simulator, and ESP-IDF 6.0.2 firmware for one
ESP32-S3-WROOM-1 N16R8.

Firmware owns sensors, targets, persistence, readiness, timeouts, heater,
pump, and faults. The phone is never part of the safety loop.

> [!CAUTION]
> This project is not approved for production, unattended use, or energized
> testing. The S3/dual-MAX6675 migration invalidates direct reuse of prior C3,
> single-sensor, pump-SSR, or RobotDyn physical acceptance. Read
> [Safety](SAFETY.md) and the [S3 wiring record](../hardware/esp32-s3-n16r8-wiring.md).

## Current generation

- ESP32-S3 N16R8, firmware `0.5.0`, 16 MB QIO/80 MHz flash, PSRAM disabled.
- HTTPS API v4 only; API v3 is not served.
- New device identity/binding domains require a rebuilt app and fresh pairing.
- Boiler MAX6675: SCK4/SO5/CS7; Steam MAX6675: SCK4/SO8/CS9.
- Brew selects Boiler and Steam selects Steam, with no fallback or blending.
- Independent calibration records with one global calibration session.
- Steam controls directly to `steamTargetC`; only its ready timeout remains.
- RobotDyn ZC6/DIM10 at 60 Hz/LINEAR/0% initial/one 90% cap.
- HX711 DT11/SCK12; heater SSR command GPIO21.
- Control-side tasks run on CPU1 and networking/OTA runs on CPU0.

Dimmer percentages are abstract commands—not measured voltage, power,
pressure, or flow. There is no closed-loop pressure control.

## Repository

| Path | Responsibility |
| --- | --- |
| [`apps/mobile`](../../apps/mobile) | Expo 54 app, v4 discovery/pairing, dual dashboard, SQLite v8 history, CSV |
| [`packages/protocol`](../../packages/protocol) | API v4 OpenAPI, strict Zod schemas, fixtures, tests |
| [`tools/device-simulator`](../../tools/device-simulator) | Deterministic API/UI simulator; not physical evidence |
| [`firmware/espresso-machine`](../../firmware/espresso-machine) | S3 firmware, ESP-IDF adapters, native C++ tests |
| [`docs`](..) | Architecture, development, safety, hardware, PRDs, tracker |

## Development without hardware

Use only declared dependencies; do not install anything new without approval.

```bash
EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run start
bun run simulator
```

Run the coordinated protocol, simulator, and mobile checks:

```bash
bun run validate:openapi
bun run test:protocol
bun run typecheck:protocol
bun run test:simulator
bun run typecheck:simulator
bun run typecheck
bun run --cwd apps/mobile test
```

Host tests, sanitizers, contract captures, and the S3 target build are listed
in [Development](../DEVELOPMENT.md). They do not authorize flashing or mains.

## API v4

[`packages/protocol/openapi.yaml`](../../packages/protocol/openapi.yaml) is the
wire source of truth. API v4 uses SRP pairing, pinned HTTPS, complete
acknowledged state, sensor-qualified calibration routes, two nullable
temperature readings, sensor-attributed thermal faults, and extraction
telemetry page format 2.

## Documentation

- [Architecture](../ARCHITECTURE.md)
- [Development](../DEVELOPMENT.md)
- [Safety](SAFETY.md)
- [ESP32-S3 N16R8 wiring](../hardware/esp32-s3-n16r8-wiring.md)
- [Tracker](../TRACKER.md)
- [Codebase review](../../CODEBASE_REVIEW_REPORT.md)

Contributions must preserve firmware authority, fail-off outputs, strict
validation, acknowledged mutations, and documented safety boundaries. See
[Contributing](CONTRIBUTING.md).
