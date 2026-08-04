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
                         pump controller -> GPIO10 command + NVS
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

`packages/protocol/openapi.yaml` is the language-neutral source of truth. It defines seven API v1/public operations plus the additive API v2 workflow, history, and scale operations, bearer security, strict object shapes, limits, fault/error codes, and examples. The file uses JSON syntax, which is valid YAML 1.2.

API v2 defines authenticated combined machine/extraction/compensation/cooldown
state, four-slot profile read/replace, idempotent extraction and cooldown
Start/Stop shapes, and a firmware-owned temperature-calibration transaction.
Mobile, simulator, and firmware use these routes; API v1 remains compatible and
temperature-control-only. Contract, simulator, and host-test agreement does not
establish physical pump, heater, steam, cooling, or calibration accuracy.

`packages/protocol/src/schemas.ts` mirrors the contract as strict Zod schemas. Mobile and simulator imports come from `@philcoino/protocol`; firmware deliberately does not. Firmware independently implements the contract through the bounded generic JSON boundary in `api_json.cpp`, typed machine and workflow codecs in `api_machine_codec.cpp` and `api_workflow_codec.cpp`, shared response/error helpers in `api_codec.cpp`, and firmware contract captures validated against the strict schemas.

Boundary rules:

- public: `GET /healthz` and `GET /api/v1/device`;
- authenticated: state and all mutations;
- unknown request/response fields are rejected;
- targets are whole numbers: brew 85–95°C, steam 110–135°C;
- temperature calibration uses a raw whole-degree candidate from 90–120°C and
  one signed persisted offset from -20–10°C;
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

Scale polling has a separate completion-driven session with at most one request
in flight. Its next timer uses the latest validated scale acknowledgement:
one second while the Scale page is hidden and no weighted extraction is active,
or 250 ms while the Scale page is visible or the acknowledged scale state
reports a weighted extraction. Manual and timed extraction do not increase the
scale cadence, and a failed hidden-page request falls back to one second without
retaining stale weighted state.

Weighted trace synchronization is a second completion-driven, non-overlapping
session. It commits each page before advancing the durable
extraction/boot/sequence cursor, aborts on backgrounding, and resumes backfill
after reconnection. Firmware 404 permanently selects the legacy scale and
temperature-graph path for that session. The phone derives beverage mass flow
from raw net weight with a causal one-second regression and resets across every
identity, sequence, availability, or null-weight discontinuity.

`DashboardMutationSession` serializes temperature, mode, heater, fault, complete
profile export, extraction Start/Stop, and cooldown Start/Stop mutations. It:

1. marks the selected mutation pending;
2. pauses and cancels polling;
3. sends one request;
4. updates state only from the validated response;
5. maps rejection separately from disconnection;
6. resumes polling after the current generation settles.

This prevents an older poll from overwriting an acknowledgement and prevents a timed-out request from appearing successful. Target edits remain local drafts until explicit confirmation.

The focused Machine-page Temperature Calibration modal uses a separate
`TemperatureCalibrationSession`. It serializes status, Start, candidate, Save,
and Cancel, polls only while the modal and app are active, and presents only
validated firmware acknowledgements. Backgrounding, navigation, disconnection,
terminal expiry, or a conflicting failure discards the unsaved candidate or
relies on the firmware's bounded inactivity lease. The UI never commands the
pump or valve, never detects steam, and requires the user to operate the wand
and explicitly confirm Save.

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
command, status, and fault context. Polling uses only queryless
`GET /api/v2/state`; there is no prediction capability probe or fallback.
The repository retains only the current
local calendar day; background/offline periods and firmware uptime resets remain
explicit graph gaps. The Dashboard presents consecutive thirty-second Live
pages in the same telemetry surface used for weighted extraction traces. In
temperature-history mode, the upper band renders only acknowledged boiler and
target samples, the current scale state supplies the weight metric, and the
lower band explicitly marks weight history and derived flow unavailable. A
weighted trace populates that unchanged surface with retained weight and
app-derived beverage flow, so extraction state changes do not replace or
restyle the graph. Machine can export every stored temperature row for the
current day. This observational data never participates in firmware control
and contains neither bearer tokens nor network addresses.

Mobile compares each new row with the latest stored timestamp, firmware uptime,
boot/sequence provenance, and explicit gap marker. Only a detected discontinuity
starts a separate abortable history recovery session; uninterrupted foreground
polling never requests retained history. Recovery reads up to eight samples per
authenticated `GET /api/v2/history` page and yields between pages so live
polling and control traffic can interleave with backfill. Its
strict parser accepts no more than eight samples. The first
request/response midpoint anchors the page's firmware uptime to phone UTC for
the batch. SQLite commits
each page and its cursor atomically, identifies device rows by
`(deviceId, bootId, sequence)`, and replaces overlapping phone-origin rows.
HTTP 404 means older firmware and silently retains foreground-only history;
other failures are graph-scoped warnings. Backgrounding cancels recovery, and
the first new foreground row re-triggers it when the stored discontinuity is
still present. CSV export waits for an already-running recovery but does not
force an otherwise unnecessary full synchronization.

