# PERF-012 — Final regression and comparison evidence

Date: 2026-07-26

Final production source/config identity: commit `8f42f83` on
`feature/esp32c3-firmware-performance`. The normal build keeps performance
diagnostics disabled. Tools were Bun 1.3.14, CMake 4.3.4, and Apple clang
21.0.0.

## Available software matrix

| Area | Checks | Result |
| --- | --- | --- |
| Protocol | OpenAPI validation, TypeScript typecheck, Bun tests | PASS — 135 tests |
| Simulator | TypeScript typecheck, Bun tests | PASS — 72 tests |
| Mobile | TypeScript typecheck, Expo lint, Bun tests | PASS — 173 tests |
| Firmware host | strict native build and CTest | PASS — 7/7 |
| Firmware sanitizer | ASan/UBSan build and CTest | PASS — 7/7 |
| Firmware contract | generated capture validation | PASS — 32 captures |

These checks cover strict API parsing and unchanged schemas, simulator
workflows, acknowledged mobile state, profiles, ten-minute history, scale and
weighted extraction, passive prediction, heater/pump command policies,
timeouts, faults, and host-observable fail-off behavior. They do not establish
target scheduling, GPIO timing, thermal response, or physical de-energization.

## Host-only before/after aids

The following compares the unchanged PERF-001 host build with the final host
build. Native executable sizes are not ESP32 flash/image measurements and are
not used as target acceptance evidence.

| Executable | PERF-001 bytes | Final bytes | Delta |
| --- | ---: | ---: | ---: |
| `firmware_config_test` | 37,192 | 42,968 | +5,776 |
| `peripherals_test` | 249,248 | 221,520 | -27,728 |
| `control_test` | 295,280 | 290,336 | -4,944 |
| `prediction_test` | 57,008 | 57,008 | 0 |
| `firmware_api_test` | 428,592 | 426,032 | -2,560 |
| `api_codec_test` | 280,464 | 277,024 | -3,440 |
| `api_codec_mutation_test` | 293,560 | 289,064 | -4,496 |

The unchanged mobile baseline had 167 tests and 1,115 expectations. The final
suite has 173 tests and 1,136 expectations, including PERF-002 cadence
regressions; both typecheck and lint still pass.

## Target and connected comparison

The pinned ESP-IDF 6.0.2 toolchain remains unavailable: `idf.py` is absent from
`PATH` and `IDF_PATH` is unset. No ESP32-C3 or logic analyzer is connected.
Consequently, the PERF-001 scenarios could not be repeated and the following
before/after values remain pending rather than being reported as zero or
unchanged:

- target image/partition and `.text`/`.rodata`/`.data`/`.bss` deltas;
- map/IRAM/cache-safe placement and effective sdkconfig;
- CPU/load and loop-period distributions;
- workflow-mutex wait/hold/acquisition/timeout distributions;
- free/minimum/largest heap and task/HTTP stack high-water;
- per-route API/history latency and request heap change;
- reset/watchdog and Wi-Fi/mDNS recovery observations;
- HX711 GPIO0 ready and GPIO1 clock timing;
- GPIO20 lease-low capture at or before 1,500 ms.

Run the exact scenario/configuration matrix in `PERF-001-BASELINE.md` on the
pinned toolchain and a disconnected low-voltage setup before Human acceptance.
No energized mains testing or physical-safety validation was performed,
authorized, or inferred.

## Conclusion

All available software evidence passes. PERF-012 is software-complete, while
target-build, connected-target, logic-analyzer, and Human comparison gates
remain pending.
