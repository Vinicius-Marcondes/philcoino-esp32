# Firmware 0.3.2 API performance investigation

Status: instrumentation and deterministic regression coverage implemented;
physical ESP32-C3 workload measurements pending.

Scope: commit `fa6d67e`, firmware `0.3.2`, mobile prediction polling and history
recovery. Testing is low-voltage/network-only. This work does not authorize an
energized heater.

## Executive conclusion

The flashed image size is not the overload mechanism. The flashed binary is
1,147,024 bytes and retains 425,840 bytes (27%) of its application partition.
That says nothing about runtime heap, stack, CPU, sockets, or blocking send
latency.

Static review confirms two mechanisms capable of producing the reported
symptoms:

1. The single ESP-IDF HTTP server task serializes dynamically allocated JSON
   and performs a blocking one-shot response send. An approximately 8 KiB
   enriched history page therefore delays every other normal URI handler while
   it is serialized and sent.
2. Mobile history recovery can issue up to 75 eight-sample requests and runs
   independently of one-second live prediction polling. Each page has only a
   zero-delay yield, one HTTP failure is retried immediately, and the UI reloads
   the current day's stored history after every committed page. A slow live
   response can cross the 2.5-second gap threshold and initiate more recovery.

These are confirmed request-amplification and serialization/starvation
mechanisms, not yet a measurement-confirmed hardware root cause. Prediction CPU
cost, heap fragmentation, socket accumulation, Wi-Fi instability, and stack
exhaustion remain hypotheses until the instrumented target matrix is run.

## Severity-ranked findings

### P1 — Backfill and live polling are independently concurrent

The dashboard poll is completion-driven and does not overlap itself, but the
history synchronization session has separate cancellation and scheduling
ownership. A full 600-sample buffer requires up to 75 pages. Between pages it
uses `setTimeout(0)`, and an HTTP error is retried once without backoff.

Impact: history recovery can continuously occupy the firmware HTTP task while
live state waits. If live delivery exceeds 2.5 seconds, client gap detection can
trigger another recovery cycle and amplify the load.

Evidence:

- Firmware history capacity/page size: 600/8.
- Mobile live interval: 1,000 ms.
- Mobile gap threshold: 2,500 ms.
- The mobile contention regression proves live state, history, mutation, and a
  third client can all reach the transport concurrently.

Recommended production remediation:

1. Add one device-scoped request coordinator in mobile.
2. Give live state priority over backfill.
3. Add a non-zero inter-page delay and exponential retry backoff with jitter.
4. Refresh the UI from committed pages in batches instead of reloading the
   current day after every page.

### P1 — Large responses monopolize the only normal HTTP handler task

Firmware builds state and history bodies through `std::ostringstream`,
temporary `std::string` values, and concatenation, then passes the complete body
to `httpd_resp_send`. ESP-IDF normal URI handlers execute in the HTTP server
task, so serialization and a blocked socket send are request-starvation points.

Impact: a slow client receiving an enriched history response can make Postman
and app requests appear to hang even if control remains active.

Recommended production remediation:

1. Replace stream-based JSON generation with bounded, pre-sized serialization.
2. Send history incrementally with `httpd_resp_send_chunk` so peak heap is
   bounded; retain strict error cleanup and terminate the chunked response.
3. Consider a smaller diagnostic-history page when prediction is included, or
   make page size response-byte bounded.
4. Keep controller snapshot copying under the mutex and all serialization/send
   work outside it.

Reference: [ESP-IDF 6.0.2 HTTP server](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32c3/api-reference/protocols/esp_http_server.html).

### P2 — Socket policy can turn slow clients into admission failures

The server inherits the ESP-IDF default open-socket limit and does not enable
least-recently-used session purge. Receive and send waits are bounded, but
several app/Postman connections can consume the available sessions before
cleanup is visible to the caller.

Impact: new requests may fail or wait while stale/slow sessions occupy the
server.

Recommended production remediation: decide an explicit, measured
`max_open_sockets` and LRU policy after the target run. Do not increase the
socket count without measuring per-session heap.

### P2 — Prediction executes under the shared workflow mutex

The passive predictor updates in the temperature controller while the API and
workflow controller share the same bounded mutex. Its history scans are fixed
capacity and its output does not command the heater in 0.3.2. Static inspection
does not show unbounded work, but its duration can only be ranked after target
measurement.

Impact: if predictor or full controller duration becomes material, API
synchronization waits increase and a 50 ms miss deliberately requests fail-off.

Decision: compare the normal diagnostic build with the no-prediction diagnostic
profile. The latter invalidates the model checksum, preserving the response
shape and existing disabled/model-invalid state. It does not alter heater
behavior because prediction is passive.