Firmware owns a RAM-only 600-sample history ring. One 40-byte fixed-size sample
is attempted per second after the current acknowledged control snapshot
and fail-off pump command are available. A delayed loop records only its actual
current sample. The writer never waits: a history-specific atomic guard skips
capture on contention, while a network reader copies at most eight samples
plus the current controller configuration before releasing the guard and
serializing JSON within the 8 KiB response budget. A random 128-bit boot ID and
increasing sequence distinguish reboot, continuous, reset, and truncated
history without persisting anything to NVS.

Live graph pages use stable clock-aligned thirty-second windows. The newest
page follows incoming samples only while the user remains at the latest offset;
an older inspected window keeps its timestamp identity when live or recovered
samples are inserted. Each visible page uses five adaptive Y-axis ticks derived
from its boiler and target values, with padding and a minimum display range.
Raw current-day CSV export remains available from Machine. Recovered device
rows append controller/build/gain/filter/window, PI/legacy request,
contribution, saturation, command, phase, and operating-mode columns.
Foreground-only rows leave those nullable fields empty. SQLite schema v5
rebuilds prior local history transactionally, preserving ordinary rows and
provenance while discarding prediction JSON. Boot changes, uptime/timestamp
discontinuities, sequence skips, and truncated starts split graph segments
rather than drawing or interpolating unavailable intervals.

## Simulator runtime

`createSimulator` wires a `SimulatorMachine` to Hono. Bearer middleware protects
the five API v1 mutations/state operations and all API v2 state, profile,
extraction, and cooldown operations. Parsing uses protocol schemas and emits
version-appropriate strict errors.

The deterministic model also captures the same one-Hertz rolling history,
eight-sample pagination, overflow, boot reset, and full command/fault context.
Simulator time remains manually advanced; it does not create background samples.

The model holds persisted targets, the four-slot profile set, and the signed
temperature calibration separately from volatile mode, raw temperature,
heater permission, faults, workflows/idempotency, readiness, timeouts, and
uptime. Time never advances in the background.
`POST /_simulator/advance` steps temperature, extraction, and cooldown state in
bounded increments, which makes phases, threshold completion, the 45-second
cutoff, five-second stabilization, readiness, and timeout boundaries
deterministic. Power-cycle preserves targets, profiles, and calibration while
reset restores their defaults and clears calibration.

The simulator stores one raw boiler temperature and derives
`boilerTemperatureC = rawTemperatureC + temperatureOffsetC` exactly once for
both modes. Its calibration transaction controls the raw candidate from
90–120°C, persists `100 - candidate`, reports offset-adjusted target bounds,
and permits each independent effective-Steam and raw reading through `135°C`.
Either reading strictly above that cap latches the simulated fault.
These logical values do not model separate boiler-base/upper-boiler
temperatures or provide physical calibration evidence.

Simulator-only routes can set readings, inject faults or the next profile-save
failure, advance time, power-cycle, or reset. They are test controls, not
production capabilities. The model's simple move-toward-target and extraction
timeline behavior are intentionally unsuitable for firmware/GPIO safety
validation.

## Firmware runtime

### Layering

- `firmware_config` contains identity, GPIOs, ranges, timeouts, duty-curve constants, and diagnostic flags.
- `peripherals` defines pure interfaces/policies for MAX6675, HX711, target/profile/calibration storage, and independent heater SSR and pump command outputs. `esp_peripherals.cpp` supplies GPIO/NVS implementations.
- `control` contains the pure temperature, scale, extraction, and cooldown state machines.
- `networking` separates bounded generic JSON syntax, typed machine/workflow codecs, immutable response serialization, authoritative route/access metadata, `FirmwareApi` controller/storage orchestration, and ESP-IDF Wi-Fi/HTTP/mDNS transport adapters.
- `main/app_main.cpp` owns startup order, shared objects, mutex wiring, the sampling loop, and network task creation.

The default-off `PHILCOINO_PERFORMANCE_DIAGNOSTICS` build option adds no public
API. When explicitly enabled for supervised target measurement, fixed-size
atomic counters/histograms observe loop timing, workflow-mutex exposure, scale
outcomes, API latency/request heap, task stack high-water, reset cause,
internal-heap state, and task-side heater-lease trips. Hot paths do not log or
persist measurements; a dedicated low-priority task emits a bounded serial
summary once per minute, and neither application ISR is modified.

### Startup and fail-off ordering

