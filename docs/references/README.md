# Authoritative documentation references

Last reviewed: 2026-07-03

This index is the starting point for implementation research. Prefer the exact version linked here over unversioned tutorials. The firmware is pinned to ESP-IDF `v6.0.2`; firmware links below use that exact release.

These references inform engineering work; they do not constitute electrical, mains-safety, or regulatory approval.

## Mobile application

- [Expo SDK 54 reference](https://docs.expo.dev/versions/v54.0.0/): project-pinned Expo documentation.
- [Expo SDK 54 SecureStore](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/): encrypted bearer-token storage.
- [Expo SDK 54 `expo/fetch`](https://docs.expo.dev/versions/v54.0.0/sdk/expo/): HTTP and streaming API available through Expo.
- [Expo SDK 54 NetInfo](https://docs.expo.dev/versions/v54.0.0/sdk/netinfo/): network reachability information.
- [React Native 0.81 components and APIs](https://reactnative.dev/docs/0.81/components-and-apis): React Native version used by Expo 54.
- [React Native WebSocket](https://reactnative.dev/docs/global-WebSocket): future reference if polling is replaced by streaming.
- [Apple Bonjour overview](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/NetServices/Introduction.html): local service discovery model.
- [Apple local-network privacy guidance](https://developer.apple.com/videos/play/wwdc2020/10110/): iOS local-network permission and Bonjour declarations.
- [Apple `NSLocalNetworkUsageDescription`](https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription): required local-network usage message.
- [Apple `NSAllowsLocalNetworking`](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking): ATS behavior for local HTTP resources.

## TypeScript, protocol, and simulator

- [Bun workspaces](https://bun.sh/guides/install/workspaces): proposed JavaScript/TypeScript monorepo layout.
- [Hono on Bun](https://hono.dev/docs/getting-started/bun): proposed development-only ESP32 simulator.
- [Zod basics](https://zod.dev/basics): runtime validation of ESP32 payloads in the mobile app and simulator.
- [OpenAPI 3.1.1 specification](https://spec.openapis.org/oas/v3.1.1.html): language-neutral API contract source of truth.

## ESP32-C3 and ESP-IDF

- [ESP-IDF v6.0.2 ESP32-C3 programming guide](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32c3/): project-pinned firmware documentation.
- [ESP32-C3 datasheet](https://documentation.espressif.com/ESP32-C3_Datasheet_en.pdf): electrical characteristics, pins, boot strapping, and power-up behavior.
- [ESP32-C3 technical reference manual](https://documentation.espressif.com/esp32-c3_technical_reference_manual_en.pdf): peripheral and register-level reference.
- [ESP-IDF v6.0.2 GPIO](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32c3/api-reference/peripherals/gpio.html): GPIO restrictions and configuration.
- [ESP-IDF v6.0.2 I2C](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32c3/api-reference/peripherals/i2c.html): SSD1306 bus implementation.
- [ESP-IDF v6.0.2 SPI master](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32c3/api-reference/peripherals/spi_master.html): shared MAX6675 bus implementation.
- [ESP-IDF v6.0.2 NVS](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32c3/api-reference/storage/nvs_flash.html): persisted temperature targets and configuration.
- [ESP-IDF v6.0.2 HTTP server](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32c3/api-reference/protocols/esp_http_server.html): firmware HTTP API implementation.
- [ESP-IDF v6.0.2 component manager](https://docs.espressif.com/projects/esp-idf/en/v6.0.2/esp32c3/api-guides/tools/idf-component-manager.html): managed dependency manifests and lock files.
- [Espressif mDNS component 1.11.3](https://components.espressif.com/components/espressif/mdns/versions/1.11.3/readme): pinned `_philcoino._tcp` discovery dependency.

## Components

- [MAX6675 datasheet](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX6675.pdf): thermocouple interface, timing, resolution, and open-sensor detection.
- [Solomon Systech SSD1306 product listing](https://www.solomon-systech.com/product-category/oled-display): authoritative controller identity and capabilities.
- [SSD1306 datasheet mirror](https://cdn-shop.adafruit.com/datasheets/SSD1306.pdf): register and I2C protocol reference; verify the actual module variant and address.
- [Hi-Link HLK-5M05B product page](https://www.hlktech.net/index.php?id=1288): official product listing.
- [Hi-Link HLK-5M05B datasheet](https://h.hlktech.com/download/ACDC%E7%94%B5%E6%BA%90%E6%A8%A1%E5%9D%975W%E7%B3%BB%E5%88%97/1/%E6%B5%B7%E5%87%8C%E7%A7%915W%28B%29%E7%B3%BB%E5%88%97%E7%94%B5%E6%BA%90%E6%A8%A1%E5%9D%97%E8%A7%84%E6%A0%BC%E4%B9%A6V1.0%20.pdf): input protection, isolation, output limits, and application circuit.

## Heater and SSR safety

- [FOTEK SSR series datasheet mirror](https://cdn.sparkfun.com/datasheets/Components/General/SSR40DA.pdf): SSR-40DA control/load ranges and general specifications.
- [Omron SSR safety precautions](https://www.ia.omron.com/product/cautions/18/safety_precautions.html): SSR failure behavior and general protection requirements.
- [Omron solid-state relay common precautions](https://omronfs.omron.com/en_US/ecb/products/pdf/precautions_ssr.pdf): fail-safe guidance for shorted SSR outputs, contactors, breakers, fusing, and heat sinking.

The installed relay is confirmed as a FOTEK SSR-40 DA. Its physical markings, 3.3 V activation margin, heat-sink requirement, mounting, and derating must still be verified on the actual unit.
