# ESP32-C3 hardware wiring

Status: DRAFT — NOT ELECTRICALLY OR MAINS-SAFETY APPROVED

## Proposed modules and pins

| Module | Signal | ESP32-C3 connection |
| --- | --- | --- |
| OLED 128×32 I2C | VCC | 3V3 |
| OLED 128×32 I2C | GND | GND |
| OLED 128×32 I2C (`0x3C`) | SDA | GPIO8 |
| OLED 128×32 I2C (`0x3C`) | SCL | GPIO9 |
| MAX6675 #1 | VCC | 3V3 |
| MAX6675 #1 | GND | GND |
| MAX6675 #1 | SCK | GPIO4 |
| MAX6675 #1 | CS | GPIO7 (temporary low-voltage test mapping) |
| MAX6675 #1 | SO | GPIO6 |
| MAX6675 #2 | VCC | 3V3 |
| MAX6675 #2 | GND | GND |
| MAX6675 #2 | SCK | GPIO4 |
| MAX6675 #2 | CS | GPIO5 (temporary low-voltage test mapping) |
| MAX6675 #2 | SO | GPIO6 |
| SSR input | Positive | GPIO20, direct active-high drive, human-approved without external pull-down |
| SSR input | Negative | GND |

## Preliminary review

### MAX6675 interface

The two MAX6675 modules share SCK and SO but use independent active-low CS GPIOs. During low-voltage diagnosis, firmware controls SCK and both CS GPIOs explicitly. It forces both CS pins high, selects brew/GPIO7 low, verifies steam/GPIO5 remains high, reads one 16-bit frame, and de-selects brew. It then holds both CS pins high for 500 ms before selecting steam/GPIO5 low, verifies brew/GPIO7 remains high, reads steam, and de-selects it.

Low-voltage testing on 2026-07-05 confirmed that both MAX6675 modules return valid readings when individually selected through GPIO7. Using GPIO10 as a CS returned only zero frames. GPIO3 used first as CS alternated between `0x0000` and `0xFFFF`; when reused as a dedicated steam SO input it returned `0x0008`, while GPIO7/GPIO6 remained valid. Reversing read order ruled out conversion concurrency. The separate-SO experiment was then superseded by the shared-SO GPIO6 test requested by the project owner.

Disabling Wi-Fi did not correct the simultaneous-reading failure, so Wi-Fi is enabled again.

`kDualThermocouplesEnabled` is temporarily `false` while one MAX6675 module is faulty. In this degraded mode firmware reads only MAX6675 #1 on CS GPIO7, mirrors that measurement into both protocol/display temperature fields, and uses it for both brew and steam control. Brew and steam retain their existing targets, mode-specific over-temperature limits, readiness timing, heating timeout, and steam timeout. MAX6675 #2 is not read, and cross-sensor validation is unavailable. Setting the flag back to `true` restores dual reads and validation after the module is replaced.

The MAX6675 supports a 3.0 V through 5.5 V supply, has 0.25°C resolution, detects an open thermocouple, and requires as much as 220 ms for a conversion. Each converter should have the datasheet-recommended 0.1 µF ceramic bypass capacitor close to its supply pin. Firmware should schedule reads no faster than the conversion behavior allows and must treat open-thermocouple indications as a latched `sensor_failure`.

### OLED pins

GPIO8 and GPIO9 are ESP32-C3 strapping pins sampled during reset. GPIO9 must be high for normal SPI boot. Typical I2C pull-ups hold both lines high, which may work, but the exact OLED board, pull-ups, boot button, and ESP32-C3 Super Mini schematic must be checked and reset/power-cycle tested. Using non-strapping GPIOs for I2C is preferable if the final board exposes suitable alternatives.

### SSR output

GPIO20 is the human-approved active-high direct connection to the SSR input. No external pull-down resistor is installed. Firmware can command the pin low only after GPIO initialization and therefore cannot guarantee that the SSR input stays off while GPIO20 is uncontrolled during reset or early boot. Reliable 3.3 V activation and reset/boot behavior must be measured before energized testing; see `docs/side-notes.md`.

Firmware must immediately de-energize the SSR after sensor failure, over-temperature, heating timeout, internal control failure, or loss of valid measurements. A hardware thermal cutoff independent of the ESP32 and firmware is required for a heater connected to mains power.

The reported load is an 800 W boiler heater on 127 VAC, approximately 6.3 A at nominal voltage. The installed relay is a `FOTEK SSR-40 DA`. The manufacturer specification gives the standard model a 3–32 VDC control input and 24–380 VAC load output, making its output type and voltage range nominally compatible with this resistive heater. Reliable 3.3 V activation, unit authenticity, heat-sink sizing, mounting, and current derating still require verification before wiring approval.

An SSR's common dangerous failure mode is an output short, which leaves the heater on regardless of the GPIO command. The machine's original over-temperature fuse or thermostat is planned to remain installed and reportedly interrupts heater power above approximately 120°C. It addresses the SSR-short failure only if its contacts or fuse element are physically in series with the heater load independently of the ESP32 and SSR control input.

Its exact part number, marked trip point, tolerance, reset behavior, electrical rating, placement, and wiring must be verified. A 120°C software target cannot be accepted against an approximately 120°C hardware cutoff without a validated safety margin for overshoot, measurement error, thermal lag, and component tolerance.

### Temperature sensors

- MAX6675 #1 thermocouple is mounted at the boiler base and is the brew-mode control sensor.
- MAX6675 #2 thermocouple is mounted at the boiler top and is the steam-mode control sensor.
- Both sensors should be monitored in every mode so cross-sensor disagreement, implausible readings, and open thermocouples can force a latched fault.

Exact mounting, thermal lag, disagreement thresholds, and over-temperature limits still require validation on the physical boiler.

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
- Validated thermocouple mounting, control limits, sensor-disagreement thresholds, and over-temperature limits.