Firmware first constructs and initializes `FailOffPump` on active-high GPIO10, commanding low before and after GPIO output configuration. It then initializes the independent heater `FailOffSsr` with its existing safety lease. Pump initialization failure aborts immediately; later critical startup failures retain/attempt the pump-off and heater-off commands.

`ExtractionController` owns Manual cutoff, immutable active profile snapshots,
pre-infusion/soak/main deadlines, replay/conflict behavior, and Stop.
For weighted profile starts it also owns automatic tare, integer-decigram
cutoff, scale-failure fallback to the immutable profile deadline, warning
gating, and the retained terminal scale record. `ScaleController` owns rolling
filter/stability state and the atomically persisted two-point calibration.
`CooldownController` owns the snapshotted Brew threshold, ordered heater-inhibit
then pump command, 45-second cutoff, five-second stabilization, replay, Stop,
terminal outcome, and reset behavior. One high-priority 10 ms workflow task
advances the mutually exclusive policies with wrap-safe monotonic time and
hands the acknowledged extraction phase to temperature control.

The temperature owner retains a fixed 500 ms FreeRTOS wake deadline using the
ESP-IDF 6 `xTaskDelayUntil` API. Deadline-relative lateness is recorded in the
bounded default-off diagnostics without hot-path logging. If work overruns more
than one period, elapsed deadline slots are skipped on the same fixed grid so
the MAX6675 is not immediately reread during scheduler catch-up. Task priority,
history cadence, and the independent 1,500 ms heater lease remain unchanged.
PRD-016 replaces passive prediction with a bounded Brew PI candidate while
retaining the same owner and schedule.

Temperature, extraction, and cooldown share one non-recursive 50 ms workflow
mutex; the legacy API domain labels intentionally alias that boundary, so there
is no cross-domain lock order. Sensor reads, target/profile NVS, Wi-Fi reads,
JSON serialization, and HTTP response transmission stay
outside it. A missed acquisition immediately attempts both command outputs off
and posts an atomic fail-safe request; the next owner latches an internal fault,
ends extraction, and aborts active cooldown. The GPTimer safety lease separately
bounds a firmware-commanded heater-high pulse if normal controller renewal
stalls. None of these command paths confirm physical de-energization.

Targets and the ordered four-slot extraction profile set load from separate one-key NVS blobs. Missing data initializes validated defaults; corrupt/invalid data stops startup. A profile replacement is validated as a complete set before its single blob commit, so firmware never deliberately publishes a partially replaced set. The first sensor sample happens before networking starts. Wi-Fi/API startup runs in a separate FreeRTOS task so a network failure does not intentionally stop temperature control.

HX711 reads run in a separate low-priority sampling task and publish through the
same bounded workflow synchronization boundary. After one immediate read, a
falling edge on HX711 DOUT wakes that task; the IRAM GPIO ISR only posts a
coalescing task notification, while GPIO clocking, filtering, logging, and
publication remain in task context. A 750 ms notify timeout preserves bounded
unavailable detection for a missing or disconnected scale. `NotReady` reads do
not enter the workflow mutex or publish to `ScaleController`; accepted samples
refresh the cached median, spread, stability, and calibrated weight once, and
consumer snapshots apply only O(1) age/availability gating. This does not block
temperature control or ordinary Manual/timed extraction.
Scale calibration has its own NVS blob; completion prepares an immutable tokenized
candidate under the workflow mutex, saves it after unlocking, then reacquires
the mutex to adopt that exact candidate. Save failure retains the previous
calibration for retry. A save that cannot be acknowledged remains pending and
blocks weighted Start until the same transaction is recovered; Cancel cannot
clear that pending adoption. Invalid/missing scale calibration disables weighted
Start without preventing machine startup.

Temperature calibration uses a separate versioned NVS record. A missing record
is valid uncalibrated state with a `0°C` offset; corrupt or unreadable storage
latches an internal fault and keeps the heater command off. Save prepares the
candidate under the workflow mutex, persists it outside the mutex, then adopts
the exact persisted candidate under the mutex. A persistence failure retains
the previous offset and targets.

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
path then defines the effective temperature in both modes by adding the one
persisted signed global offset exactly once. A missing record contributes
`0°C`; no mode-specific correction remains. Raw validation and the independent
raw ceiling occur before offset correction, and no API, mobile, simulator, or
persistence caller adds another correction.

`TemperatureController` boots in brew mode with volatile heater permission enabled. A valid update:

1. validates the raw boiler reading status and finite numeric value;
2. derives effective temperature once from the validated raw reading and saved
   offset;
3. applies the active-mode effective over-temperature limit, the independent
   raw ceiling, and the Steam return timeout;
4. requires ±1°C stability for three seconds before `ready`;
5. tracks active-temperature heating demand toward a ten-minute timeout;
6. calculates both the legacy nonlinear requested duty and a fixed-gain PI
   candidate from a bounded EMA-filtered Brew error;
