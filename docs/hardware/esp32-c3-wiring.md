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
| MAX6675 #2 | SCK | GPIO0 (temporary isolated-bus diagnostic mapping) |
| MAX6675 #2 | CS | GPIO5 (temporary low-voltage test mapping) |
| MAX6675 #2 | SO | GPIO1 (temporary separate-SO diagnostic mapping) |
| Heater SSR input | Positive | GPIO20, direct active-high drive, human-approved without external pull-down |
| Heater SSR input | Negative | GND |
| Pump SSR input | Positive | GPIO10, active-high command; software configuration approved, physical wiring not approved |
| Pump SSR input | Negative | GND |

## Preliminary review

### MAX6675 interface

The two tested MAX6675 modules use fully separate SCK, SO, and active-low CS signals because they produced corrupted readings when either SCK or SO was shared. Brew uses SCK GPIO4, SO GPIO6, and CS GPIO7. Steam uses SCK GPIO0, SO GPIO1, and CS GPIO5. Firmware keeps both CS pins high during conversion, samples both completed frames sequentially, and waits 500 ms before the next sample cycle. This applies to both dual- and single-sensor mode so a slow converter is not repeatedly interrupted before completing.

Low-voltage testing on 2026-07-05 confirmed that both MAX6675 modules return valid readings when individually selected through GPIO7. Using GPIO10 as a CS returned only zero frames. GPIO3 used first as CS alternated between `0x0000` and `0xFFFF`; when reused as a dedicated steam SO input it returned `0x0008`, while GPIO7/GPIO6 remained valid. Reversing read order ruled out conversion concurrency. A later shared-SO test showed plausible individual readings but corrupted values when both modules drove GPIO6, so the 2026-07-06 diagnostic mapping gives each module a separate SO input and uses previously untested GPIO1 for steam.

Disabling Wi-Fi did not correct the simultaneous-reading failure, so Wi-Fi is enabled again.
Because the router is expected to be very close to the machine, firmware now
limits ESP-IDF station transmit power to `44` quarter-dBm units, or 11 dBm, as a
diagnostic reduction from the default maximum after Wi-Fi starts. If ESP-IDF
rejects the limit, firmware logs a warning and keeps the network on default
power. If discovery, HTTP polling, or reconnects become worse, raise this value
before changing sensor or heater control behavior. This setting does not replace
antenna placement, supply decoupling, or low-voltage noise checks.

`kDualThermocouplesEnabled` is temporarily `false`. Firmware reads only the brew MAX6675 on SCK/SO/CS GPIO4/GPIO6/GPIO7 every 500 ms, mirrors that measurement into both protocol/display fields, and uses it for brew and steam control. The steam converter is not selected or clocked. This single-sensor mode remains a degraded diagnostic configuration and does not satisfy final dual-sensor acceptance.

The MAX6675 supports a 3.0 V through 5.5 V supply, has 0.25°C resolution, detects an open thermocouple, and requires as much as 220 ms for a conversion. Each converter should have the datasheet-recommended 0.1 µF ceramic bypass capacitor close to its supply pin. Firmware should schedule reads no faster than the conversion behavior allows and must treat open-thermocouple indications as a latched `sensor_failure`.

### OLED pins

GPIO8 and GPIO9 are ESP32-C3 strapping pins sampled during reset. GPIO9 must be high for normal SPI boot. Typical I2C pull-ups hold both lines high, which may work, but the exact OLED board, pull-ups, boot button, and ESP32-C3 Super Mini schematic must be checked and reset/power-cycle tested. Using non-strapping GPIOs for I2C is preferable if the final board exposes suitable alternatives.

### SSR output

GPIO20 is the human-approved active-high direct connection to the SSR input. No external pull-down resistor is installed. Firmware can command the pin low only after GPIO initialization and therefore cannot guarantee that the SSR input stays off while GPIO20 is uncontrolled during reset or early boot. Reliable 3.3 V activation and reset/boot behavior must be measured before energized testing; see `docs/side-notes.md`.

Firmware must immediately de-energize the SSR after sensor failure, over-temperature, heating timeout, internal control failure, or loss of valid measurements. A hardware thermal cutoff independent of the ESP32 and firmware is required for a heater connected to mains power.

The reported load is an 800 W boiler heater on 127 VAC, approximately 6.3 A at nominal voltage. The installed relay is a `FOTEK SSR-40 DA`. The manufacturer specification gives the standard model a 3–32 VDC control input and 24–380 VAC load output, making its output type and voltage range nominally compatible with this resistive heater. Reliable 3.3 V activation, unit authenticity, heat-sink sizing, mounting, and current derating still require verification before wiring approval.

An SSR's common dangerous failure mode is an output short, which leaves the heater on regardless of the GPIO command. The machine's original over-temperature fuse or thermostat is planned to remain installed and reportedly interrupts heater power above approximately 120°C. It addresses the SSR-short failure only if its contacts or fuse element are physically in series with the heater load independently of the ESP32 and SSR control input.

Its exact part number, marked trip point, tolerance, reset behavior, electrical rating, placement, and wiring must be verified. A 120°C software target cannot be accepted against an approximately 120°C hardware cutoff without a validated safety margin for overshoot, measurement error, thermal lag, and component tolerance.

### Pump output

GPIO10 is reserved for an active-high pump SSR command. Firmware commands it low before configuring it as an output and again immediately after configuration; it never restores a running command at boot. PUMP-005 does not connect this output to extraction policy or HTTP, so current firmware has no runtime path that commands the pump on.

`running` and `off` describe only the requested GPIO10 command. There is no pump-current, SSR-output, switch-position, pressure, or flow feedback, so software cannot confirm pump operation or physical de-energization. A GPIO write failure leaves the reported firmware command at `off`, records initialization failure where applicable, and must not be interpreted as proof that the pin or load is low.

The original series pump switch, the exact pump SSR, active-high 3.3 V drive, reset/boot behavior, mounting, ratings, wiring, and failure behavior remain subject to disconnected low-voltage checks and separate qualified physical approval. GPIO10 is uncontrolled during reset and early boot before application initialization, so the firmware ordering does not remove that hardware risk.

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
- Pump SSR identity/rating, original series-switch wiring, reliable 3.3 V drive, and reset/power-cycle GPIO10 behavior with the mains load disconnected.
- Original over-temperature fuse/thermostat identity, trip tolerance, reset behavior, electrical rating, placement, and proof that it interrupts a shorted SSR's heater current.
- Verified HLK-5M05B input protection, PCB layout, enclosure, and 5 V connection to the chosen Super Mini board.
- Validated thermocouple mounting, control limits, sensor-disagreement thresholds, and over-temperature limits.
