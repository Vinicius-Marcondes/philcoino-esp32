# ESP32-C3 hardware wiring

Status: DRAFT — NOT ELECTRICALLY OR MAINS-SAFETY APPROVED

## Proposed modules and pins

| Module | Signal | ESP32-C3 connection |
| --- | --- | --- |
| OLED 128×32 I2C | VCC | 3V3 |
| OLED 128×32 I2C | GND | GND |
| OLED 128×32 I2C (`0x3C`) | SDA | GPIO8 |
| OLED 128×32 I2C (`0x3C`) | SCL | GPIO9 |
| Boiler MAX6675 | VCC | 3V3 |
| Boiler MAX6675 | GND | GND |
| Boiler MAX6675 | SCK | GPIO4 |
| Boiler MAX6675 | CS | GPIO7 |
| Boiler MAX6675 | SO | GPIO6 |
| SSR input | Positive | GPIO20, direct active-high drive, human-approved without external pull-down |
| SSR input | Negative | GND |

## Preliminary review

### MAX6675 interface

The permanent boiler sensor uses SCK GPIO4, SO GPIO6, and active-low CS GPIO7. Firmware waits 500 ms between samples, which exceeds the MAX6675's maximum conversion time. No second MAX6675 bus or GPIO configuration remains in firmware.

Earlier low-voltage experiments with two modules produced unreliable readings when both thermocouples were attached to the metal boiler. The permanent design therefore retains only the boiler-base sensor and its proven GPIO4/GPIO6/GPIO7 interface. The removed second-sensor wiring must remain disconnected.

Disabling Wi-Fi did not correct the simultaneous-reading failure, so Wi-Fi is enabled again.
Because the router is expected to be very close to the machine, firmware now
limits ESP-IDF station transmit power to `44` quarter-dBm units, or 11 dBm, as a
diagnostic reduction from the default maximum after Wi-Fi starts. If ESP-IDF
rejects the limit, firmware logs a warning and keeps the network on default
power. If discovery, HTTP polling, or reconnects become worse, raise this value
before changing sensor or heater control behavior. This setting does not replace
antenna placement, supply decoupling, or low-voltage noise checks.

The API and OLED expose one boiler temperature. Brew and steam modes apply different targets and safety limits to that same measurement. The MAX6675 supports a 3.0 V through 5.5 V supply, has 0.25°C resolution, detects an open thermocouple, and requires as much as 220 ms for a conversion. The converter should have the datasheet-recommended 0.1 µF ceramic bypass capacitor close to its supply pin. Firmware treats open-thermocouple indications as a latched `sensor_failure`.

### OLED pins

GPIO8 and GPIO9 are ESP32-C3 strapping pins sampled during reset. GPIO9 must be high for normal SPI boot. Typical I2C pull-ups hold both lines high, which may work, but the exact OLED board, pull-ups, boot button, and ESP32-C3 Super Mini schematic must be checked and reset/power-cycle tested. Using non-strapping GPIOs for I2C is preferable if the final board exposes suitable alternatives.

### SSR output

GPIO20 is the human-approved active-high direct connection to the SSR input. No external pull-down resistor is installed. Firmware can command the pin low only after GPIO initialization and therefore cannot guarantee that the SSR input stays off while GPIO20 is uncontrolled during reset or early boot. Reliable 3.3 V activation and reset/boot behavior must be measured before energized testing; see `docs/side-notes.md`.

Firmware must immediately de-energize the SSR after sensor failure, over-temperature, heating timeout, internal control failure, or loss of valid measurements. A hardware thermal cutoff independent of the ESP32 and firmware is required for a heater connected to mains power.

The reported load is an 800 W boiler heater on 127 VAC, approximately 6.3 A at nominal voltage. The installed relay is a `FOTEK SSR-40 DA`. The manufacturer specification gives the standard model a 3–32 VDC control input and 24–380 VAC load output, making its output type and voltage range nominally compatible with this resistive heater. Reliable 3.3 V activation, unit authenticity, heat-sink sizing, mounting, and current derating still require verification before wiring approval.

An SSR's common dangerous failure mode is an output short, which leaves the heater on regardless of the GPIO command. The machine's original over-temperature fuse or thermostat is planned to remain installed and reportedly interrupts heater power above approximately 120°C. It addresses the SSR-short failure only if its contacts or fuse element are physically in series with the heater load independently of the ESP32 and SSR control input.

Its exact part number, marked trip point, tolerance, reset behavior, electrical rating, placement, and wiring must be verified. A 120°C software target cannot be accepted against an approximately 120°C hardware cutoff without a validated safety margin for overshoot, measurement error, thermal lag, and component tolerance.

### Temperature sensors

- The one MAX6675 thermocouple is mounted at the boiler base and controls both brew and steam modes.
- Open, invalid, non-finite, or transport-failed readings force a latched `sensor_failure` and an off command.
- Because there is no redundant sensor, a plausible but incorrect reading cannot be detected through disagreement; independent physical temperature protection is mandatory.

Exact mounting, thermal lag, measurement error, and over-temperature limits still require validation on the physical boiler against an independent instrument.

### Display

The 128×32 I2C display uses an SSD1306 controller at address `0x3C` on GPIO8/GPIO9. The owner confirmed that the breakout includes I2C pull-up resistors. No dedicated reset pin is configured. The 128×32 initialization sequence remains part of the later display-driver task.

### Low-voltage power

The planned supply is a Hi-Link HLK-5M05B: 85–265 VAC input and regulated 5 V, 1 A output. Its 5 V output should feed the ESP32-C3 Super Mini's supported 5 V input path, not its 3V3 pin; the board regulator then supplies 3.3 V peripherals.

The manufacturer's application guidance identifies a 1 A/250 VAC slow-blow input fuse and a 10D561K MOV as basic required protection, with additional safety capacitor and common-mode filtering for compliance. PCB clearances, enclosure, grounding, mains wiring, output capacitors, and thermal placement need a qualified electrical review.

## Information required before approval

- Exact ESP32-C3 Super Mini vendor or schematic.
- Reset and power-cycle verification of the OLED pull-ups on the GPIO8/GPIO9 strapping pins.
- FOTEK SSR-40 DA terminal verification, reliable 3.3 V drive test, current derating, mounting, and heat sink.
- Original over-temperature fuse/thermostat identity, trip tolerance, reset behavior, electrical rating, placement, and proof that it interrupts a shorted SSR's heater current.
- Verified HLK-5M05B input protection, PCB layout, enclosure, and 5 V connection to the chosen Super Mini board.
- Validated thermocouple mounting, control limits, measurement error, thermal lag, and over-temperature limits.
