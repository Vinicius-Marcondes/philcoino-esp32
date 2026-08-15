# ESP32-C3 hardware wiring

> [!IMPORTANT]
> Historical/superseded record only. Current firmware no longer supports the
> ESP32-C3. Use [ESP32-S3-WROOM-1 N16R8 wiring](esp32-s3-n16r8-wiring.md).
> Nothing accepted on this C3 configuration validates the S3 GPIO map, dual
> probes, native USB boot behavior, GPIO21 heater command, or Steam placement.

Status: DRAFT — NOT ELECTRICALLY OR MAINS-SAFETY APPROVED

## Proposed modules and pins

| Module | Signal | ESP32-C3 connection |
| --- | --- | --- |
| Unassigned | — | GPIO8 |
| Unassigned | — | GPIO9 |
| Boiler MAX6675 | VCC | 3V3 |
| Boiler MAX6675 | GND | GND |
| Boiler MAX6675 | SCK | GPIO4 |
| Boiler MAX6675 | CS | GPIO7 |
| Boiler MAX6675 | SO | GPIO5 |
| Heater SSR input | Positive | GPIO20, direct active-high drive, human-approved without external pull-down |
| Heater SSR input | Negative | GND |
| Pump dimmer | ZC output | GPIO6 input; non-strapping pin, physical connection pending verification |
| Pump dimmer | DIM / PSM input | GPIO10 output; phase-angle trigger command |
| Pump dimmer | VCC / GND | 3V3 / GND on the isolated low-voltage side |
| HX711 load-cell ADC | VCC | 3V3 |
| HX711 load-cell ADC | GND | GND |
| HX711 load-cell ADC | DT/DOUT | GPIO0 |
| HX711 load-cell ADC | SCK/PD_SCK | GPIO1 |

## Preliminary review

### MAX6675 interface

The permanent boiler sensor uses SCK GPIO4, SO GPIO5, and active-low CS GPIO7. Firmware waits 500 ms between samples, which exceeds the MAX6675's maximum conversion time. No second MAX6675 bus or GPIO configuration remains in firmware.

Earlier low-voltage experiments with two modules produced unreliable readings when both thermocouples were attached to the metal boiler. The permanent design therefore retains only the boiler-base sensor on the GPIO4/GPIO5/GPIO7 interface. The removed second-sensor wiring must remain disconnected.

Disabling Wi-Fi did not correct the simultaneous-reading failure, so Wi-Fi is enabled again.
Because the router is expected to be very close to the machine, firmware now
limits ESP-IDF station transmit power to `44` quarter-dBm units, or 11 dBm, as a
diagnostic reduction from the default maximum after Wi-Fi starts. If ESP-IDF
rejects the limit, firmware logs a warning and keeps the network on default
power. If discovery, HTTP polling, or reconnects become worse, raise this value
before changing sensor or heater control behavior. This setting does not replace
antenna placement, supply decoupling, or low-voltage noise checks.

The API exposes one boiler temperature. Brew and steam modes apply different targets and safety limits to that same measurement. The MAX6675 supports a 3.0 V through 5.5 V supply, has 0.25°C resolution, detects an open thermocouple, and requires as much as 220 ms for a conversion. The converter should have the datasheet-recommended 0.1 µF ceramic bypass capacitor close to its supply pin. Firmware treats open-thermocouple indications as a latched `sensor_failure`.

### Unassigned GPIO8/GPIO9

GPIO8 and GPIO9 are not assigned by current firmware or approved wiring.
Historically they were proposed for an SSD1306 I2C display, but both are
ESP32-C3 strapping pins sampled during reset and GPIO9 must be high for normal
SPI boot. PERF-010 removed that disabled implementation and did not reassign
either pin. Any future use requires a separate reviewed hardware task.

### SSR output

GPIO20 is the human-approved active-high direct connection to the SSR input. No external pull-down resistor is installed. Firmware can command the pin low only after GPIO initialization and therefore cannot guarantee that the SSR input stays off while GPIO20 is uncontrolled during reset or early boot. Reliable 3.3 V activation and reset/boot behavior must be measured before energized testing; see `docs/side-notes.md`.

