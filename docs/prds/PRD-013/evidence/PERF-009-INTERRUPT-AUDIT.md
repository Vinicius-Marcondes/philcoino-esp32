# PERF-009 interrupt safety and GPIO timing audit

Date: 2026-07-26

## Source call-graph audit

### HX711 data-ready path

`GPIO IRAM dispatcher`
→ `EspHx711ReadyWaiter::on_ready` (`IRAM_ATTR`)
→ `vTaskNotifyGiveFromISR`
→ conditional `portYIELD_FROM_ISR`

The application callback reads its static waiter/task-handle state, posts one
coalescing task notification, and optionally yields. It contains no allocation,
logging, GPIO clocking, filtering, NVS/flash access, controller call, workflow
mutex, or custom critical section.

### Heater safety-lease path

`GPTimer cache-safe dispatcher`
→ `EspGptimerSafetyLease::on_alarm` (`IRAM_ATTR`)
→ `EspGptimerSafetyLease::fail_off_from_isr` (`IRAM_ATTR`)
→ `gpio_set_level(GPIO20, off)`
→ short `portENTER_CRITICAL_ISR`/`portEXIT_CRITICAL_ISR` around `tripped_ = true`

The GPIO-low command precedes the short state-update critical section. The ISR
contains no allocation, logging, controller call, NVS/flash access, response
work, or broad interrupt-disabled region.

## Versioned configuration audit

Version-controlled defaults and compile guards require:

- `CONFIG_GPTIMER_ISR_CACHE_SAFE=y`;
- `CONFIG_GPIO_CTRL_FUNC_IN_IRAM=y`;
- `CONFIG_FREERTOS_IN_IRAM=y`;
- explicit `IRAM_ATTR` on both application callback chains.

ESP-IDF 6.0.2 removed the `vTaskDelayUntil` compatibility function. The
source-audit gap found in the 10 ms workflow task was corrected to the
version-compatible `xTaskDelayUntil` spelling without changing its retained
deadline, period, priority, or control policy.

These source/configuration results do not prove final linked section placement.

## Verification completed

- PASS — both application ISR call graphs contain only the bounded operations
  listed above.
- PASS — no ISR allocation, logging, NVS, filtering, JSON, controller work, or
  broad interrupt-disabled region found.
- PASS — compile-time guards reject target configurations that omit the three
  required cache-safety options.
- PASS — complete native firmware host suite: 7/7.
- PASS — complete ASan/UBSan firmware host suite: 7/7.
- PASS — 32 firmware response captures validated against the unchanged
  contract.

## Target and Human gates still pending

The pinned ESP-IDF toolchain is unavailable (`idf.py` absent and `IDF_PATH`
unset), and no connected target or logic analyzer is available. Therefore none
of the following is claimed:

- linked IRAM/DRAM placement from the target map;
- notifier or heater-lease behavior while flash/NVS suspends cache;
- GPIO0 falling-edge-to-task latency;
- GPIO1 24-bit plus gain-pulse width/cadence;
- GPIO20 low at or before 1,500 ms under flash/API load;
- ISR and task stack margins, watchdog/reset behavior, or target jitter;
- disconnected low-voltage Human logic-analyzer acceptance.

Required Human procedure:

1. Build with pinned ESP-IDF 6.0.2 and retain the image/map/size reports.
2. Confirm both callbacks, notification callees, GPIO control path, callback
   state, and GPTimer path are in cache-safe memory.
3. On a disconnected low-voltage setup, capture GPIO0/GPIO1 HX711 ready/clock
   behavior and GPIO20 lease-low timing under API plus flash/NVS load.
4. Confirm GPIO20 reaches the configured off level no later than 1,500 ms in
   the tested build.
5. Record analyzer files, target logs, reset causes, stack/watchdog evidence,
   and separate Human acceptance.

No energized mains testing or physical-safety certification is authorized or
inferred.