7. selects exactly one Brew requested-duty authority at compile time and routes
   it through the existing ten-second SSR window and minimum-pulse policy;
8. records strict controller configuration, PI/legacy requested duty,
   contribution/state/saturation, and acknowledged command context;
9. returns the same active effective value to ordinary API consumers.

`CONFIG_PHILCOINO_BREW_PI_CONTROL` defaults off. In that build the legacy curve
remains authoritative and the PI result is shadow-only; arbitrary shadow output
cannot change commands, readiness, faults, timeouts, extraction, cooldown, or
persistence. When explicitly enabled, PI owns requested duty only in Brew.
Steam always retains the legacy curve and uses the same global effective
temperature as Brew. The PI uses
the fixed 500 ms interval, Kp `0.08`, Ki `0.01`, EMA alpha `0.25`, bounded
integral state, and conditional anti-windup. Invalid readings/timing, mode or
target changes, phase changes, inhibition, permission, faults, safety-lease
trips, and output failures reset/freeze or dominate PI as appropriate.
Changing authority or constants requires a new build and does not become
accepted control without pinned-target and supervised physical A/B evidence.

Mode and target changes reset readiness, demand tracking, recovery state, and
the heater window. Targets are saved before becoming controller state. On the
first Steam entry of a heat-soak episode, firmware records a volatile monotonic
origin and calculates:

```text
appliedCompensationC =
  initialCompensationC × max(0, 1 - elapsedMs / decayDurationMs)
steamControlTemperatureC =
  boilerTemperatureC + appliedCompensationC
```

The estimate owns Steam demand, duty, recovery, readiness, status and the
post-ready timeout start. `boilerTemperatureC` remains the globally calibrated
sensor value, and raw/effective over-temperature checks run without the
transient term. Leaving Steam preserves the origin until the effective sensor
reading reaches the Brew target or below; reboot clears it. Persisted setting
changes force heater command off before NVS, preserve active heat-soak and
ready-timeout origins, and recalculate the timeout against its original
ready timestamp.

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

Consequently, one valid raw sample plus one saved offset produces the same
effective `boilerTemperatureC` in Brew and Steam. For example, raw boiling
observed at `108°C` saves `-8°C`, so that raw point is controlled and published
as effective `100°C` in either mode. This is a user-observed rebasing result,
not proof of boiling-point accuracy or upper-boiler temperature.

Sensor, over-temperature, heating-timeout, and internal faults latch and command the SSR off. Only over-temperature can be dismissed without a power cycle, and only when the boiler reading is valid, the temperature is back at the active target, and the active mode limit is clear.

### Networking

The ESP-IDF server connects as a Wi-Fi station, limits TX power when possible, registers reconnect handlers, serves port 80, and advertises identity through mDNS TXT records. One immutable route table in `api_routes.cpp` owns method/path/access metadata for HTTP registration, pre-body access checks, and `FirmwareApi` dispatch. `FirmwareApi` retains constant-time length-aware bearer comparison and explicit controller/storage orchestration; pure codec modules parse and serialize without locks, persistence, controller mutation, output access, or network I/O.

The ESP-IDF adapter owns the 512-byte authorization-header limit, 1,024-byte request-body limit, two-second absolute body deadline, bounded timeout count, and response/challenge transmission. Protected requests are authenticated before their bodies are read. HTTP remains available if mDNS advertisement fails, so direct/manual address access remains usable.

## Persistence and reset semantics

| State | Owner | Survives app restart | Survives device power cycle |
| --- | --- | --- | --- |
| Selected device ID/address/token | Mobile SecureStore | Yes | Not applicable |
| Brew/steam targets | Firmware NVS | Yes | Yes |
| Temperature calibration offset/status | Firmware NVS | Yes | Yes; missing record is uncalibrated `0°C`, corrupt/unreadable storage faults |
| Steam compensation/decay/ready-timeout settings | Firmware NVS | Yes | Yes; missing record persists `12°C`/`12 min`/`5 min` defaults, invalid storage fails off |
| Active Steam heat-soak origin | Firmware RAM | Reflected while powered | No |
| Mobile extraction profiles | Mobile SecureStore | Yes | Not applicable |
| Keep-screen-awake preference | Mobile local key-value storage | Yes | App-level; independent of the selected machine |
| Firmware extraction profiles | Firmware NVS | Not applicable | Yes |
| Scale calibration | Firmware NVS | Not applicable | Yes |
| Per-profile weight defaults | Mobile SecureStore | Yes | Not applicable |
| Weighted-shot history (90 days) | Mobile SQLite | Yes | Not applicable |
| Active/last weighted extraction and fallback warning | Firmware RAM | Reflected while connected | No |
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
