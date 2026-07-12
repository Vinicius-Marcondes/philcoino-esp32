# Architecture

This document describes the system implemented in the current source tree. It separates runtime authority from presentation, simulation from firmware, and software behavior from unresolved physical safety.

## System boundary

Philcoino has four cooperating codebases:

1. an Expo/React Native app for discovery, pairing, monitoring, and user-requested changes;
2. a language-neutral OpenAPI 3.1.1 contract with strict TypeScript schemas;
3. a deterministic Bun/Hono device simulator for contract and UI development;
4. independent ESP-IDF C++ firmware that owns the machine state and heater command.

All communication is local-network HTTP. There is no cloud service, account system, remote internet API, Wi-Fi provisioning flow, pump control, or multi-device store.

```text
user
  |
Expo screen -> pairing/dashboard services -> DeviceApiClient
  |                                      |
SecureStore                         HTTP API v1
                                         |
                           +-------------+-------------+
                           |                           |
                    device simulator            ESP32 firmware
                    (development)                (authority)
                                                     |
                                      MAX6675 -> control -> SSR
                                                     |
                                               NVS + OLED
```

## Authority and dependency direction

The OpenAPI document defines the wire shape, but it does not own machine behavior. Firmware validates requests independently and is authoritative for:

- sensor validity and active temperature;
- persisted brew and steam targets;
- boot mode, readiness, steam timeout, and heating timeout;
- heater permission and SSR command timing;
- fault detection, latching, and dismissal eligibility.

The app owns local presentation and connectivity state. It may validate inputs for immediate feedback, but it does not calculate safe output, continue control after disconnect, or publish a requested mutation before acknowledgement.

The simulator implements the contract and selected product semantics with a manually advanced temperature model. It does not reproduce the firmware's ten-second duty curve, hardware I/O, task scheduling, mutex blocking, automatic sensor faults, or physical SSR behavior.

## API contract

`packages/protocol/openapi.yaml` is the language-neutral source of truth. It defines seven API operations, bearer security, strict object shapes, target limits, fault/error codes, and examples. The file uses JSON syntax, which is valid YAML 1.2.

`packages/protocol/src/schemas.ts` mirrors the contract as strict Zod schemas. Mobile and simulator imports come from `@philcoino/protocol`; firmware deliberately does not. C++ request parsing and serialization in `components/networking/src/api.cpp` must be kept aligned through tests and firmware contract captures.

Boundary rules:

- public: `GET /healthz` and `GET /api/v1/device`;
- authenticated: state and all mutations;
- unknown request/response fields are rejected;
- targets are whole numbers: brew 85–95°C, steam 110–120°C;
- fault state requires a fault object and `heaterActive: false`;
- `_simulator/*` is never part of API v1.

## Mobile runtime

### Composition

`app/_layout.tsx` configures the root Expo Router stack and theme. `app/index.tsx` renders `PairingScreen`, which owns the transition from unpaired discovery to an authenticated `DashboardScreen`.

The app has two device modes:

- real mode uses discovery, `DeviceApiClient`, SecureStore, and the ESP32/simulator HTTP API;
- debug mode (`EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1`) bypasses discovery, storage, authentication, and networking with an in-memory client.

### Discovery and pairing flow

```text
startup
  -> load strict SecureStore record
  -> inspect cached address /api/v1/device
  -> verify stable deviceId
  -> authenticate /api/v1/state
  -> connected
       or
     mDNS scan for saved deviceId
       -> inspect rediscovered address again
       -> authenticate with saved token
       -> persist new address only after success
```

Native discovery uses `react-native-zeroconf` behind `DeviceDiscovery`. iOS/Android resolve `_philcoino._tcp`; the generic implementation reports that manual entry is required. Resolved TXT data is parsed with `DeviceResponseSchema`; ports and candidate IPv4/host/IPv6 origins are normalized before use.

Manual entry and mDNS both converge on `inspectDevice`. Pairing then re-inspects the candidate identity before transmitting the token, calls authenticated state, and saves only after success. Restore treats authentication failures as meaningful instead of hiding them behind rediscovery.

The current identity check is a stable public ID, not cryptographic device authentication. This is a known security limitation documented in `SAFETY.md` and the codebase review.

### Transport and errors

`DeviceApiClient` receives a fetch implementation, normalizes one local HTTP origin, validates timeout/token configuration, and validates every request and response through protocol schemas. The Expo adapter supplies `expo/fetch`; tests supply deterministic fakes.

Each request combines a caller signal with a local timeout. The first abort cause is retained so cancellation is not misreported as timeout. Errors become `ApiClientError` kinds:

- `cancelled`, `timeout`, or `offline` for transport lifecycle;
- `not-found` for HTTP 404;
- `unauthorized` only for a consistent 401 contract error;
- `protocol` for non-JSON, wrong schemas, or inconsistent errors;
- `http` for a valid device rejection;
- `invalid-request` for locally invalid mutation input.

Connection mapping deliberately collapses some transport errors to `offline`, preserves not-found/unauthorized/protocol states, and ignores cancellation.

### Polling and mutations

`useMachineDashboard` creates one polling session and one mutation session while the route is focused. React Native `AppState` starts them only while the app is active and stops/aborts them in the background.

`DashboardPollingSession` performs completion-driven polling: the next one-second timer is scheduled only after the current request settles, so requests never overlap. Generation counters and `AbortController` prevent stopped/paused work from publishing. Failures clear the snapshot before changing connection state, so stale values are never labeled live.

`DashboardMutationSession` serializes all mutation kinds. It:

1. marks the selected mutation pending;
2. pauses and cancels polling;
3. sends one request;
4. updates state only from the validated response;
5. maps rejection separately from disconnection;
6. resumes polling after the current generation settles.

