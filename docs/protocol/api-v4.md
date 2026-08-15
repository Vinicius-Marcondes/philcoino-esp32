# HTTPS API v4

Status: IMPLEMENTED; sole supported wire generation

`packages/protocol/openapi.yaml` is authoritative. API v4 replaces v3 without a
compatibility server. Pairing domains, discovery identity, fixtures, and
`apiVersion: "4"` move together, so the ESP32-S3 requires a rebuilt app and
fresh pairing.

## State

`MachineStateV4` is one complete acknowledgement containing device/boot/revision
identity, machine state, scale, Boiler/Steam calibration, extraction,
compensation/cooldown workflow state, and captured uptime.

The machine block exposes nullable `boilerTemperatureC` and
`steamTemperatureC`. The active mode chooses its sensor (Brew=Boiler,
Steam=Steam); null remains null and is never filled from the other sensor.
Temperature-related fault detail includes `sensor: boiler|steam|null`.

Steam settings expose only `steamReadyTimeoutMs` plus runtime remaining time.
Legacy heat-soak initial/decay fields do not exist.

## Calibration

Sensor-qualified resource:

```text
/api/v4/temperature-calibrations/{boiler|steam}/current
```

POST starts, PATCH acknowledges a raw candidate, PUT saves, DELETE cancels, and
`/lease` renews the bounded session. IDs, replay/conflict, acknowledgement, and
cancellation remain strict. Firmware allows only one global session.

## Extraction telemetry

Telemetry page `formatVersion: 2` adds nullable `steamTemperatureC` alongside
nullable Boiler temperature. Sequence/cursor/gap semantics are unchanged; no
consumer may synthesize a missing sensor value.

## Security and parsing

SRP establishes v4 certificate/client bindings. Authenticated traffic is HTTPS
with certificate pinning. Unknown properties, malformed values, wrong
apiVersion, stale identity, and route drift are rejected. Simulator-only routes
under `/_simulator` are outside this contract and absent from firmware.

## Verification

OpenAPI validation, protocol tests/typecheck, simulator/mobile tests/typecheck,
native C++ tests, and independent firmware response captures must all pass.
These checks establish wire agreement only, not physical sensor/output safety.
