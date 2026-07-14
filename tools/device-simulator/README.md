# Philcoino device simulator

Development-only Bun/Hono implementation of Philcoino API v1 and v2. It supports deterministic mobile, contract, and integration scenarios without physical hardware.

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

## API v2 thermal workflows

Authenticated API v2 exposes the strict combined machine/extraction/
compensation/cooldown snapshot, four-slot profiles, Brew-only extraction, and
idempotent cooldown Start/Stop operations. Time remains manual:

- compensation is active only for Manual and profile main extraction while
  heater permission and fault state allow it;
- cooldown switches to Brew, preserves heater permission, snapshots the Brew
  target, holds the simulated heater command off, and reports pump command
  timing;
- the pump command stops at the snapshotted target, exactly 45 seconds, or
  Stop, followed by exactly five seconds of stabilization;
- same-key replay never resets elapsed time, and reset/power-cycle never resumes
  either workflow.

These are deterministic logical command states. They do not confirm pump
operation, water flow, cooling, current, SSR output, switch state, or physical
de-energization.

## Deterministic controls

These controls are intentionally outside `/api/v1` and must not appear in firmware:

- `POST /_simulator/advance` with `{ "milliseconds": 3000 }` advances manual time by at most one simulated hour per request.
- `PUT /_simulator/temperatures` sets the already-effective logical
  `boilerTemperatureC` control value. The simulator does not add the firmware
  Steam offset or model a physical top-to-bottom boiler gradient.
- `PUT /_simulator/fault` latches a contract fault code.
- `POST /_simulator/power-cycle` clears volatile mode, readings, heater permission, uptime, timers, and faults while preserving targets.
- `POST /_simulator/reset` also restores default targets.
- `POST /_simulator/fail-next-output-command` with a `command` of
  `heater-off`, `pump-running`, or `pump-off` injects one deterministic command
  failure for workflow/error UI tests.

Readiness requires three simulated seconds in the target band. The five-minute steam timeout begins at readiness and returns the model to brew. Time never advances in the background.

Simulator temperature scenarios are API/UI evidence only. They do not validate
the owner-selected `+5°C` firmware correction, physical calibration, or heater
safety.

See [Development](../../docs/DEVELOPMENT.md), [Architecture](../../docs/ARCHITECTURE.md), and [Safety](../../docs/en/SAFETY.md).