This prevents an older poll from overwriting an acknowledgement and prevents a timed-out request from appearing successful. Target edits remain local drafts until explicit confirmation.

## Simulator runtime

`createSimulator` wires a `SimulatorMachine` to Hono. Bearer middleware protects the same five authenticated operations as firmware. Parsing uses protocol schemas and emits contract-shaped errors.

The model holds persisted targets separately from volatile mode, temperatures, heater permission, fault, readiness, timeout, and uptime. Time never advances in the background. `POST /_simulator/advance` steps in bounded increments, which makes readiness and timeout tests deterministic. Power-cycle preserves targets; reset restores defaults.

Simulator-only routes can set readings, inject faults, advance time, power-cycle, or reset. They are test controls, not production capabilities. The model's simple move-toward-target behavior is intentionally unsuitable for firmware safety validation.

## Firmware runtime

### Layering

- `firmware_config` contains identity, GPIOs, ranges, timeouts, duty-curve constants, and diagnostic flags.
- `peripherals` defines pure interfaces/policies for MAX6675, target storage, SSR output, and SSD1306. `esp_peripherals.cpp` supplies GPIO/I2C/NVS implementations.
- `control` contains the pure `TemperatureController` state machine.
- `networking` contains the pure `FirmwareApi` plus ESP-IDF Wi-Fi/HTTP/mDNS adapters.
- `main/app_main.cpp` owns startup order, shared objects, mutex wiring, the sampling loop, display rendering, and network task creation.

### Startup and fail-off ordering

Firmware first constructs and initializes `FailOffSsr`, commanding the configured inactive level before and after GPIO output configuration. Any failure in identity, NVS, sensors, enabled OLED initialization/rendering, or synchronization commands off and aborts startup.

Targets load from one NVS blob. Missing targets initialize defaults; corrupt/invalid targets stop startup. The first sensor sample and optional display render happen before networking starts. Wi-Fi/API startup runs in a separate FreeRTOS task so a network failure does not intentionally stop temperature control.

The API and control loop share `TemperatureController` and `TargetStorage` behind one FreeRTOS mutex. The sampling loop currently waits indefinitely for that mutex; related real-time blocking risks are tracked as unresolved findings.

### Sensor and control state

`DualMax6675` enforces conversion timing, sequentially reads frames, rejects open/invalid/transport failures, and can mirror the brew reading when diagnostic single-sensor mode is configured. Current source sets `kDualThermocouplesEnabled = false`, so the brew channel controls both modes; this does not satisfy final dual-sensor acceptance.

`TemperatureController` boots in brew mode with volatile heater permission enabled. A valid update:

1. validates monitored readings and over-temperature limits;
2. applies the steam return timeout when active;
3. requires ±1°C stability for three seconds before `ready`;
4. tracks continuous heating demand toward a ten-minute timeout;
5. computes SSR duty inside a ten-second window;
6. returns a snapshot for API/OLED consumers.

Mode and target changes reset readiness, steam timing, demand tracking, recovery state, and the heater window. Targets are saved before becoming controller state. Steam timeout starts on first readiness and returns to brew after five minutes.

Sensor, over-temperature, heating-timeout, and internal faults latch and command the SSR off. Only over-temperature can be dismissed without a power cycle, and only when monitored readings are valid, the active temperature is back at target, and no hard limit remains exceeded.

### Networking

The ESP-IDF server connects as a Wi-Fi station, limits TX power when possible, registers reconnect handlers, serves port 80, and advertises identity through mDNS TXT records. `FirmwareApi` owns strict routing, constant-time length-aware bearer comparison, request parsing, controller/storage delegation, and response serialization.

Request bodies are capped at 256 bytes and authorization headers at 512 bytes. The current adapter reads bodies before authentication, waits indefinitely on repeated socket timeouts, and tears down HTTP if mDNS startup fails; these are known findings, not recommended patterns.

## Persistence and reset semantics

| State | Owner | Survives app restart | Survives device power cycle |
| --- | --- | --- | --- |
| Selected device ID/address/token | Mobile SecureStore | Yes | Not applicable |
| Brew/steam targets | Firmware NVS | Yes | Yes |
| Active mode | Firmware RAM | Yes while powered | No; boots brew |
| Heater permission | Firmware RAM | Yes while powered | No; boots enabled |
| Fault latch | Firmware RAM | Yes while powered | No; over-temperature may also be dismissed after cooldown |
| Dashboard samples/mutation feedback | Mobile component state | No | Not applicable |
| Simulator targets | Simulator process model | During simulated power-cycle | Reset endpoint restores defaults |

## Safety and security boundary

Software can command an output inactive; it cannot prove that an SSR, GPIO, wiring path, or heater is physically de-energized. Independent thermal cutoff, correct mains wiring, relay sizing/heat sinking, enclosure, grounding, and supervised validation remain outside software acceptance.

API v1 is plaintext local HTTP with a bearer token and public mDNS identity. The current threat model does not provide transport confidentiality, cryptographic device identity, strong-token enforcement, or authentication throttling. Treat the network as trusted only for development and follow [Safety](en/SAFETY.md).

## Verification boundaries

- Protocol tests detect OpenAPI/Zod/example drift.
- Simulator tests validate API/UI semantics under a simple deterministic model.
- Mobile tests validate strict parsing, restore, polling, mutation, and presentation helpers.
- Firmware host tests validate pure C++ configuration, peripherals, control, and API behavior.
- ESP-IDF builds validate target integration when the pinned toolchain is available.
- Only supervised physical tests can validate actual sensors, GPIO levels, relay behavior, thermal response, and independent cutoff.

No single green layer substitutes for the layers beneath it.
