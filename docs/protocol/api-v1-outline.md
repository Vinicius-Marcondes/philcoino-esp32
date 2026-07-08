# ESP32 API v1 outline

Status: IMPLEMENTED

The definitive machine-readable contract is
[`packages/protocol/openapi.yaml`](../../packages/protocol/openapi.yaml). The
examples below mirror tested fixtures in that package.

## Transport and authentication

- Local Wi-Fi only.
- HTTP on port 80.
- Bearer token entered by the user after selecting a discovered device.
- `/healthz` and device identity are public.
- All machine state and mutation endpoints require `Authorization: Bearer <token>`.
- The accepted v1 threat model allows the token and traffic to travel without encryption on the local network.

Authentication is verified by calling an authenticated endpoint; v1 does not require a separate login or server-side session.

## Discovery

The ESP32 advertises `_philcoino._tcp.local` through mDNS with:

- stable device ID;
- friendly device name;
- API major version;
- firmware version;
- model;
- HTTP port.

The app remembers the stable device ID, resolved address, and token. It tries the cached address first and rediscovers the device ID when that address stops responding. Manual IP entry is the fallback.

## Proposed endpoints

### Public

- `GET /healthz`: minimal process and networking health.
- `GET /api/v1/device`: stable identity, name, model, API version, and firmware version.

### Authenticated

- `GET /api/v1/state`: complete machine snapshot, polled once per second while the main screen is active.
- `PATCH /api/v1/settings/temperatures`: update one or both temperature targets.
- `PUT /api/v1/mode`: set the active temperature-control mode to `brew` or `steam`.
- `POST /api/v1/faults/over-temperature/dismiss`: dismiss a latched over-temperature fault only after the active control temperature has returned to its target.

V1 has no remote power, pump, water-flow, or heater action endpoints. Brewing is activated physically on the machine. The app monitors the machine, changes temperature targets, and selects whether the firmware regulates toward the brew or steam target.

## Machine state

The status enum is:

- `heating`
- `ready`
- `fault`

The ESP32 is powered by the espresso machine. When the machine is off, the ESP32 is also off and cannot report an `off` status. The mobile app represents that condition as its own `offline` connection state after requests and rediscovery fail; `offline` is not an API status.

The ESP32 cannot observe the machine's physical brew and steam switches, so the API does not report `brewing` or `steaming`.

A state payload contains both monitored thermocouple temperatures:

```json
{
  "status": "heating",
  "activeMode": "brew",
  "brewTemperatureC": 87.4,
  "steamTemperatureC": 103.8,
  "brewTargetC": 93,
  "steamTargetC": 115,
  "heaterActive": true,
  "fault": null,
  "steamTimeoutRemainingMs": null,
  "uptimeMs": 184220
}
```

`brewTemperatureC` is the base/brew control-sensor reading and
`steamTemperatureC` is the top/steam control-sensor reading. `activeMode` is
`brew` or `steam`. `uptimeMs` is monotonic device uptime and does not require
internet time synchronization. `fault` is `null` while status is `heating` or
`ready`, and contains a stable code and message while status is `fault`.

## Mode selection

- The app presents a brew/steam mode switch.
- `PUT /api/v1/mode` uses an idempotent payload such as `{ "mode": "steam" }`.
- The app changes its displayed mode only after the ESP32 acknowledges the command and returns the resulting mode as `{ "mode": "steam" }`.
- The ESP32 always starts in `brew` mode after boot; active mode is not restored from NVS.
- The temperature targets remain persisted independently from active mode.
- In steam mode, the firmware starts a five-minute countdown the first time temperature qualifies as `ready` for the active steam target.
- When that countdown expires, the firmware automatically returns to brew mode. A later temperature dip does not reset or pause the countdown.
- `steamTimeoutRemainingMs` is `null` outside steam mode and before steam temperature first becomes ready; otherwise it reports the remaining countdown.
- The firmware owns safe transition behavior and must not depend on the app remaining connected.

## Readiness

The machine reports `ready` only after the measured control temperature remains within ±1°C of the active target for three continuous seconds. It returns to `heating` when the control algorithm's defined readiness band is no longer satisfied.

## Temperature constraints

- Brew target: 85°C through 95°C inclusive.
- Steam target: 110°C through 120°C inclusive.
- V1 target values use whole degrees Celsius.
- Firmware rejects out-of-range, non-finite, or malformed values.
- The app sends changes only after an explicit user confirmation.
- A temperature update is not successful until the firmware validates and persists it in ESP32 NVS.
- A successful update returns both persisted targets, including the unchanged target when only one was requested.

## Errors

All non-success responses should use one stable shape:

```json
{
  "error": {
    "code": "temperature_out_of_range",
    "message": "Brew target must be between 85 and 95 degrees Celsius."
  }
}
```

The stable API error codes are `malformed_request`, `unauthorized`,
`temperature_out_of_range`, `sensor_unavailable`, `persistence_failure`, and
`internal_error`.

Initial machine fault codes are:

- `sensor_failure`
- `over_temperature`
- `heating_timeout`
- `internal_error`

Faults remain latched until the espresso machine is power-cycled, except `over_temperature`, which may be dismissed through API v1 only after the active control temperature has returned to its target. Entering any fault state de-energizes the heater output immediately, and the ESP32 rejects over-temperature dismissal while the active temperature is still above target or when any other fault is latched.

## Safety boundary

The ESP32 owns temperature sampling, control loops, heater shutdown, target validation, fault detection, and safe behavior after network loss. The phone is a monitoring and command interface, never part of the real-time control loop.
