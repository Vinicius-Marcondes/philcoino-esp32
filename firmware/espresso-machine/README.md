# PhilcoINO ESP32-S3 firmware

ESP-IDF C++ firmware for ESP32-S3-WROOM-1 N16R8. Firmware owns both
temperature sensors, persisted targets and per-sensor calibration, Brew/Steam
control, extraction/cooldown/OTA workflows, and the fail-off heater and pump
command boundaries. The only wire generation is HTTPS API v4.

> [!CAUTION]
> This prototype is not approved for unattended or energized mains operation.
> Keep heater and pump loads disconnected for development and read
> [Safety](../../docs/en/SAFETY.md) and the
> [S3 wiring record](../../docs/hardware/esp32-s3-n16r8-wiring.md).

## Target and dependencies

- ESP-IDF `6.0.2`, target `esp32s3` only.
- ESP32-S3-WROOM-1 N16R8: 16 MB QIO/80 MHz flash, no PSRAM.
- Native USB Serial/JTAG on reserved GPIO19/GPIO20.
- 8 KB `app_main` stack for dual-sensor startup and TLS identity initialization.
- `espressif/mdns` `1.11.3`.
- `rbdimmer/rbdimmerESP32` manifest version `2.0.1`, resolved from immutable
  commit `ab50d09f924e3d5ecf8590ab71386caa72a8e282` in `dependencies.lock`.
- Firmware version `0.5.0`.

Downloaded components, generated `sdkconfig`, and build output are ignored and
must not be committed. From this directory, with the pinned toolchain active:

```bash
idf.py set-target esp32s3
idf.py build
```

Set Wi-Fi and pairing configuration only through `idf.py menuconfig`. Never put
secrets in source, defaults, tests, logs, screenshots, or documentation.
Temporary HX711 diagnosis can enable `PHILCOINO_RAW_SCALE_LOGGING` through the
same menu. It reports valid raw samples at no more than 4 Hz, immediate ADC or
transport failures, and only sustained data-ready outages; keep it disabled
during normal operation.

## Fixed GPIO map

| Peripheral | Signals |
| --- | --- |
| Boiler MAX6675 | SCK GPIO4, SO GPIO5, CS GPIO7 |
| Steam MAX6675 | shared SCK GPIO4, SO GPIO8, CS GPIO9 |
| RobotDyn pump dimmer | ZC GPIO6, DIM/PSM GPIO10 |
| HX711 | DT GPIO11, SCK GPIO12 |
| Heater SSR | active-high command GPIO21 |
| Native USB Serial/JTAG | GPIO19/GPIO20, reserved |

GPIO0/3/45/46, GPIO26–37, GPIO39–42, GPIO43/44, and GPIO48 are reserved. See
the wiring document for the complete rationale and deferred checks.

## Temperature ownership

The two MAX6675 channels share one software-clocked bus and critical-section
lock. Both CS pins initialize high, SCK initializes low, and the channels are
read sequentially every 500 ms. Each channel independently rejects transport,
open-circuit, reserved-bit, non-finite, `0x0000`, and greater-than-10°C downward
jumps. Exactly 10°C is accepted; rejected readings do not replace that sensor's
last accepted baseline.

Brew uses only the calibrated Boiler sensor. Steam uses only the calibrated
Steam sensor; values are never blended and there is no fallback. An invalid
active sample commands heater OFF immediately and three consecutive failures
latch `sensor_failure`. An invalid inactive sensor stays observable and blocks
entry into its mode without interrupting a healthy active mode. Raw temperature
strictly above 135°C from either probe latches sensor-attributed
`over_temperature` immediately.

Each sensor owns a separate NVS calibration record and the same guided raw
90–120°C boiling-point workflow. Only one calibration session may exist. The
selected raw sensor becomes the temporary control input while the other probe
continues validation and over-temperature protection. Steam heat-soak
compensation was removed; Steam controls directly against `steamTargetC` and
retains only the persisted 1–15 minute ready timeout. Legacy Steam storage is
migrated by retaining the timeout and discarding compensation/decay fields.

## Outputs and scheduling

`FailOffSsr` remains the heater authority and `FailOffPump` remains the pump
authority. Pump startup preloads DIM GPIO10 low, initializes the upstream
dimmer at phase 0/fixed 60 Hz/LINEAR/0%, and reapplies 0 before controller
construction. Existing running commands map to the single centralized 90% cap;
OFF maps to 0%. Levels are commands, not delivered voltage, power, pressure,
flow, or closed-loop pressure control. The upstream default suppresses TRIAC
firing below 3%, although abstract commands 1–2 remain reportable internally.

Temperature acquisition, heater control, workflow, and scale tasks are pinned
to CPU1. Wi-Fi, TCP/IP, HTTPS, mDNS, pairing, telemetry, and OTA networking run
on CPU0. Hardware/bus initialization failure attempts heater and pump OFF and
aborts startup.

## Host verification

From the repository root:

```bash
cmake -S firmware/espresso-machine/host-tests -B /tmp/philcoino-host-tests
cmake --build /tmp/philcoino-host-tests
ctest --test-dir /tmp/philcoino-host-tests --output-on-failure
/tmp/philcoino-host-tests/firmware_api_test /tmp/philcoino-contract-v4
bun run ./firmware/espresso-machine/host-tests/validate_contract.ts \
  /tmp/philcoino-contract-v4
```

Sanitizer build:

```bash
cmake -S firmware/espresso-machine/host-tests \
  -B /tmp/philcoino-host-tests-sanitized \
  -DPHILCOINO_ENABLE_SANITIZERS=ON
cmake --build /tmp/philcoino-host-tests-sanitized
ctest --test-dir /tmp/philcoino-host-tests-sanitized --output-on-failure
```

Host tests cover dual-probe validation, independent baselines/calibration,
active/inactive failure policy, switching, no fallback, both-probe thermal
faults, output failure/race behavior, extraction/cooldown/OTA policies, and API
v4 captures. They do not test ESP-IDF scheduling, GPIO waveforms, electrical
probe isolation, TRIAC/SSR behavior, pressure, thermal response, or mains safety.

## Deferred physical verification

Do not flash a control-capable build until the exact 44-pin board is confirmed
to expose every selected GPIO and both probes are confirmed electrically
ungrounded. With heater and pump loads disconnected, supervised checks still
must verify dual-probe stability and boiler isolation, boot/reset pulse absence,
native USB recovery, CS/SCK/SO waveforms, ZC detection, dimmer 0% cessation,
and 90% phase timing. Prior ESP32-C3, one-probe, pump-SSR, and RobotDyn evidence
does not validate this S3 wiring or Steam sensor placement.