Firmware must immediately de-energize the SSR after sensor failure, over-temperature, heating timeout, internal control failure, or loss of valid measurements. A hardware thermal cutoff independent of the ESP32 and firmware is required for a heater connected to mains power.

The reported load is an 800 W boiler heater on 127 VAC, approximately 6.3 A at nominal voltage. The installed relay is a `FOTEK SSR-40 DA`. The manufacturer specification gives the standard model a 3–32 VDC control input and 24–380 VAC load output, making its output type and voltage range nominally compatible with this resistive heater. Reliable 3.3 V activation, unit authenticity, heat-sink sizing, mounting, and current derating still require verification before wiring approval.

An SSR's common dangerous failure mode is an output short, which leaves the heater on regardless of the GPIO command. The machine's retained thermostat is owner-identified from a replacement listing as nominally `145°C`, 10 A, 250 V. It addresses the SSR-short failure only if its contacts are physically in series with the heater load independently of the ESP32 and SSR control input; the listing does not prove the installed part, tolerance, coupling, wiring, or interruption.

Its exact part number, marked trip point, tolerance, reset behavior, electrical rating, placement, and wiring must be verified. The inclusive `135°C` software cap does not establish adequate physical margin against a nominal `145°C` thermostat without supervised measurements for overshoot, measurement error, thermal lag, component tolerance, and actual heater interruption.

### Pump output

The installed pump controller is now a RobotDyn-compatible BTA16-600B
phase-angle dimmer rather than the earlier pump SSR. Its isolated low-voltage
interface uses GPIO6 for zero-cross input and GPIO10 for DIM/PSM output. GPIO6
is currently unused by every other configured peripheral and is not an
ESP32-C3 strapping pin; GPIO8/GPIO9 remain deliberately unassigned because of
their boot-strapping constraints. The exact Super Mini board must still be
checked to confirm GPIO6 exposure before flashing.

Firmware preloads GPIO10 low, initializes `rbdimmerESP32` with phase 0, fixed
60 Hz, initial level 0%, and `RBDIMMER_CURVE_LINEAR`, then explicitly commands
0% again before constructing extraction/cooldown control. Any initialization
failure aborts later startup while retrying the low/OFF command. Manual,
pre-infusion, main-extraction, and cooldown ON requests map to 90%; soak, Stop,
completion, cutoff, reset/startup, synchronization failure, and output failure
map to 0%.

The single authoritative `kPumpMaximumPowerPercent` is 90. This temporary cap
exists because the pending pressure sensor is limited to approximately 13 bar
and no closed-loop pressure controller exists. Higher requests are clamped in
the low-level pump owner before reaching the library. Values 1–2% remain
abstract command values, but the pinned library's default minimum emits no
TRIAC firing below 3%. No percentage represents measured voltage, pressure,
flow, or delivered pump power.

`running` and `off` remain the only public wire states and describe only whether
the last acknowledged effective command is above 0%. There is no pump-current,
TRIAC-output, switch-position, pressure, or flow feedback, so software cannot
confirm pump operation or physical de-energization. A dimmer API/GPIO failure
retains the existing unknown-output handling and must not be interpreted as
proof that the pin or load is low.

The original series pump switch remains the local hard cutoff but is not sensed
by software. The dimmer identity, isolation, zero-cross polarity/waveform,
3.3 V compatibility, BTA16 heat sinking/derating, reset/boot behavior, mounting,
wiring, and failure behavior require disconnected low-voltage checks and
separate qualified physical approval. GPIO10 remains uncontrolled during reset
and early boot before application initialization, so firmware ordering cannot
eliminate startup-pulse hardware risk.

