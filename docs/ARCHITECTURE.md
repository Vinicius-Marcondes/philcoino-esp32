# Architecture

This document describes the system implemented in the current source tree. It separates runtime authority from presentation, simulation from firmware, and software behavior from unresolved physical safety.

## System boundary

Philcoino has five cooperating codebases:

1. an Expo/React Native app for discovery, pairing, monitoring, and user-requested changes;
2. a language-neutral OpenAPI 3.1.1 contract with strict TypeScript schemas;
3. a deterministic Bun/Hono device simulator for contract and UI development;
4. an offline Python thermal-modeling tool for CSV analysis, leakage-safe fitting, counterfactual simulation, and manually reviewed model export;
5. independent ESP-IDF C++ firmware that owns machine state and heater/pump command boundaries.

All communication is local-network HTTP. There is no cloud service, account system, remote internet API, Wi-Fi provisioning flow, or multi-device store. Firmware implements the API v2 extraction, compensation, and cooldown policies while retaining every temperature-only API v1 route.

```text
user
  |
Expo screen -> pairing/dashboard services -> DeviceApiClient
  |                                      |
SecureStore                       HTTP API v1 + v2
                                         |
                           +-------------+-------------+
                           |                           |
                    device simulator            ESP32 firmware
                    (development)                (authority)
                                                     |
                                      MAX6675 -> control -> heater SSR
                                                     |
                         pump controller -> GPIO10 command + NVS + OLED
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

`packages/protocol/openapi.yaml` is the language-neutral source of truth. It defines seven API v1/public operations plus seven API v2 operations, bearer security, strict object shapes, limits, fault/error codes, and examples. The file uses JSON syntax, which is valid YAML 1.2.

API v2 defines authenticated combined machine/extraction/compensation/cooldown
state, four-slot profile read/replace, and idempotent extraction and cooldown
Start/Stop shapes. Mobile, simulator, and firmware use these routes; API v1
remains unchanged and temperature-control-only. Contract, simulator, and
host-test agreement does not establish physical pump, heater, or cooling
behavior.

`packages/protocol/src/schemas.ts` mirrors the contract as strict Zod schemas. Mobile and simulator imports come from `@philcoino/protocol`; firmware deliberately does not. Firmware independently implements the contract through the bounded generic JSON boundary in `api_json.cpp`, typed machine and workflow codecs in `api_machine_codec.cpp` and `api_workflow_codec.cpp`, shared response/error helpers in `api_codec.cpp`, and firmware contract captures validated against the strict schemas.

Boundary rules:

- public: `GET /healthz` and `GET /api/v1/device`;
- authenticated: state and all mutations;
- unknown request/response fields are rejected;
- targets are whole numbers: brew 85–95°C, steam 110–120°C;
- fault state requires a fault object and `heaterActive: false`;
- `_simulator/*` is never part of API v1 or API v2.

## Mobile runtime

### Composition

`app/_layout.tsx` configures the root Expo Router stack and theme. `app/index.tsx` renders `PairingScreen`, which owns the transition from unpaired discovery to an authenticated `DashboardScreen`.

The app has two device modes:

- real mode uses discovery, `DeviceApiClient`, SecureStore, and the ESP32/simulator HTTP API;
- debug mode (`EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1`) bypasses discovery, storage, authentication, and networking with an in-memory client.

Debug mode uses the same API-v2 dashboard, extraction, compensation, and
cooldown paths through an in-memory client. The presentation is divided into
Dashboard, Profiles, and Machine pages with bottom navigation; active workflow
state remains reachable through a persistent navigation bar.

The native app supports portrait and both landscape directions. Portrait keeps
bottom navigation, while landscape uses a safe-area-aware three-dot gesture
rail and wider Pairing, Dashboard, Profiles, and Machine layouts. The rail
accepts taps, while vertically dominant swipes across the landscape screen
change pages. Taller content keeps scrolling until it reaches the matching
boundary, and horizontal graph gestures remain independent. Page content uses
a short direction-aware Reanimated fade-and-slide transition while the rail
stays fixed. Screen-orientation events keep the rail close to the plain edge and
retain the leading safe-area inset when the notch is beside it. Window-size
changes affect presentation only: polling and mutation sessions remain owned by
the mounted dashboard lifecycle. An app-level display preference can keep paired
foreground screens awake; it defaults off and releases when the app backgrounds
or the paired screen unmounts.

The production landscape Dashboard uses a three-column top row with
equal-height machine status, cooldown, and extraction cards. Its second row
gives boiler temperature one third of the width and the paged graph the
remaining two thirds. The compact quick-profile chooser overlays the lower
content instead of changing the control-row height; Manual spans its first row
and the four profile slots form a 2-by-2 grid beneath it. Compact landscape
omits the pump-command line and keeps a contextual Profiles or Machine action
beneath the selector while Start or Stop fills the adjacent column, avoiding
state-dependent card height changes. Portrait retains the full pump status and
blocker detail. Landscape Profiles gives the local editor the left half of the
workspace, then stacks the 2-by-2 profile chooser above sync in the right half.
Its compact duration steppers group minus, value, and plus in one rounded
control.

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

`useMachineDashboard` creates one polling session and one mutation session while
the route is focused. React Native `AppState` starts them only while the app is
active, pauses/aborts active work in the background without clearing the last
acknowledged snapshot, and resumes polling immediately on return. Retained data
is labeled refreshing and all mutations stay paused until a newly validated
combined snapshot arrives. Route blur/unmount still fully stops both sessions.

`DashboardPollingSession` performs completion-driven API v2 combined-state
polling: the next one-second timer is scheduled only after the current request
settles, so requests never overlap. One validated response publishes its nested
v1 machine snapshot and acknowledged extraction, compensation, and cooldown
state together. Generation
counters and `AbortController` prevent stopped/paused work from publishing.
Failures clear both live snapshots before changing connection state.

`DashboardMutationSession` serializes temperature, mode, heater, fault, complete
profile export, extraction Start/Stop, and cooldown Start/Stop mutations. It:

1. marks the selected mutation pending;
2. pauses and cancels polling;
3. sends one request;
4. updates state only from the validated response;
5. maps rejection separately from disconnection;
6. resumes polling after the current generation settles.

This prevents an older poll from overwriting an acknowledgement and prevents a timed-out request from appearing successful. Target edits remain local drafts until explicit confirmation.

The mobile four-slot profile set is stored independently from the selected
device record through a strict SecureStore-backed repository and seeded only on
first use. A focused profile synchronization session loads local and machine
sets independently, deduplicates and cancels remote reads, retries them on
focus/reconnection or explicit request, and serializes every local write under
monotonic revisions. Local edits and imports publish only after storage
succeeds; an older completion cannot replace a newer requested set.

Canonical ordered-set comparison drives synchronization status. Whole-set
export remains an acknowledged ESP32 mutation. Import performs a fresh
authenticated profile read, presents only changed slots for review, then
replaces the complete app-wide local set after explicit confirmation without
mutating firmware. Active extraction, stale connectivity, or conflicting
profile work blocks import; cooldown does not block this phone-only write.
Custom Start remains blocked until a current acknowledged machine set matches
the local set. A Start retry after an unacknowledged transport outcome reuses
its client-generated key. Cooldown uses the same rule; a definitive firmware
rejection clears the key so the next user request is fresh, while an unknown
transport outcome retains it for replay.

Each validated foreground poll also appends a device-scoped temperature-history
row to mobile SQLite. Rows include phone UTC capture time plus acknowledged
firmware uptime, temperature, targets, mode, heater permission/command, pump
command, status, fault context, and nullable passive prediction diagnostics.
The poll uses `GET /api/v2/state?include=prediction`; a one-time HTTP 404
capability fallback keeps older firmware usable through queryless API v2 state.
The repository retains only the current
local calendar day; background/offline periods and firmware uptime resets remain
explicit graph gaps. The Dashboard presents consecutive thirty-second Live
pages, while Machine can export every stored row for the current day. This
observational data never participates in firmware control and contains neither
bearer tokens nor network addresses.

Mobile compares each new row with the latest stored timestamp, firmware uptime,
boot/sequence provenance, and explicit gap marker. Only a detected discontinuity
starts a separate abortable history recovery session; uninterrupted foreground
polling never requests retained history. Recovery reads up to eight samples per
authenticated `GET /api/v2/history` page and yields between pages so live
polling and control traffic can interleave with backfill. Its
parser accepts legacy sixty-sample pages while new firmware and the simulator
emit no more than eight. The first
request/response midpoint anchors the page's firmware uptime to phone UTC for
the batch. SQLite commits
each page and its cursor atomically, identifies device rows by
`(deviceId, bootId, sequence)`, and replaces overlapping phone-origin rows.
HTTP 404 means older firmware and silently retains foreground-only history;
other failures are graph-scoped warnings. Backgrounding cancels recovery, and
the first new foreground row re-triggers it when the stored discontinuity is
still present. CSV export waits for an already-running recovery but does not
force an otherwise unnecessary full synchronization.

Firmware owns a RAM-only 600-sample history ring. One fixed-size sample of at
most 64 bytes is attempted per second after the current acknowledged control snapshot
and fail-off pump command are available. A delayed loop records only its actual
current sample. The writer never waits: a history-specific atomic guard skips
capture on contention, while a network reader copies at most eight samples
before releasing the guard and serializing JSON. A random 128-bit boot ID and
increasing sequence distinguish reboot, continuous, reset, and truncated
history without persisting anything to NVS.

Live graph pages use stable clock-aligned thirty-second windows. The newest
page follows incoming samples only while the user remains at the latest offset;
an older inspected window keeps its timestamp identity when live or recovered
samples are inserted. Each visible page uses five adaptive Y-axis ticks derived
from its boiler and target values, with padding and a minimum display range.
Raw current-day CSV export remains available from Machine and appends passive
prediction columns; older firmware and phone-originated rows leave them empty. Boot changes,
uptime/timestamp discontinuities, sequence skips, and truncated starts split
graph segments rather than drawing or interpolating unavailable intervals.

## Simulator runtime

`createSimulator` wires a `SimulatorMachine` to Hono. Bearer middleware protects
the five API v1 mutations/state operations and all API v2 state, profile,
extraction, and cooldown operations. Parsing uses protocol schemas and emits
version-appropriate strict errors.

The deterministic model also captures the same one-Hertz rolling history,
eight-sample pagination, overflow, boot reset, and full command/fault context.
Simulator time remains manually advanced; it does not create background samples.

The model holds persisted targets and the four-slot profile set separately from
volatile mode, temperatures, heater permission, faults, extraction/idempotency,
readiness, timeouts, and uptime. Time never advances in the background.
`POST /_simulator/advance` steps temperature, extraction, and cooldown state in
bounded increments, which makes phases, threshold completion, the 45-second
cutoff, five-second stabilization, readiness, and timeout boundaries
deterministic. Power-cycle preserves targets/profiles and resets both workflows
idle; reset restores all defaults.

Simulator `boilerTemperatureC` is already the effective logical control value.
The simulator does not add the firmware Steam offset, model separate
boiler-base and upper-boiler temperatures, or provide calibration evidence.

Simulator-only routes can set readings, inject faults or the next profile-save
failure, advance time, power-cycle, or reset. They are test controls, not
production capabilities. The model's simple move-toward-target and extraction
timeline behavior are intentionally unsuitable for firmware/GPIO safety
validation.

## Firmware runtime

### Layering

- `firmware_config` contains identity, GPIOs, ranges, timeouts, duty-curve constants, and diagnostic flags.
- `peripherals` defines pure interfaces/policies for MAX6675, target/profile storage, independent heater SSR and pump command outputs, and SSD1306. `esp_peripherals.cpp` supplies GPIO/I2C/NVS implementations.
- `control` contains the pure `TemperatureController` state machine.
- `networking` separates bounded generic JSON syntax, typed machine/workflow codecs, immutable response serialization, authoritative route/access metadata, `FirmwareApi` controller/storage orchestration, and ESP-IDF Wi-Fi/HTTP/mDNS transport adapters.
- `main/app_main.cpp` owns startup order, shared objects, mutex wiring, the sampling loop, display rendering, and network task creation.

### Startup and fail-off ordering

Firmware first constructs and initializes `FailOffPump` on active-high GPIO10, commanding low before and after GPIO output configuration. It then initializes the independent heater `FailOffSsr` with its existing safety lease. Pump initialization failure aborts immediately; later critical startup failures retain/attempt the pump-off and heater-off commands.

`ExtractionController` owns Manual cutoff, immutable active profile snapshots,
pre-infusion/soak/main deadlines, replay/conflict behavior, and Stop.
`CooldownController` owns the snapshotted Brew threshold, ordered heater-inhibit
then pump command, 45-second cutoff, five-second stabilization, replay, Stop,
terminal outcome, and reset behavior. One high-priority 10 ms workflow task
advances the mutually exclusive policies with wrap-safe monotonic time and
hands the acknowledged extraction phase to temperature control.

Temperature, extraction, and cooldown share one non-recursive 50 ms workflow
mutex; the legacy API domain labels intentionally alias that boundary, so there
is no cross-domain lock order. Sensor SPI reads, target/profile NVS, OLED
rendering, Wi-Fi reads, JSON serialization, and HTTP response transmission stay
outside it. A missed acquisition immediately attempts both command outputs off
and posts an atomic fail-safe request; the next owner latches an internal fault,
ends extraction, and aborts active cooldown. The GPTimer safety lease separately
bounds a firmware-commanded heater-high pulse if normal controller renewal
stalls. None of these command paths confirm physical de-energization.

Targets and the ordered four-slot extraction profile set load from separate one-key NVS blobs. Missing data initializes validated defaults; corrupt/invalid data stops startup. A profile replacement is validated as a complete set before its single blob commit, so firmware never deliberately publishes a partially replaced set. The first sensor sample and optional display render happen before networking starts. Wi-Fi/API startup runs in a separate FreeRTOS task so a network failure does not intentionally stop temperature control.

The API and control loops share controller snapshots behind the bounded workflow
domain. Target updates first validate and command heater off under the boundary,
perform synchronous NVS outside it, then reacquire it to acknowledge the
persisted targets. Profile persistence likewise occurs outside the real-time
boundary. Remaining timing, watchdog, target-runtime, and physical-output risks
stay tracked as unresolved findings.

### Sensor and control state

`Max6675` enforces conversion timing and rejects open, invalid, or
transport-failed frames from the permanent boiler-base thermocouple. The
controller also rejects non-finite values before conversion. One controller-owned
path then defines the active temperature: the validated raw reading in Brew and
that raw reading plus the compile-time `kSteamTemperatureOffsetC = 5` correction
in Steam. No API, OLED, mobile, simulator, or persistence caller adds another
correction.

`TemperatureController` boots in brew mode with volatile heater permission enabled. A valid update:

1. validates the raw boiler reading status and finite numeric value;
2. derives the active temperature once for the current mode;
3. applies the active-mode over-temperature limit and steam return timeout;
4. requires ±1°C stability for three seconds before `ready`;
5. tracks active-temperature heating demand toward a ten-minute timeout;
6. computes SSR duty and recovery inside a ten-second window;
7. calculates filtered temperature, slope, recent command activity, and fixed
   linear 5/10/20-second predictions after thirty seconds of valid history;
8. records the prediction and hypothetical duty reduction without applying it;
9. returns the same active effective value to API and OLED consumers.

The primary heater controller remains the existing nonlinear duty curve; it is
not a PID. The prediction monitor runs in passive mode only. Its fixed-size
history belongs to control policy and is distinct from the observational API
history. Invalid configuration, checksum, timing, sensor state, bounds, slope,
or prediction disables diagnostics with a specific fallback reason. No
prediction value participates in the SSR command, readiness, timeout, or fault
path in this release.

Mode and target changes reset readiness, steam timing, demand tracking, recovery state, and the heater window. Targets are saved before becoming controller state. Steam timeout starts on first readiness and returns to brew after five minutes.

During Brew extraction, the controller derives a private heater-duty target.
Pre-infusion uses a fixed `0°C` bias, Manual and profile main extraction use
`min(brewTargetC + 2°C, brewOverTemperatureC - 1°C)`, and soak/idle use no
compensation. Only duty demand/pulse calculations see this value; persisted and
displayed targets, readiness, recovery ownership, safety deadlines,
over-temperature limits, and profile data retain the base target. API v2 exposes
only whether this fixed policy is active and its eligible phase.

Cooldown Start requires a valid Brew-effective raw sample above the current Brew
target, no fault, and idle extraction/cooldown. Firmware snapshots the target,
switches to Brew, establishes a separate heater inhibit and heater-off command,
then requests the pump-running command. The first validated sample at/below the
snapshot, 45 seconds, or Stop requests pump off and begins exactly five seconds
of heater-inhibited stabilization. User heater permission is never changed;
reset/power loss never resumes the RAM-only workflow.

Consequently, a valid raw `115°C` reading is controlled and published as
`120°C` in Steam and as `115°C` in Brew. A mode acknowledgement can change
`boilerTemperatureC` and the OLED value by exactly `5°C` without a new sensor
sample. This is an owner-selected correction pending repeatable instrumented
physical validation, not proof of the upper-boiler temperature.

Sensor, over-temperature, heating-timeout, and internal faults latch and command the SSR off. Only over-temperature can be dismissed without a power cycle, and only when the boiler reading is valid, the temperature is back at the active target, and the active mode limit is clear.

### Networking

The ESP-IDF server connects as a Wi-Fi station, limits TX power when possible, registers reconnect handlers, serves port 80, and advertises identity through mDNS TXT records. One immutable route table in `api_routes.cpp` owns method/path/access metadata for HTTP registration, pre-body access checks, and `FirmwareApi` dispatch. `FirmwareApi` retains constant-time length-aware bearer comparison and explicit controller/storage orchestration; pure codec modules parse and serialize without locks, persistence, controller mutation, output access, or network I/O.

The ESP-IDF adapter owns the 512-byte authorization-header limit, 1,024-byte request-body limit, two-second absolute body deadline, bounded timeout count, and response/challenge transmission. Protected requests are authenticated before their bodies are read. HTTP remains available if mDNS advertisement fails, so direct/manual address access remains usable.

## Persistence and reset semantics

| State | Owner | Survives app restart | Survives device power cycle |
| --- | --- | --- | --- |
| Selected device ID/address/token | Mobile SecureStore | Yes | Not applicable |
| Brew/steam targets | Firmware NVS | Yes | Yes |
| Mobile extraction profiles | Mobile SecureStore | Yes | Not applicable |
| Keep-screen-awake preference | Mobile local key-value storage | Yes | App-level; independent of the selected machine |
| Firmware extraction profiles | Firmware NVS | Not applicable | Yes |
| Pump GPIO10 command | Firmware RAM/GPIO | Reflected while connected | No; boots `off` |
| Extraction/cooldown identity, phase, deadlines, outcome | Firmware RAM | Reflected while connected | No; both boot idle and cooldown history is cleared |
| Extraction duty compensation | Derived firmware policy | Reflected while eligible | No persisted setting; recomputed from acknowledged phase |
| Active mode | Firmware RAM | Yes while powered | No; boots brew |
| Heater permission | Firmware RAM | Yes while powered | No; boots enabled |
| Fault latch | Firmware RAM | Yes while powered | No; over-temperature may also be dismissed after cooldown |
| Current-day Dashboard temperature samples | Mobile SQLite | Yes, until local-day pruning or the machine is forgotten | Not applicable |
| Dashboard mutation feedback | Mobile component state | No | Not applicable |
| Simulator targets | Simulator process model | During simulated power-cycle | Reset endpoint restores defaults |

## Safety and security boundary

Software can command an output inactive; it cannot prove that an SSR, GPIO, wiring path, or heater is physically de-energized. Independent thermal cutoff, correct mains wiring, relay sizing/heat sinking, enclosure, grounding, and supervised validation remain outside software acceptance.

API v1/v2 use plaintext local HTTP with a bearer token and public mDNS identity. The current threat model does not provide transport confidentiality, cryptographic device identity, strong-token enforcement, or authentication throttling. Treat the network as trusted only for development and follow [Safety](en/SAFETY.md).

## Verification boundaries

- Protocol tests detect OpenAPI/Zod/example drift.
- Simulator tests validate API/UI semantics under a simple deterministic model.
- Mobile tests validate strict parsing, restore, polling, mutation, and presentation helpers.
- Firmware host tests validate pure C++ configuration, peripherals, control, and API behavior.
- ESP-IDF builds validate target integration when the pinned toolchain is available.
- Only supervised physical tests can validate actual sensors, GPIO levels, relay behavior, thermal response, and independent cutoff.

No single green layer substitutes for the layers beneath it.