### P2 — Per-page persistence drives avoidable mobile CPU/UI work

After every recovered page, the hook reloads the current day's history from
SQLite and updates React state. This does not directly consume ESP32 CPU, but it
extends recovery time, increases foreground work, and can keep the request
producer active longer.

Recommended production remediation: batch persistence notifications and chart
updates while keeping the durable cursor commit per page.

## Instrumentation delivered

`CONFIG_PHILCOINO_PERFORMANCE_DIAGNOSTICS` is default-off and changes no HTTP
response. It emits aggregate serial records every ten seconds:

- per-route count, response bytes, API/serialization duration, blocking send
  duration/result, total request duration, non-2xx count, and maximum observed
  open sessions;
- request-local free/minimum heap, largest free block, allocation failures, and
  HTTP task stack high-water;
- prediction and full controller duration, controller interval/jitter,
  prediction timing-invalid events, and missed one-second deadlines;
- mutex wait/hold duration and 50 ms acquisition failures;
- main/workflow task stack margins, reset reason, current Wi-Fi RSSI, disconnect
  count/reason/RSSI, and global heap trends.

`CONFIG_PHILCOINO_PERFORMANCE_DISABLE_PREDICTION` enables the A/B profile. Both
options are represented by checked-in, secret-free defaults files. Neither is
enabled by the normal `sdkconfig.defaults`.

## Build baseline

| Build | Binary | DRAM used | BSS | Data | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| Flashed `fa6d67e` log | 1,147,024 B | not captured | not captured | not captured | 27% partition free |
| Investigation, diagnostics off | 1,148,960 B | 152,564 B | 66,312 B | 13,632 B | target build passed |
| Investigation, diagnostics on | 1,155,504 B | 154,846 B | 68,432 B | 13,728 B | target build passed |

Diagnostics add 6,544 binary bytes and 2,282 statically used DRAM relative to
the investigation's off build. The enabled image retains 417,360 bytes (27%) of
the application partition.

## Target test matrix

Use the same ESP32-C3, stable 5 V supply, Wi-Fi location, and configuration for
all runs. Keep mains/heater power disconnected.

1. Idle for ten minutes with no HTTP clients.
2. Queryless state for ten minutes.
3. Prediction state for ten minutes.
4. Recover one complete 600-sample buffer.
5. Run combined load for two, five, and ten minutes.
6. Repeat combined load while Postman requests health and both state variants.
7. Exercise app background/foreground, force-close/reopen, cancellation,
   timeout, and Wi-Fi reconnect.
8. Repeat combined load for at least 30 minutes.
9. Repeat steps 4–8 with prediction disabled through the A/B profile.

For each stage retain the harness JSON and serial log. Compare p50/p95/p99/max,
request/byte rate, timeouts, sends, sessions, heap/largest-block trends, stack
margins, controller/prediction timing, mutex failures, resets, and Wi-Fi events.

## Build and run

```sh
cd firmware/espresso-machine
source /Users/vinicius/.espressif/v6.0.2/esp-idf/v6.0.2/esp-idf/export.sh

idf.py -B /tmp/philcoino-perf \
  -D SDKCONFIG=/tmp/philcoino-perf.sdkconfig \
  -D 'SDKCONFIG_DEFAULTS=sdkconfig.defaults;sdkconfig.performance.defaults' \
  build size

idf.py -B /tmp/philcoino-perf-no-prediction \
  -D SDKCONFIG=/tmp/philcoino-perf-no-prediction.sdkconfig \
  -D 'SDKCONFIG_DEFAULTS=sdkconfig.defaults;sdkconfig.performance-no-prediction.defaults' \
  build size
```

Flash only after copying the device's ignored Wi-Fi/token configuration into
the selected temporary SDK configuration through the normal ESP-IDF
configuration workflow. Never add secrets to defaults or logs.

Run load from the repository root:

```sh
PHILCOINO_DEVICE_ADDRESS=http://device-origin \
PHILCOINO_BEARER_TOKEN=replace-with-device-token \
bun run load:device combined
```

## Acceptance

The investigation passes only when the hardware evidence shows:

- no hung request, reset, unexplained Wi-Fi loss, send failure, or controller
  synchronization failure;
- HTTP task unused stack at least 1,536 bytes;
- controller sampling within 250–1,000 ms and mutex acquisition within 50 ms;
- live state never crosses the 2.5-second gap threshold during recovery;
- repeated backfills do not produce a declining free-heap or largest-block
  trend.

These gates remain open until hardware logs are attached. Simulator and host
tests are not heater-safety evidence.
