# PhilcoINO ESP32-C3 firmware

ESP-IDF C++ firmware for the ESP32-C3 Super Mini. It owns sensor sampling, persisted targets/profiles, brew/steam control state, independent heater/pump command boundaries, OLED status, bearer-authenticated HTTP, and `_philcoino._tcp` mDNS advertising. Extraction policy and API v2 are not yet implemented in firmware.

> [!CAUTION]
> This firmware is not approved for production, unattended, or mains-powered heater operation. Keep the heater/load disconnected for development and read [Safety](../../docs/en/SAFETY.md) plus the [current review](../../CODEBASE_REVIEW_REPORT.md).

## Architecture

- `components/firmware_config`: identity, pins, target/safety constants, timeouts, and diagnostic flags.
- `components/peripherals`: pure MAX6675, NVS target/profile, independent fail-off heater/pump command, and SSD1306 policies plus ESP-IDF adapters.
- `components/control`: pure temperature controller, readiness, duty windows, timeouts, and fault latching.
- `components/networking`: pure HTTP API plus ESP-IDF Wi-Fi, HTTP, and mDNS adapters.
- `main`: fail-off startup ordering, shared-object wiring, control loop, display, mutex, and background networking.
- `host-tests`: native C++ tests and protocol contract capture validation.

Pure policy stays host-testable; ESP-IDF GPIO/I2C/NVS/Wi-Fi/HTTP/mDNS calls remain in `esp_*` adapters and startup wiring.

## Toolchain

The project is pinned to ESP-IDF `v6.0.2`, target `esp32c3`, and managed `espressif/mdns` `1.11.3`.

Activate the pinned installation for your environment, then build from this directory:

```bash
idf.py set-target esp32c3
idf.py build
```

Build output, downloaded managed components, and generated local configuration are ignored. Do not inspect or commit them.

## Local secrets

Run `idf.py menuconfig` and enter the Wi-Fi SSID, Wi-Fi password, and bearer token under `PhilcoINO`. ESP-IDF writes them to generated, ignored `sdkconfig`.

Never place secrets in `sdkconfig.defaults`, source files, tests, logs, screenshots, or documentation. Firmware logs only whether required values are missing.

## Host tests

From the repository root:

```bash
cmake -S firmware/espresso-machine/host-tests -B /tmp/philcoino-host-tests
cmake --build /tmp/philcoino-host-tests
ctest --test-dir /tmp/philcoino-host-tests --output-on-failure
/tmp/philcoino-host-tests/firmware_api_test \
  /tmp/philcoino-firmware-contract
bun run firmware/espresso-machine/host-tests/validate_contract.ts \
  /tmp/philcoino-firmware-contract
```

The suite covers identity/configuration, MAX6675 decoding, target/profile persistence policy, fail-off heater/pump command behavior, OLED serialization, control transitions/timeouts/faults, bearer/API parsing, and contract response captures. It does not exercise ESP-IDF scheduling, physical sensors, GPIO, SSRs, or thermal behavior.

## Current diagnostic configuration

Current source has:

- `kDualThermocouplesEnabled = false`: only the brew MAX6675 is read and its value is mirrored for steam control;
- `kOledEnabled = true`: SSD1306 initialization/render failure stops control startup;
- `kPumpGpio = 10` and `kPumpActiveHigh = true`: startup commands GPIO10 low, and current firmware has no application path that commands it on;
- `kWifiEnabled = true`.

Single-sensor mode does not satisfy final dual-sensor acceptance. The OLED flag also conflicts with tracker text describing a temporary disabled-display state. Resolve the intended hardware configuration explicitly before device testing.

## Low-voltage checks only

Keep mains heater and pump loads disconnected. With qualified supervision, power only the ESP32 and 3.3 V peripherals to check boot, thermocouple readings, open-probe handling, OLED status, network API/discovery, and GPIO20/GPIO10 inactive levels through reset and induced failures.

This does not authorize mains operation and cannot validate SSR load behavior, pump operation/de-energization, independent cutoff wiring, thermal response, enclosure, grounding, or regulatory compliance.
