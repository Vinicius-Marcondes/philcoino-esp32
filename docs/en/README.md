# Philcoino

[Português do Brasil](../../README.md)

Philcoino is a local-first espresso-machine monitoring, temperature-control, and extraction-command prototype. It combines an Expo mobile app, an OpenAPI contract, a deterministic device simulator, and ESP32-C3 firmware in one repository.

The phone discovers and authenticates one machine, displays live state, and submits target/mode/heater-permission changes. The ESP32 remains authoritative for sensor readings, persisted targets, readiness, heater output, timeouts, and faults.

> [!CAUTION]
> This project is not approved for production or unattended use. On 2026-07-16,
> the owner accepted one tested configuration after functional and technical-
> equipment energy-control checks; that is not certification or general
> authorization for another energized configuration. For development, use the
> simulator or low-voltage hardware, read [Safety and project status](SAFETY.md),
> and preserve the open findings.

## What is implemented

- iOS/Android local discovery through `_philcoino._tcp` mDNS, with manual address fallback.
- Public device identity inspection followed by bearer-token authentication.
- Secure storage of one selected device, token, and last successful address.
- Cached-address restore and stable-ID rediscovery after address changes.
- Strict API v1/v2 runtime validation and explicit offline, unauthorized, not-found, timeout, and protocol-error states.
- Completion-driven one-second dashboard polling while the screen/app is active.
- Current-day SQLite history with automatic backfill from up to ten minutes of
  ESP32 RAM history and horizontally paged 30-second Live windows.
- Firmware-acknowledged brew/steam targets, active mode, heater permission, and over-temperature dismissal.
- ESP32-C3 control, NVS target persistence, MAX6675 sampling, SSD1306 output, HTTP/mDNS networking, and host-testable policy boundaries.
- Deterministic Bun/Hono simulator for mobile and contract development.
- Manual plus four local profile slots, explicit whole-set export, and
  firmware-acknowledged pre-infusion/soak/main extraction, Stop, and 60-second
  Manual cutoff.

The product is still a prototype. Human review of the tested configuration was
accepted on 2026-07-16, while PHIL-012 automated resilience work and the known
engineering/security findings remain; see [the tracker](../TRACKER.md) and
[known findings](../../CODEBASE_REVIEW_REPORT.md).

## System at a glance

```text
Expo mobile app
  discovery -> identity check -> bearer authentication -> SecureStore
      |                                                   |
      +-------------- local HTTP API v1 + v2 ------------+
                              |
                    ESP32 firmware (authority)
             sensors -> control -> SSR command -> faults
                              |
                         NVS targets

OpenAPI 3.1.1 contract
  -> strict Zod schemas (mobile + simulator)
  -> independent strict C++ validation (firmware)

Device simulator
  -> contract/UI development only; not a firmware safety model
```

For detailed ownership and failure flows, read [Architecture](../ARCHITECTURE.md).

## Repository layout

| Path | Responsibility |
| --- | --- |
| [`apps/mobile`](../../apps/mobile) | Expo 54 / React Native client, discovery, pairing, secure persistence, polling, controls, and UI |
| [`packages/protocol`](../../packages/protocol) | Authoritative OpenAPI contract, strict Zod schemas, fixtures, and contract tests |
| [`tools/device-simulator`](../../tools/device-simulator) | Deterministic Bun/Hono API simulator and development controls |
| [`firmware/espresso-machine`](../../firmware/espresso-machine) | Independent ESP-IDF 6.0.2 firmware and native host tests |
| [`docs`](..) | Architecture, development, safety, PRD, hardware, decisions, and references |

The Bun workspace includes `apps/*`, `packages/*`, and `tools/*`. Firmware has its own CMake/ESP-IDF toolchain and is intentionally not a Bun package.

## Quick start without hardware

Prerequisites:

- Bun compatible with the committed lockfile;
- Node.js 20.19 or newer for Expo SDK 54;
- installed workspace dependencies (`bun install`) before running commands.

No new dependencies are required beyond the repository manifest. From the repository root:

```bash
bun install
EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run start
```

Debug-device mode renders the dashboard without discovery, authentication, network requests, or an ESP32. It is useful for UI work, but its temperatures and uptime remain static.

For API and integration work, run the deterministic simulator instead:

```bash
bun run simulator
```

It listens on `http://localhost:3000` by default and uses the development bearer token `philcoino-dev-token`. In the app, enter the simulator address manually. Native local-network discovery requires an iOS/Android development build; web and unsupported platforms use manual entry.

See [Development](../DEVELOPMENT.md) for platform workflows, simulator controls, firmware setup, and the full verification matrix.

## API contract

[`packages/protocol/openapi.yaml`](../../packages/protocol/openapi.yaml) is the wire source of truth. The public endpoints are:

- `GET /healthz`
- `GET /api/v1/device`

Authenticated endpoints require `Authorization: Bearer <token>`:

- `GET /api/v1/state`
- `PATCH /api/v1/settings/temperatures`
- `PUT /api/v1/mode`
- `PUT /api/v1/heater`
- `POST /api/v1/faults/over-temperature/dismiss`

API v2 adds without removing v1:

- `GET /api/v2/state`
- `GET /api/v2/history`
- `GET` and `PUT /api/v2/profiles`
- `POST /api/v2/extractions/start`
- `POST /api/v2/extractions/stop`
- `POST /api/v2/cooldowns/start`
- `POST /api/v2/cooldowns/stop`

Historical and current `running`/`off` values describe firmware commands, not
current, flow, series
switch position, or confirmed physical de-energization.

The simulator also exposes `_simulator/*` controls that are deliberately outside API v1 and must never be implemented as production firmware endpoints.

## Core design rules

- Firmware, not the phone, owns the real-time and safety loop.
- Requested changes are not shown as live values until a valid firmware acknowledgement arrives.
- Polling pauses during a mutation so an older snapshot cannot overwrite an acknowledgement.
- Every discovery, storage, request, response, and error payload is validated at its boundary.
- Fault snapshots report the heater command inactive; physical output certainty still depends on hardware and the unresolved safety findings.
- Simulator behavior supports contract/UI testing and is not evidence that firmware timing or heater control is safe.

## Documentation

- [Documentation index](DOCUMENTATION.md)
- [Architecture](../ARCHITECTURE.md)
- [Development and verification](../DEVELOPMENT.md)
- [Safety and project status](SAFETY.md)
- [Contributing](CONTRIBUTING.md)
- [API v1 outline](../protocol/api-v1-outline.md)
- [API v2 outline](../protocol/api-v2-outline.md)
- [Hardware wiring](../hardware/esp32-c3-wiring.md)
- [Temperature-control tuning](../hardware/temperature-control-tuning.md)
- [PRD-001 tracker](../TRACKER.md)
- [Codebase review findings](../../CODEBASE_REVIEW_REPORT.md)

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Changes that touch the API, firmware control, hardware behavior, authentication, or persisted data require end-to-end review across all affected boundaries. Never include local secrets, generated native projects, dependency folders, firmware build output, or `sdkconfig` in a contribution.
