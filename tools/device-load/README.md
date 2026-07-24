# ESP32 API load harness

This dependency-free Bun harness measures the API contention patterns produced
by the mobile client. It does not validate heater safety and must only be used
with the machine de-energized from mains.

Set the address and token in the shell; the token is sent as a bearer credential
but is never included in the report:

```sh
export PHILCOINO_DEVICE_ADDRESS=http://philcoino-xxxxxxxx.local
export PHILCOINO_BEARER_TOKEN=replace-with-device-token

bun run load:device state
bun run load:device prediction
bun run load:device history
bun run load:device combined
```

The default combined run lasts two minutes and concurrently performs
completion-driven prediction polling, a complete history crawl, and health
requests from an independent client. Mutations are disabled by default. To
include only the safety-reducing heater-off mutation:

```sh
PHILCOINO_LOAD_MUTATIONS=heater-off bun run load:device combined
```

Optional environment variables:

- `PHILCOINO_LOAD_DURATION_MS` (default `120000`)
- `PHILCOINO_LOAD_INTERVAL_MS` (default `1000`)
- `PHILCOINO_LOAD_TIMEOUT_MS` (default `5000`)
- `PHILCOINO_LOAD_MAX_HISTORY_PAGES` (default `100`)

The JSON report contains per-client and total request counts, response bytes,
HTTP/network/timeout counts, and p50/p95/p99/max latency.
