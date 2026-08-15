# Philcoino protocol

`openapi.yaml` is the authoritative HTTPS API v4 contract shared by the mobile
app and deterministic simulator and independently implemented by firmware C++.
API v1-v3 compatibility routes are intentionally absent.

## API v4 highlights

- SRP pairing with v4 binding domains and pinned HTTPS.
- Complete `MachineStateV4` acknowledgements for state and mutations.
- Nullable `boilerTemperatureC` and `steamTemperatureC`.
- `temperatureCalibrations.boiler` and `.steam` with sensor-qualified routes.
- Sensor-attributed temperature fault details.
- Direct `steamReadyTimeoutMs`; no Steam compensation/decay fields.
- Extraction telemetry page format 2 with both nullable temperatures.
- Strict objects: unknown request or response properties are rejected.

Changing the protocol requires coordinated updates to OpenAPI, Zod/types,
fixtures, simulator, mobile, independent C++ codecs/routes/captures, and docs.

## Verify

```bash
bun run validate:openapi
bun run test:protocol
bun run typecheck:protocol
```

Firmware capture validation is separate:

```bash
/tmp/philcoino-host-tests/firmware_api_test /tmp/philcoino-contract-v4
bun run ./firmware/espresso-machine/host-tests/validate_contract.ts \
  /tmp/philcoino-contract-v4
```

See [API v4](../../docs/protocol/api-v4.md) and
[Architecture](../../docs/ARCHITECTURE.md).
