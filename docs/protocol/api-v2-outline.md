# ESP32 API v2 workflow outline

Status: IMPLEMENTED; HUMAN ACCEPTED 2026-07-16

The authoritative wire contract is
[`packages/protocol/openapi.yaml`](../../packages/protocol/openapi.yaml). API v2
is additive: every API v1 temperature endpoint remains available and unchanged.

The nested `machine.boilerTemperatureC` retains the API v1 semantics: it is the
validated raw boiler-base reading in Brew and the active effective reading with
the firmware-configured `+5°C` correction in Steam. Switching modes can change
the reported value by exactly `5°C` without a new physical sensor sample. API
v2 adds no raw-temperature or offset field.

## Authenticated endpoints

- `GET /api/v2/state` returns one acknowledged
  machine/extraction/compensation/cooldown snapshot.
- `GET /api/v2/profiles` returns all four ordered custom slots.
- `PUT /api/v2/profiles` atomically persists and acknowledges the complete set
  only while extraction and cooldown are idle.
- `POST /api/v2/extractions/start` starts Manual or one persisted slot with a
  client idempotency key.
- `POST /api/v2/extractions/stop` idempotently commands off and returns idle.
- `POST /api/v2/cooldowns/start` idempotently starts or replays the
  firmware-owned cooldown workflow.
- `POST /api/v2/cooldowns/stop` idempotently requests pump off and returns the
  current stabilization/terminal acknowledgement.

All endpoints require the same bearer authentication as API v1. Unknown fields,
invalid slot order/IDs, invalid names or durations, malformed selections, and
invalid idempotency keys are rejected independently by firmware C++.
Extraction Start requires acknowledged Brew mode and idle cooldown. Steam mode
is rejected during extraction or cooldown. Conflict bodies include the active
workflow snapshot when the contract requires it.

## Authority and timing

Firmware snapshots a selected profile at Start and owns pre-infusion pump-on,
soak pump-off, main extraction pump-on, completion, and the 60-second Manual
cutoff using wrap-safe monotonic time. A same-key retry returns the original
active extraction without restarting it; another key conflicts. Stop is
idempotent. Heater mode, readiness, and temperature faults do not stop the pump,
while GPIO/synchronization failure ends extraction with an off command.

The fixed extraction compensation is not a request value. Firmware reports it
active only during Manual or profile main extraction while its existing heater
permission/fault rules allow the duty policy. The private duty target is
`min(brewTargetC + 2°C, brewOverTemperatureC - 1°C)`; pre-infusion uses a fixed
`0°C` bias, and soak/idle use none. Persisted/displayed targets, readiness,
deadlines, limits, and profile data do not change.

Cooldown Start uses the validated Brew-effective sample, requires it to be
above the current Brew target, snapshots that target, switches to Brew,
establishes a transient heater inhibit and heater-off command, then requests
the pump-running command. Target crossing, the exact 45-second cutoff, or Stop
requests pump off and holds the heater inhibit through five seconds of
stabilization. User heater permission is separate. Same-key active or terminal
replay preserves identity and never restarts a deadline; reset/power loss never
resumes the RAM-only workflow.

Profile and target persistence occur outside the single bounded workflow mutex.
Phone disconnection cannot interrupt an acknowledged extraction or cooldown.
Reset or power loss clears volatile workflow/idempotency state and boot never
restores a running command.

## Command-state boundary

`pumpCommand: "running"`, `pumpCommand: "off"`, `heaterActive`, and
`heaterInhibited` describe firmware command/policy state only. The device has no
pump-current, SSR-output, original-switch, pressure, flow, or verified cooling
feedback. These fields do not prove physical pump/heater operation,
de-energization, or temperature reduction, and an SSR may fail shorted.

## Evidence boundary

OpenAPI/Zod tests, simulator scenarios, mobile integration tests, C++ host tests,
and firmware captures establish software/contract behavior at their respective
levels. On 2026-07-16, the owner reported that every implemented feature and
technical-equipment energy-control check passed, and accepted THERM-010 and
THERM-011 for the tested configuration. Raw instrument/setup artifacts were not
committed; this Human acceptance is not certification and does not change the
command-state boundary above.
