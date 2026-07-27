# PERF-010 — OLED removal evidence

Date: 2026-07-26

## Result

The disabled SSD1306 feature was removed from active firmware: configuration,
renderer/framebuffer, ESP-IDF I2C transport and component dependency, startup
and render branches, and OLED-only host tests. GPIO8 and GPIO9 are unassigned.

The production startup order still initializes pump and heater outputs fail-off
before storage, sensors, synchronization, and networking. No public API or wire
schema changed, and no pin was reassigned.

## Source and dependency audit

Searches of active firmware source, main, and host tests found no remaining
`Oled`, `OLED`, `Ssd1306`, `SSD1306`, `DisplaySnapshot`,
`DisplayTemperature`, `display_temperature`, `kOled`, or
`esp_driver_i2c` symbol. Historical PRDs, reviews, decisions, references, and
side notes were retained.

## Software verification

- Native host build and CTest: 7/7 passed.
- ASan/UBSan host build and CTest: 7/7 passed.
- Firmware contract generation and validation: 32 captures passed.
- Tools: Bun 1.3.14, CMake 4.3.4, Apple clang 21.0.0.

## Target and Human gates

The pinned ESP-IDF target toolchain was unavailable: `idf.py` was not on
`PATH` and `IDF_PATH` was unset. Therefore no comparable target build, map, or
image-size delta was produced. No connected hardware, GPIO, logic-analyzer, or
energized-mains validation was performed or inferred.
