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
- `GET /api/v2/history` returns up to sixty ascending RAM-retained samples with
  boot/sequence continuity metadata.
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
- `GET /api/v2/scale` returns calibration, availability, live weight, active
  weighted extraction, warning, and retained terminal state.
- `POST /api/v2/scale/calibration/start`, `/complete`, and `/cancel` implement
  the strict two-step calibration workflow.
- `POST /api/v2/scale/warnings/acknowledge` clears the weighted-start gate
  after a timer fallback.

All endpoints require the same bearer authentication as API v1. Unknown fields,
invalid slot order/IDs, invalid names or durations, malformed selections, and
invalid idempotency keys are rejected independently by firmware C++.
Extraction Start requires acknowledged Brew mode and idle cooldown. Steam mode
is rejected during extraction or cooldown. Conflict bodies include the active
workflow snapshot when the contract requires it.

History authentication is resolved before query parsing. A request either has
no cursor or has exactly one `bootId` plus one `afterSequence`; unknown,
duplicate, partial, malformed, evicted, and future cursor cases follow the
strict contract. No cursor begins at the oldest retained sample. A matching
cursor is `continuous`, an evicted cursor is `truncated`, and a different boot
ID is `reset`; `initial` identifies the no-cursor start. Each page includes the
current boot ID, capture uptime, available sequence bounds, next durable cursor,
`hasMore`, and complete graph command/status/fault context. Existing API v1 and
v2 response bodies are unchanged.

## Authority and timing

Firmware snapshots a selected profile at Start and owns pre-infusion pump-on,
soak pump-off, main extraction pump-on, completion, and the 60-second Manual
cutoff using wrap-safe monotonic time. A same-key retry returns the original
active extraction without restarting it; another key conflicts. Stop is
idempotent. Heater mode, readiness, and temperature faults do not stop the pump,
while GPIO/synchronization failure ends extraction with an off command.

A profile Start may additionally contain strict integer-decigram weight
control. Manual plus weight control is rejected. Firmware requires calibrated,
available, stable scale input, captures tare, and only then starts the pump; a
failed tare leaves extraction idle. The normal weighted cutoff applies in every
profile phase at `target - compensation`. If scale input fails after Start,
firmware switches to the selected profile's original monotonic deadline,
records a degraded terminal result, and blocks another weighted Start until
acknowledgement. The independent 60-second extraction cutoff remains in force.
Same-key retries compare the exact weight parameters and never repeat tare or
restart an acknowledged extraction. The latest weighted terminal result is
retained until the next weighted Start or reboot.

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

Extraction and cooldown retain workflow-owned terminal acknowledgements even
though they share one pump output. A normally completed or stopped workflow
therefore continues to report its own `pumpCommand: "off"` if the other
workflow later commands the shared pump to run. Calling cooldown Stop while
cooldown is already idle is a no-op for that shared output and cannot interrupt
an active extraction. If a cooldown pump-off write itself fails, the terminal
failed acknowledgement may retain `pumpCommand: "running"` to report the last
successful command instead of falsely claiming off.

Profile and target persistence occur outside the single bounded workflow mutex.
Phone disconnection cannot interrupt an acknowledged extraction or cooldown.
Reset or power loss clears volatile workflow/idempotency state and boot never
restores a running command.

History is also volatile. Firmware retains at most ten minutes at one sample
per second, assigns a new ephemeral 128-bit boot ID on startup, and never writes
samples or cursors to NVS. Missing samples are not synthesized. History reads
copy a bounded page under their own guard and serialize after release; history
never supplies input to temperature, heater, pump, readiness, timeout, fault,
or mutation decisions.

## Command-state boundary

`pumpCommand: "running"`, `pumpCommand: "off"`, `heaterActive`, and
`heaterInhibited` describe firmware command/policy state only. The device has no
pump-current, SSR-output, original-switch, pressure, flow, or verified cooling
feedback. These fields do not prove physical pump/heater operation,
de-energization, or temperature reduction. A failed off write can retain a
running command, and an SSR may fail shorted regardless of the reported command.

## Evidence boundary

OpenAPI/Zod tests, simulator scenarios, mobile integration tests, C++ host tests,
and firmware captures establish software/contract behavior at their respective
levels. On 2026-07-16, the owner reported that every implemented feature and
technical-equipment energy-control check passed, and accepted THERM-010 and
THERM-011 for the tested configuration. Raw instrument/setup artifacts were not
committed; this Human acceptance is not certification and does not change the
command-state boundary above.
