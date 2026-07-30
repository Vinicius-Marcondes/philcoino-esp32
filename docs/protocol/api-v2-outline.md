# ESP32 API v2 workflow outline

Status: IMPLEMENTED; CALIBRATION UI HUMAN ACCEPTED 2026-07-30; PHYSICAL ACCEPTANCE PENDING

The authoritative wire contract is
[`packages/protocol/openapi.yaml`](../../packages/protocol/openapi.yaml). API v2
is additive: every API v1 temperature endpoint remains available and unchanged.

PRD-017 supersedes the former mode-dependent `+5°C` Steam correction.
`machine.boilerTemperatureC` is now defined as the firmware-authoritative
effective temperature in both Brew and Steam:

```text
effectiveTemperatureC = rawTemperatureC + temperatureOffsetC
```

The same persisted signed offset is applied exactly once after raw-sensor
validation. A missing calibration record means uncalibrated with `0°C`.
Existing machine-state payload shapes remain unchanged; raw temperature and
calibration details are exposed only by the additive calibration resource.

## Authenticated endpoints

- `GET /api/v2/state` returns one acknowledged
  machine/extraction/compensation/cooldown snapshot. The endpoint is queryless;
  prediction opt-in requests are rejected as malformed.
- `GET /api/v2/history` returns up to eight ascending RAM-retained samples with
  boot/sequence continuity metadata, one strict controller/build configuration,
  and required per-sample controller diagnostics. The prior sixty-sample and
  prediction-enriched page variants are intentionally unsupported.
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
- `GET /api/v2/scale/trace` returns current scale state plus a nullable page
  from the latest RAM-retained weighted-profile extraction.
- `POST /api/v2/scale/calibration/start`, `/complete`, and `/cancel` implement
  the strict two-step calibration workflow.
- `POST /api/v2/scale/warnings/acknowledge` clears the weighted-start gate
  after a timer fallback.
- `GET /api/v2/temperature-calibration` returns uncalibrated, calibrating, or
  calibrated state. A matching active session ID renews its 15-second
  inactivity lease.
- `POST /api/v2/temperature-calibration/start` enters firmware-owned raw-target
  control at `100°C`, or at the saved calibration's implied raw boiling point.
- `PUT /api/v2/temperature-calibration/candidate` acknowledges a whole-degree
  raw target from `90°C` through `120°C` without changing the saved offset.
- `POST /api/v2/temperature-calibration/save` atomically persists
  `temperatureOffsetC = 100 - candidateRawTargetC`; unsafe or failed saves
  retain the prior offset and targets.
- `POST /api/v2/temperature-calibration/cancel` discards the candidate and
  restores ordinary Brew control without changing persisted targets.

All endpoints require the same bearer authentication as API v1. Unknown fields,
invalid slot order/IDs, invalid names or durations, malformed selections, and
invalid idempotency keys are rejected independently by firmware C++.
Extraction Start requires acknowledged Brew mode and idle cooldown. Steam mode
is rejected during extraction or cooldown. Conflict bodies include the active
workflow snapshot when the contract requires it.

Temperature calibration additionally requires a valid sensor, enabled heater
permission, no fault, Brew mode, and no extraction, cooldown, scale
calibration, Steam workflow, or conflicting mutation. The workflow controls
only the raw boiler target. It never commands the pump or steam valve and its
stability duration is advisory rather than a Save gate. The user manually opens
the steam wand and confirms the observed boiling point.

Normal targets stay numerically unchanged. Firmware rejects a calibration Save
or later target mutation if the effective target would require raw temperature
at or above the independent `135°C` raw ceiling; it never clamps. Effective
Steam temperature at `135°C` and raw temperature at `135°C` independently latch
`over_temperature` and command the heater off.

This current fault-at-`135°C` behavior means `135°C` is not a usable target.
TCAL-008 separately tracks the owner-requested inclusive `135°C` Steam target
and requires Human-approved raw/effective fault boundaries above it before the
protocol or runtime limit changes.

History authentication is resolved before query parsing. A request either has
no cursor or has exactly one `bootId` plus one `afterSequence`; unknown,
duplicate, partial, malformed, evicted, and future cursor cases follow the
strict contract. No cursor begins at the oldest retained sample. A matching
cursor is `continuous`, an evicted cursor is `truncated`, and a different boot
ID is `reset`; `initial` identifies the no-cursor start. Each page includes the
current boot ID, capture uptime, available sequence bounds, next durable cursor,
`hasMore`, the selected controller plus compile-time gains/filter/window, and
complete graph command/status/fault/controller context.

Scale-trace cursors require exactly one `extractionId`, `bootId`, and
`afterSequence`. Pages contain at most sixteen ordered 250 ms observation
samples and expose running, settling, or terminal state plus continuity and
sequence bounds. Sequence jumps are real gaps and clients must not synthesize
samples. Firmware without the additive route returns 404; clients retain
current weight and the existing temperature graph without flow or trace
history.

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

Controller diagnostics report raw/filtered temperature, base/private target,
PI error and contributions, PI/legacy requested duty, integral state,
saturation/anti-windup state, selected authority, delivered one-second command
fraction, acknowledged heater/pump commands, extraction phase, and operating
mode. Page configuration reports firmware version, selected controller,
compile-time Kp/Ki/filter alpha, the 500 ms controller interval, and ten-second
SSR window. Heater and pump values remain command-derived and are not physical
feedback. The mobile app stores these diagnostics only on recovered firmware
history rows; foreground-only rows keep them nullable. CSV exports use the new
controller columns and contain no prediction/model fields. Retained history is
used to recover detected gaps, not as control-loop feedback.

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
