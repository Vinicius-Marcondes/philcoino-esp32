# ESP32-S3-WROOM-1 N16R8 wiring

Status: SOFTWARE CONFIGURATION IMPLEMENTED; PHYSICAL ACCEPTANCE PENDING

This is the only active firmware GPIO map. It targets an ESP32-S3-WROOM-1
N16R8 module on the exact 44-pin carrier that must be confirmed before
control-capable flashing. ESP32-C3 builds and wiring are unsupported.

## Fixed map

| Module | Signal | ESP32-S3 GPIO |
| --- | --- | --- |
| Boiler MAX6675 | SCK | GPIO4, shared clock |
| Boiler MAX6675 | SO | GPIO5 |
| Boiler MAX6675 | CS | GPIO7, active low |
| Steam MAX6675 | SCK | GPIO4, shared clock |
| Steam MAX6675 | SO | GPIO8 |
| Steam MAX6675 | CS | GPIO9, active low |
| RobotDyn dimmer | ZC | GPIO6 input, phase 0, fixed 60 Hz |
| RobotDyn dimmer | DIM/PSM | GPIO10 output, LINEAR, initial 0%, cap 90% |
| HX711 | DT/DOUT | GPIO11 |
| HX711 | SCK/PD_SCK | GPIO12 |
| Heater SSR | command | GPIO21, active high |
| Native USB | D− / D+ | GPIO19/GPIO20, reserved |

## Reserved pins

- Strapping: GPIO0, GPIO3, GPIO45, GPIO46.
- Module flash/PSRAM region: GPIO26–GPIO37. PSRAM is disabled, but these pins
  remain unavailable for application wiring.
- JTAG: GPIO39–GPIO42.
- UART: GPIO43/GPIO44.
- Onboard LED: GPIO48.
- Native USB: GPIO19/GPIO20.

Compile-time configuration tests require every assigned signal to be unique
except the intentional shared MAX6675 SCK GPIO4 and reject overlap with the
reserved sets.

## Dual MAX6675 bus

Both MAX6675 boards must be 3.3 V-compatible and both thermocouple probes must
be electrically ungrounded. Firmware sets both CS lines high and SCK low before
sampling. A single critical-section lock then serializes Boiler and Steam reads
every 500 ms; only the selected channel's CS is driven low during its frame.

The shared SCK arrangement does not make the sensor outputs interchangeable.
Boiler SO is GPIO5 and Steam SO is GPIO8, with independent decoding, validation,
last-accepted baselines, calibration records, availability, and faults. A
greater-than-10°C downward jump is rejected per channel, while exactly 10°C is
accepted. Frame `0x0000`, open-circuit, reserved-bit, transport, and non-finite
results are invalid.

Earlier dual-probe interference on metal boiler hardware is unresolved for this
new placement. Any renewed cross-probe instability or electrical coupling
blocks Steam control until the probes/modules are isolated correctly.

## Heater and dimmer

GPIO21 is only a software command to the heater SSR. It cannot prove physical
de-energization and does not make a shorted SSR safe. Independent
over-temperature interruption remains mandatory.

The pump uses the native `rbdimmerESP32` 2.0.1 API. Firmware preloads GPIO10
low, registers ZC GPIO6 at phase 0/60 Hz, creates the GPIO10 LINEAR channel at
0%, and reapplies 0 before control starts. The one firmware-wide maximum is 90%.
That percentage is an abstract phase-angle command, not measured voltage,
power, pressure, flow, or delivered hydraulic output. There is no closed-loop
pressure control. The upstream default produces no firing below 3%, so internal
1–2% commands remain commanded values only.

## Flash and USB configuration

The target uses 16 MB QIO flash at 80 MHz with PSRAM disabled. Existing OTA
partitions stay within the first 4 MB; remaining flash is intentionally unused.
Native USB Serial/JTAG is the development console and recovery path.

## Required checks before flashing or energizing

Do not flash a control-capable image until a human confirms the exact 44-pin
board exposes GPIO4/5/6/7/8/9/10/11/12/21 and reserves the pins above. Do not
perform energized mains tests as part of repository verification.

With heater and pump loads disconnected, supervised low-voltage acceptance must
still verify:

- both probes are electrically ungrounded and isolated from each other/boiler;
- simultaneous readings remain stable with no dual-probe interference;
- CS, SCK, and both SO waveforms match sequential 500 ms acquisition;
- GPIO21 and GPIO10 have no unsafe boot/reset pulse;
- native USB console, reset, and recovery work on the exact board;
- isolated zero-cross input is detected on GPIO6 without logging each crossing;
- dimmer 0% ceases firing and 90% timing matches the intended 60 Hz waveform;
- HX711 GPIO11/GPIO12 acquisition does not starve CPU1 control or watchdogs.

Prior ESP32-C3, single-MAX6675, pump-SSR, heater-SSR, and RobotDyn physical or
functional acceptance does not validate this S3 map, simultaneous probes,
native USB boot behavior, GPIO21, or the near-valve Steam sensor placement.
Flashing and every energized acceptance remain separate human actions.
