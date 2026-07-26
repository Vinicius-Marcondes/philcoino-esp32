# PERF-005 HX711 notification evidence

Date: 2026-07-26

## Behavior

The scale task now performs one immediate task-context read, then blocks on an
HX711 data-ready falling-edge notification or the existing 750 ms unavailable
timeout. A wake always leads to exactly one task-context HX711 read.

The GPIO ISR contains only a FreeRTOS task notification and conditional yield.
GPIO clocking, the 24-bit read and gain pulse, filtering, diagnostics, logging,
workflow-mutex acquisition, and controller publication remain in task context.
`kNotReady` publication remains unchanged because PERF-006 owns that separate
optimization.

Ready-before-wait notifications remain pending, and `ulTaskNotifyTake(pdTRUE,
...)` coalesces multiple notifications into one wake. If DOUT stays high, each
wait is bounded to 750 ms and the task reads `kNotReady`; sample-age policy
therefore preserves the existing 750 ms unavailable boundary. A later falling
edge resumes sampling without a task restart.

## Before/after scheduler bounds

| Condition | Before | After |
| --- | ---: | ---: |
| Normal scale-task wake source | Fixed 10 ms delay | HX711 DOUT falling edge |
| Fixed wake/read attempts | Up to 100/s | 0/s; reads follow actual notifications |
| Disconnected/high DOUT wake/read attempts | Up to 100/s | One per 750 ms timeout, about 1.33/s |
| Missing-sample unavailable timeout | 750 ms | 750 ms |
| Work performed in ISR | None | One task notification plus optional yield |

Actual HX711 cadence and edge-to-task latency were not measured without the
connected target.

## Cache-safety boundary

The GPIO ISR service is requested with `ESP_INTR_FLAG_IRAM`, the pin callback is
`IRAM_ATTR`, callback-owned state has static lifetime, and
`CONFIG_FREERTOS_IN_IRAM=y` is required both in `sdkconfig.defaults` and by a
compile-time guard. ESP-IDF 6.0 moved most FreeRTOS functions to flash by
default; this option restores the notification path to IRAM.

The source/configuration boundary is implemented, but cache independence is not
claimed as target-validated until a pinned target build confirms linked
placement and a connected low-voltage run exercises notifications during
flash/NVS cache suspension.

## Compatibility and safety

- No API route, OpenAPI schema, public response, authentication, profile,
  history, prediction, timeout, priority, heater lease, pump, fault, or fail-off
  behavior changed.
- No ISR allocation, logging, GPIO clocking, filtering, controller work, or
  broad interrupt-disabled region was introduced.
- NVS/flash operations remain outside the acquisition ISR.
- No energized or physical-safety validation is inferred.

## Verification

- PASS — focused native event-policy regression: initial read, ready-before-
  wait, notification coalescing, repeated timeout, recovery, transport error,
  and saturation.
- PASS — focused ASan/UBSan event-policy regression.
- PASS — complete native firmware host suite: 7/7.
- PASS — complete ASan/UBSan firmware host suite: 7/7.
- PASS — 32 generated firmware response captures validated.
- NOT RUN — ESP-IDF 6.0.2 target build and image/IRAM/DRAM delta; `idf.py` is
  absent and `IDF_PATH` is unset.
- PENDING — target map placement, GPIO ISR registration, notifications during
  flash/NVS cache suspension, ISR/scale-task stack evidence, watchdog/reset
  evidence, actual disconnect/recovery timing, and low-voltage connected-target
  behavior.
- DEFERRED TO PERF-009 — logic-analyzer edge-to-task latency and GPIO1 pulse
  timing.
