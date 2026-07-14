# ESP32 API v2 profile and extraction outline

Status: IMPLEMENTED; PHYSICAL ACCEPTANCE PENDING

The authoritative wire contract is
[`packages/protocol/openapi.yaml`](../../packages/protocol/openapi.yaml). API v2
is additive: every API v1 temperature endpoint remains available and unchanged.

The nested `machine.boilerTemperatureC` retains the API v1 semantics: it is the
validated raw boiler-base reading in Brew and the active effective reading with
the firmware-configured `+5°C` correction in Steam. Switching modes can change
the reported value by exactly `5°C` without a new physical sensor sample. API
v2 adds no raw-temperature or offset field.

## Authenticated endpoints

- `GET /api/v2/state` returns one acknowledged machine/extraction snapshot.
- `GET /api/v2/profiles` returns all four ordered custom slots.
- `PUT /api/v2/profiles` atomically persists and acknowledges the complete set
  only while extraction is idle.
- `POST /api/v2/extractions/start` starts Manual or one persisted slot with a
  client idempotency key.
- `POST /api/v2/extractions/stop` idempotently commands off and returns idle.

All endpoints require the same bearer authentication as API v1. Unknown fields,
invalid slot order/IDs, invalid names or durations, malformed selections, and
invalid idempotency keys are rejected independently by firmware C++.

## Authority and timing

Firmware snapshots a selected profile at Start and owns pre-infusion pump-on,
soak pump-off, main extraction pump-on, completion, and the 60-second Manual
cutoff using wrap-safe monotonic time. A same-key retry returns the original
active extraction without restarting it; another key conflicts. Stop is
idempotent. Heater mode, readiness, and temperature faults do not stop the pump,
while GPIO/synchronization failure ends extraction with an off command.

Profile persistence occurs only while idle and outside the extraction lock.
Phone disconnection cannot interrupt an acknowledged extraction. Reset or power
loss clears volatile extraction/idempotency state and boot never restores a
running command.

## Command-state boundary

`pumpCommand: "running"` and `pumpCommand: "off"` describe only the firmware's
GPIO10 command. The device has no pump-current, SSR-output, original-switch,
pressure, or flow feedback. Neither state proves physical pump operation or
de-energization, and an SSR may fail shorted.

## Evidence boundary

OpenAPI/Zod tests, simulator scenarios, mobile integration tests, C++ host tests,
and firmware captures establish software/contract behavior at their respective
levels. The ESP-IDF target build and disconnected low-voltage GPIO10 matrix remain
PUMP-009 human acceptance work; no software result authorizes energized testing.
