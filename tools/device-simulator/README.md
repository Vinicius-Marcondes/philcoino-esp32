# Philcoino device simulator

Development-only Bun/Hono implementation of HTTPS API v4. It supports mobile,
contract, pairing, dual-temperature, extraction-telemetry, and persistence
scenarios without hardware.

> [!WARNING]
> The simulator is UI/contract evidence only. It does not reproduce the
> MAX6675 bus, FreeRTOS scheduling, GPIO failures, TRIAC/SSR behavior, pressure,
> or physical thermal dynamics.

## Run and verify

```bash
bun run simulator
bun run test:simulator
bun run typecheck:simulator
```

API v1–v3 routes are deliberately absent. The simulator implements API v4 SRP
pairing, complete acknowledged state, sensor-qualified calibration routes,
extraction telemetry page format 2, and the same one-stream-subscriber policy
used by firmware.

## Dual-temperature model

Boiler and Steam have independent raw readings, signed calibration offsets,
availability, failure streaks, and persistence. Brew selects Boiler; Steam
selects Steam; there is no fallback or blending. A missing active reading turns
the logical heater command off immediately and latches after three consecutive
failures. Either raw reading above 135°C creates a sensor-attributed fault.

Only one temperature-calibration session is allowed globally. Each sensor uses
the raw 90–120°C candidate workflow and persists only its own offset. Steam
controls directly against the Steam reading and has only the ready-timeout
setting; no heat-soak compensation or decay model remains.

## Deterministic controls

`/_simulator/*` routes are intentionally outside API v4 and never exist in
firmware. They can advance manual time, set each raw temperature/availability,
inject sensor or output faults, corrupt either calibration record, power-cycle,
or reset the model. Power-cycle preserves targets, offsets, timeout, and paired
clients while clearing volatile control/workflow state; reset restores defaults.

Time never advances in the background. Readiness, active failure streaks,
mode-switch blocking, extraction phases, replay, and telemetry gaps therefore
remain deterministic in tests.

See [Development](../../docs/DEVELOPMENT.md),
[Architecture](../../docs/ARCHITECTURE.md), and
[Safety](../../docs/en/SAFETY.md).