On 2026-07-14, the owner accepted the target functional matrix after reporting successful rebuilt HTTP/mDNS startup, mobile reachability, Manual and seeded-profile timing, Stop/cutoff behavior, continuation after app disconnection, and idle/no-resume behavior after reset or power cycle. This is owner-reported functional evidence, not an independently reviewed electrical record. No exact board identifier, firmware image hash, instrument model, raw GPIO10 capture, injected GPIO-write failure, target timer-wrap waveform, or separately authorized energized evidence was supplied. The wiring status therefore remains draft and not mains-safety approved.

That evidence applies to the superseded GPIO10 pump-SSR configuration. It does
not validate GPIO6 zero-cross detection, phase timing, the RobotDyn-compatible
dimmer, the BTA16-600B installation, or the new reset/failure behavior.

### HX711 scale

The generic single-supply HX711 breakout is assigned to 3.3 V, common ground,
DT/DOUT GPIO0, and PD_SCK GPIO1. The 1 kg full-bridge load cell connects to
channel A (`E+`, `E-`, `A+`, `A-`); wire colors are not authoritative and must
be confirmed against the actual cell before connection. Channel A uses gain
128. Firmware samples without blocking the workflow loop, sign-extends 24-bit
readings, filters a rolling window, detects saturation/unavailability, and
stores calibration separately in NVS.

GPIO0 and GPIO1 behavior, the actual breakout data-ready rate, load-cell
polarity, mounting, repeatability, drift, and calibration around 0/35/100 g
remain pending disconnected low-voltage validation. The 0.1 g wire/storage
resolution is not an accuracy claim. No scale wiring or test authorizes mains
power, and automatic tare cannot establish that a cup is present.

### Temperature sensors

- The one MAX6675 thermocouple is mounted at the boiler base and controls both brew and steam modes.
- Open, invalid, non-finite, or transport-failed readings force a latched `sensor_failure` and an off command.
- Because there is no redundant sensor, a plausible but incorrect reading cannot be detected through disagreement; independent physical temperature protection is mandatory.

Exact mounting, thermal lag, measurement error, and over-temperature limits still require validation on the physical boiler against an independent instrument.

### Historical display decision

An earlier design proposed a 128×32 SSD1306 display at address `0x3C` on
GPIO8/GPIO9, and the owner reported pull-ups on that breakout. The feature was
disabled before PERF-010 removed its firmware implementation and I2C
dependency. This record explains the abandoned pin choice; it is not current
wiring guidance or approval to reconnect the display.

### Low-voltage power

The planned supply is a Hi-Link HLK-5M05B: 85–265 VAC input and regulated 5 V, 1 A output. Its 5 V output should feed the ESP32-C3 Super Mini's supported 5 V input path, not its 3V3 pin; the board regulator then supplies 3.3 V peripherals.

The manufacturer's application guidance identifies a 1 A/250 VAC slow-blow input fuse and a 10D561K MOV as basic required protection, with additional safety capacitor and common-mode filtering for compliance. PCB clearances, enclosure, grounding, mains wiring, output capacitors, and thermal placement need a qualified electrical review.

## Information required before approval

- Exact ESP32-C3 Super Mini vendor or schematic.
- FOTEK SSR-40 DA terminal verification, reliable 3.3 V drive test, current derating, mounting, and heat sink.
- RobotDyn-compatible dimmer identity/isolation/rating, GPIO6 exposure and
  zero-cross waveform, GPIO10 DIM/PSM polarity, original series-switch wiring,
  3.3 V behavior, and reset/power-cycle output with the mains load disconnected.
- HX711/load-cell wire mapping, GPIO0/GPIO1 reset and power-cycle behavior, data-ready cadence, repeatability, drift, disconnection/saturation response, and calibration checks with all mains loads disconnected.
- Original over-temperature fuse/thermostat identity, trip tolerance, reset behavior, electrical rating, placement, and proof that it interrupts a shorted SSR's heater current.
- Verified HLK-5M05B input protection, PCB layout, enclosure, and 5 V connection to the chosen Super Mini board.
- Validated thermocouple mounting, control limits, measurement error, thermal lag, and over-temperature limits.
