# PhilcoINO ESP32-C3 firmware

This is the ESP-IDF C++ firmware project for the ESP32-C3 Super Mini. PHIL-004
contains host-testable MAX6675, SSD1306, NVS target, fail-off SSR, control-state,
and HTTP API boundaries. The ESP-IDF adapter connects Wi-Fi, serves the local
API on port 80, and advertises `_philcoino._tcp` through mDNS.

## Toolchain

The project is pinned to ESP-IDF `v6.0.2` and target `esp32c3`. The only managed
component currently pinned is `espressif/mdns` `1.11.3`.

On the current development machine, activate that installation with:

```sh
export IDF_PYTHON_ENV_PATH="$HOME/.espressif/python_env/idf6.0_py3.14_env"
source "$HOME/.espressif/v6.0.2/esp-idf/export.sh"
```

Build from this directory with `idf.py build`. Build output and downloaded
managed components are ignored; `dependencies.lock` is committed to preserve the
resolved dependency graph.

## Local secrets

Run `idf.py menuconfig` and enter the Wi-Fi SSID, Wi-Fi password, and bearer token
under `PhilcoINO`. ESP-IDF writes them to the generated `sdkconfig`, which is
ignored. Do not place secrets in `sdkconfig.defaults`, source files, logs, or
documentation. The foundation builds with empty values and logs only that secrets
are missing.

## Host tests

The `firmware_config` component uses only the C++ standard library, allowing its
identity formatting and safety constants to be tested without ESP-IDF or hardware:

```sh
cmake -S host-tests -B /tmp/philcoino-host-tests
cmake --build /tmp/philcoino-host-tests
ctest --test-dir /tmp/philcoino-host-tests --output-on-failure
```

The host suite verifies sequential dual-MAX6675 reads and frame faults, target
persistence, SSR fail-off behavior, the control state machine, strict API
parsing/authentication, and contract response serialization. ESP-IDF calls
remain at the platform boundary.

## Low-voltage peripheral check

Keep the mains heater disconnected. Power only the ESP32 and 3.3 V peripherals,
then confirm both thermocouples report independently, an open probe produces the
fault display, the OLED shows both temperatures and targets, and GPIO20 remains
low through reset, initialization, and induced peripheral failures. This check
does not authorize mains-powered heater operation.

`philcoino::config::kOledEnabled` is the firmware-side display flag. It is
currently `false` so the device can boot, control temperature, and serve the API
when the SSD1306 OLED is disconnected. Set it to `true` before OLED validation.
