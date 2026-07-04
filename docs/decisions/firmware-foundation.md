# Firmware foundation decisions

Status: HUMAN-APPROVED 2026-07-04

These decisions establish PHIL-004. They do not approve energized heater tests or
implement peripheral and control behavior.

## Platform and dependencies

- ESP-IDF is pinned to `v6.0.2` for target `esp32c3`.
- Managed component `espressif/mdns` is pinned to `1.11.3`.
- Firmware is an independent CMake project under `firmware/espresso-machine`.
- Pure C++ configuration and domain code remains independent from ESP-IDF so it
  can be compiled by host tests.

## Identity

- Friendly name: `PhilcoINO`.
- Model: `ESP32-C3 Super Mini`.
- Stable device ID: `philcoino-` plus the uppercase final three bytes of the
  factory Wi-Fi station MAC address, for example `philcoino-0102AF`.
- Later discovery code will advertise that ID through mDNS and return the same ID
  from the public device endpoint.

## Approved constants

| Decision | Value |
| --- | --- |
| Brew target range | 85–95°C |
| Steam target range | 110–120°C |
| Brew over-temperature threshold | 98°C |
| Steam over-temperature threshold | 130°C |
| Heating timeout | 10 minutes from first heater demand without reaching readiness |
| Sensor disagreement | More than 10°C continuously for 5 minutes |
| Readiness | Within ±1°C continuously for 3 seconds |
| Steam timeout | Return to brew 5 minutes after steam first becomes ready |

## Display and GPIO

| Function | Configuration |
| --- | --- |
| SSD1306 OLED | 128×32, I2C address `0x3C`, no dedicated reset configured |
| OLED SDA / SCL | GPIO8 / GPIO9; module-provided pull-ups retained |
| MAX6675 shared SCK / SO | GPIO4 / GPIO6 |
| Brew / steam MAX6675 CS | GPIO5 / GPIO10 |
| SSR command | GPIO20, active high, direct 3.3 V connection |

The human owner explicitly approved direct GPIO20 drive with no external pull-down
resistor available. Firmware must configure the output low at the earliest possible
boot stage, but software cannot guarantee a low level while the pin is uncontrolled
during reset or before GPIO initialization. This residual risk is tracked in
`docs/side-notes.md` and must be checked before energized testing.

## Secrets and logging

- Wi-Fi credentials and the bearer token live only in ignored local `sdkconfig`.
- Defaults, source, logs, and documentation contain no secret values.
- Logs may report whether configuration is missing but never print credentials or
  bearer tokens.
