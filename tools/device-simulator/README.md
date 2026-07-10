# Philcoino device simulator

Development-only Bun/Hono implementation of Philcoino API v1. It supports deterministic mobile, contract, and integration scenarios without physical hardware.

> [!WARNING]
> This is an API/UI simulator, not a reference implementation of firmware safety. It does not model the real ten-second SSR duty loop, the MAX6675 bus, FreeRTOS scheduling, mutex/I/O stalls, automatic sensor failure, GPIO write failures, or physical temperature dynamics.

## Run and verify

From the repository root:

```bash
bun run simulator
bun run test:simulator
bun run typecheck:simulator
```

The default Bun server is available at `http://localhost:3000`. The default development bearer token is `philcoino-dev-token`.

## API v1

Public:

- `GET /healthz`
- `GET /api/v1/device`

Authenticated with `Authorization: Bearer philcoino-dev-token`:

- `GET /api/v1/state`
- `PATCH /api/v1/settings/temperatures`
- `PUT /api/v1/mode`
- `PUT /api/v1/heater`
- `POST /api/v1/faults/over-temperature/dismiss`

Requests, success responses, and error bodies are validated against `@philcoino/protocol`.

## Deterministic controls

These controls are intentionally outside `/api/v1` and must not appear in firmware:

- `POST /_simulator/advance` with `{ "milliseconds": 3000 }` advances manual time by at most one simulated hour per request.
- `PUT /_simulator/temperatures` sets the single `boilerTemperatureC` reading.
- `PUT /_simulator/fault` latches a contract fault code.
- `POST /_simulator/power-cycle` clears volatile mode, readings, heater permission, uptime, timers, and faults while preserving targets.
- `POST /_simulator/reset` also restores default targets.

Readiness requires three simulated seconds in the target band. The five-minute steam timeout begins at readiness and returns the model to brew. Time never advances in the background.

See [Development](../../docs/DEVELOPMENT.md), [Architecture](../../docs/ARCHITECTURE.md), and [Safety](../../docs/SAFETY.md).
