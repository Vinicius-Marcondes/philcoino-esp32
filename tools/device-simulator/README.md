# Philcoino device simulator

Development-only Bun/Hono implementation of the ESP32 API v1 contract. The
default bearer token is `philcoino-dev-token`.

From the repository root:

```sh
bun run simulator
bun run test:simulator
bun run typecheck:simulator
```

The production-compatible endpoints are:

- `GET /healthz`
- `GET /api/v1/device`
- `GET /api/v1/state`
- `PATCH /api/v1/settings/temperatures`
- `PUT /api/v1/mode`

The three `/api/v1` machine endpoints require
`Authorization: Bearer philcoino-dev-token`. Public and authenticated payloads
are validated with `@philcoino/protocol` schemas.

## Deterministic controls

These development-only controls are intentionally outside `/api/v1` and are
not part of the firmware contract:

- `POST /_simulator/advance` with `{ "milliseconds": 3000 }` advances the
  manual clock and temperature model by at most one simulated hour.
- `PUT /_simulator/temperatures` sets one or both sensor readings, for example
  `{ "steamTemperatureC": 115 }`.
- `PUT /_simulator/fault` latches a contract fault code, for example
  `{ "code": "sensor_failure" }`.
- `POST /_simulator/power-cycle` clears volatile mode, timers, temperatures,
  uptime, and faults while preserving temperature targets.
- `POST /_simulator/reset` also restores the default persisted targets.

Manual time keeps readiness and the five-minute steam timeout deterministic;
the simulator never advances in the background.
