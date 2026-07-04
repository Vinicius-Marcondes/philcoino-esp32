# PhilcoINO ESP32-C3 firmware

This is the ESP-IDF C++ firmware project for the ESP32-C3 Super Mini. PHIL-004
contains only the build foundation, configuration, boot logging, and host-testable
configuration boundary. Peripheral drivers, control logic, networking, and HTTP
handlers belong to later tasks.

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

Future hardware components should depend inward on host-testable interfaces and
keep ESP-IDF calls at the platform boundary.
