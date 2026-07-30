# Side notes

This file tracks important unresolved topics that should remain visible without blocking software and protocol planning.

## Independent heater cutoff

Status: OWNER-REPORTED INSTRUMENTED ACCEPTANCE 2026-07-16 — DESIGN RISK RETAINED

The current heater design relies on the ESP32-C3 and a single FOTEK SSR-40 DA to interrupt power to the 800 W, 127 VAC boiler heater. This is not fail-safe because an SSR can fail with its output shorted; software cannot turn off a shorted output.

The plan is to retain the espresso machine's original over-temperature
thermostat. The owner now identifies the retained component from a marketplace
listing as nominally `145°C`, 10 A, 250 V; that listing is not installed-unit
trip, tolerance, wiring, coupling, or interruption evidence. It can provide the
required independent cutoff only if the exact installed part is correctly wired
in series with the heater and opens the load even when the SSR output is
shorted.

On 2026-07-16, the owner reported that the energy controls and related
electrical behavior were checked with technical equipment and looked correct,
and accepted the tested hardware configuration. Raw component identifiers,
ratings, calibration records, traces, and setup photographs were not committed.
The Human check is complete at owner-reported evidence level, but the
single-SSR failure mode and need for an independent series cutoff remain design
constraints rather than a certification claim.

This concern remains visible as an architecture/safety limitation and does not
block the approved software/API scope in PRD-001.

## PRD-003 Steam temperature correction validation

Status: HISTORICAL — SUPERSEDED BY PRD-017

STEAM-004 Human acceptance on 2026-07-16 remains a historical record for the
then-tested fixed `+5°C` Steam-only correction. PRD-017 removes that correction
from current runtime behavior and replaces it with one persisted signed global
offset applied exactly once in Brew and Steam.

On 2026-07-16, Vinicius reported that every implemented feature and the
energy-control behavior were tested with technical equipment and looked
correct. He accepted the tested configuration and retained the fixed `+5°C`
correction without requesting a calibration change. Raw paired readings,
instrument/calibration identifiers, probe/setup details, and exact build
identifiers were not committed, so the evidence is owner-reported and is not
certification. Existing single-sensor and source-review limitations remain
engineering risks rather than pending STEAM-004 Human work.

## PRD-017 guided temperature calibration

Status: SOFTWARE IMPLEMENTED THROUGH TCAL-008 — PHYSICAL ACCEPTANCE PENDING

The firmware-owned workflow controls a temporary uncorrected raw target, starts
at `100°C`, accepts whole-degree candidates from `90–120°C`, and saves
`temperatureOffsetC = 100 - candidateRawTargetC` atomically in a dedicated NVS
record. The effective temperature is raw plus that offset exactly once in Brew
and Steam. Missing storage is valid uncalibrated `0°C`; corrupt or unreadable
storage faults and keeps the heater command off.

The user manually opens the steam wand and decides when boiling is observed.
The app and firmware do not command the pump/valve or detect steam. Simulator,
protocol, mobile, host, sanitizer, and contract-capture checks are software
evidence only. They cannot establish the local boiling point, sensor accuracy,
repeatability, heater current interruption, or the installed thermostat path.

The Steam target range is `110–135°C`. Effective Steam and raw temperatures
are each permitted through the inclusive `135°C` cap; either reading strictly
above it independently latches `over_temperature` and commands the heater off.
Offset-dependent targets whose implied raw value exceeds `135°C` remain
rejected without clamping. TCAL-009 retains the separately authorized physical
acceptance.

## PRD-011 HX711 scale validation

Status: SOFTWARE IMPLEMENTED — PHYSICAL VALIDATION PENDING

The implementation assigns the 3.3 V HX711 to DT GPIO0 and SCK GPIO1, stores
two-point calibration in a dedicated NVS blob, and keeps sampling outside the
temperature-control loop. Weighted profile Start requires a calibrated,
available, stable reading, captures tare, and starts the pump without a second
confirmation. Scale loss after Start falls back to the profile's original
deadline and gates the next weighted Start until acknowledgement.

Protocol, simulator, mobile, and C++ host checks do not establish 0.1 g
accuracy, load-cell polarity, mechanical mounting, drift, boot-pin behavior,
data-ready cadence, or electrical noise. Disconnected low-voltage checks around
0/35/100 g, automatic tare, reset/power-cycle, injected disconnection, and
saturation remain Human work. Energized drip-compensation tuning is not
authorized by this implementation.

## PRD-004 extraction compensation and cooldown validation

Status: COMPLETE — HUMAN ACCEPTED 2026-07-16

Firmware uses the owner-selected `+2°C` bias only for Manual and profile-main
heater-duty calculations, with `0°C` during pre-infusion and no compensation in
soak/idle. The private duty target is clamped to one degree below the Brew
over-temperature limit. Persisted/displayed targets, readiness, safety
deadlines, recovery ownership, limits, and profiles remain unchanged.

Cooldown is volatile and firmware-owned. It snapshots the Brew target, switches
to Brew, establishes the separate heater inhibit and heater-off command before
requesting pump running, stops that command at the target/45 seconds/Stop, then
holds command-off/inhibit state for five seconds. User heater permission remains
independent. Same-key replay retains the original workflow; reset/power loss
never resumes it.

Protocol, simulator, mobile, strict C++ host tests, and firmware captures prove
only their software layers. `running`, `off`, `heaterActive`, and
`heaterInhibited` do not prove flow, water use, current, cooling, SSR state,
switch position, or de-energization. The target build was unavailable during
Agent verification because `idf.py`/`IDF_PATH` were absent; no toolchain was
installed.

On 2026-07-16, Vinicius reported that every implemented feature worked as
expected and that energy-control/electrical behavior was checked with technical
equipment and looked correct. He accepted THERM-002, THERM-010, and THERM-011,
including the current constants, for the tested configuration. The evidence is
owner-reported because raw traces, instrument/calibration details, and the exact
setup/build record were not committed. There is no remaining PRD-004 Human
review, but the single-sensor, timeout, failed-off-write, cleartext credential,
and other source-review findings remain engineering work.

## Pump GPIO10 and SSR validation

Status: HUMAN FUNCTIONAL AND OWNER-REPORTED INSTRUMENTED REVIEW ACCEPTED

PRD-002 assigns GPIO10 as an active-high pump SSR command and retains the original pump switch in series. Firmware initializes the command low before output configuration, commands it low again after configuration, and never restores an active command at boot. API v2 now runs firmware-owned Manual and persisted-profile timing through a dedicated extraction task; host tests and contract captures cover the software behavior only.

The firmware state is command state only. There is no current, SSR-output, switch-position, pressure, or flow feedback, and an SSR or GPIO path may fail independently of the requested command. Consequently, `running` cannot confirm pump operation and `off` cannot confirm physical de-energization.

The pinned ESP-IDF target build was unavailable during PUMP-007/PUMP-008. The
later owner acceptance supersedes that pending Human gate for the tested
configuration, but software still cannot control the pin during boot ROM/reset
or independently prove the physical output state.

On 2026-07-14, the owner reported that the rebuilt target became reachable and
that discovery, Manual and profile execution, Stop/cutoff, app-disconnection
continuation, and reset/power-cycle non-resumption all ran successfully, then
explicitly accepted the functional PUMP-009 checklist. On 2026-07-16, he also
reported checking all energy controls with technical equipment and accepting
the tested configuration. Raw GPIO10 waveforms, instrument/board/build
identifiers, injected GPIO-write-failure evidence, and target timer-wrap
captures were not committed. Those missing artifacts are not pending Human
review; the no-feedback and failure-path limitations remain engineering facts.

## FOTEK SSR-40 DA verification

Status: OWNER-REPORTED INSTRUMENTED ACCEPTANCE — PHYSICAL RISK RETAINED

The installed relay is confirmed as a `FOTEK SSR-40 DA`. The manufacturer specification identifies the standard SSR-40DA as a 3–32 VDC control-input and 24–380 VAC load-output relay. Its output type and voltage range are therefore nominally compatible with a 127 VAC resistive heater.

On 2026-07-16, the owner reported testing the energy-control path with technical
equipment and accepted the installed configuration. The raw unit identifiers,
terminal/rating record, activation measurements, and thermal/derating captures
were not committed; acceptance is limited to the owner-tested setup.

Firmware now uses a 1500 ms cache-safe GPTimer lease whenever it commands the
SSR input high. Healthy control iterations renew the lease without toggling the
input; a missed deadline commands GPIO20 low and latches an internal fault until
reboot. This bounds a software-stalled high command but does not mitigate an SSR
whose AC output has failed shorted, so the owner-accepted independent cutoff
remains required for the tested configuration and every future revision.

On 2026-07-04, the project owner approved an active-high direct connection from
GPIO20 to the SSR control input. No external pull-down resistor is available or
planned. Firmware will command GPIO20 low as early as its driver can initialize,
but cannot guarantee that the SSR input remains off while GPIO20 is uncontrolled
during reset, boot ROM execution, or loss of ESP32 power. The owner accepted
this residual hardware risk and the tested configuration on 2026-07-16; a
future hardware revision must revalidate activation and reset/boot behavior.

## Mechanical thermostat assertion

Status: HISTORICAL OWNER REPORT — PRD-017 REVALIDATION PENDING

The owner reports retaining a thermostat sold nominally as `145°C`, 10 A,
250 V. The marketplace listing supports component identification only; it does
not establish the installed unit's trip tolerance, thermal coupling, series
wiring, or successful heater interruption. Earlier 2026-07-16
technical-equipment acceptance applies only to the then-tested configuration,
before PRD-017's calibration and raised software limits.

Current TCAL-007 software faults when effective Steam or raw temperature reaches
`135°C`. This does not prove the thermostat opens, that an SSR is not shorted,
or that heater current stopped. TCAL-009 must retain independent Human review of
the exact installed cutoff path after TCAL-008 resolves the requested inclusive
`135°C` Steam target and its replacement software boundaries.

## PHIL-009 physical iPhone review

Status: HUMAN ACCEPTED 2026-07-16

The project owner initially approved PHIL-009 without the physical-iPhone
review. On 2026-07-16, he reported that all implemented features worked as
expected and removed the remaining Human feature review. The automated discovery parsing,
authentication, secure persistence, cached-address, stable-ID recovery,
simulator integration, type, lint, protocol, configuration, and export checks
passed. The final behavior is accepted at owner-reported evidence level; no
platform/session artifacts were committed.

The following checklist is retained as historical review scope; it is no longer
pending Human work:

- verify that the local-network permission appears only when discovery is
  needed, and that denial produces actionable Settings guidance;
- verify `_philcoino._tcp.local` discovery and presentation of name, stable
  device ID, model, API version, firmware version, and resolved address before
  token entry;
- verify an invalid token is not persisted, manual IPv4 entry completes the
  same pairing flow, and valid credentials survive an app restart;
- verify startup tries the cached address first and recovers a changed DHCP
  address by rediscovering and re-verifying the stable device ID; and
- verify no-device messaging and retry behavior on the physical local network.

## PHIL-010 physical iPhone dashboard review

Status: HUMAN ACCEPTED 2026-07-16

The project owner approved PHIL-010 after the automated polling, lifecycle,
protocol, simulator, type, lint, configuration, and export checks passed. The
physical-iPhone visual and lifecycle review was initially deferred. On
2026-07-16, he reported that all implemented features worked as expected and
accepted the remaining Human feature-review scope.

The following checklist is retained as historical review scope; it is no longer
pending Human work:

- approve the dashboard hierarchy, readability, temperature emphasis, and
  accessibility, including VoiceOver labels and Dynamic Type behavior;
- confirm foreground updates occur approximately once per second and that both
  temperatures and targets, active mode, firmware status, heater activity,
  steam countdown, and uptime context remain readable;
- background and foreground the app, then navigate away from and back to the
  dashboard, confirming polling stops while inactive, resumes immediately, and
  never overlaps requests;
- verify offline, unauthorized, and malformed-response protocol states are
  distinct from firmware-reported heating, ready, and fault states, and that
  unavailable data is not presented as a current live snapshot; and
- inject a firmware fault and recover connectivity to verify the fault code,
  message, heater-off state, and automatic polling recovery are clear.

## PHIL-011 physical iPhone controls review

Status: HUMAN ACCEPTED 2026-07-16

The project owner approved PHIL-011 after the bounded-control, confirmation,
acknowledgement, rejection, disconnection, race, simulator-integration, type,
lint, protocol, configuration, and export checks passed. This closes the
software task. On 2026-07-16, he reported that all implemented features worked
as expected and accepted the remaining Human controls/accessibility scope.

The following historical checklist used an iOS development build and either the
simulator or a low-voltage network-only machine setup. For the simulator, run
`bun run simulator`, put the
iPhone and development computer on the same Wi-Fi, and pair with the computer's
LAN address rather than `127.0.0.1`. Confirm `/healthz` is reachable from the
iPhone first. The development bearer token is `philcoino-dev-token`.

The historical review covered the following checks:

1. **Whole-degree bounds:** decrement Brew to 85°C and Steam to 110°C, then
   increment Brew to 95°C and Steam to 120°C. Confirm the boundary buttons
   disable and no fractional or out-of-range value can be entered.
2. **Explicit confirmation:** change both drafts, tap **Review target changes**,
   verify the old-to-new summary, then cancel. Confirm the live target cards do
   not change. Repeat and tap **Confirm and save**.
3. **Pending and acknowledgement:** while saving, confirm **Change pending** is
   readable and the old live targets remain visible. After the response,
   confirm **Change acknowledged** appears and both cards use the values returned
   by the machine.
4. **Persistence:** after an acknowledged target change, power-cycle the
   simulator with `POST /_simulator/power-cycle` or safely restart the
   low-voltage device. Reconnect and confirm both targets remain saved while the
   active mode returns to Brew.
5. **Acknowledged mode switching:** switch from Brew to Steam and back. Confirm
   the previously active mode stays selected while the request is pending and
   changes only after acknowledgement. Approve the Brew/Steam labels, selected
   state, and the five-minute automatic-return explanation.
6. **Firmware rejection:** with the simulator, latch a fault using
   `PUT /_simulator/fault` and body `{ "code": "sensor_failure" }`, then request
   a mode change. Confirm **Change rejected by firmware** displays the firmware
   message and the active mode does not change. Use `POST /_simulator/power-cycle`
   before continuing.
7. **Disconnection during mutation:** prepare a target change, confirm it, and
   immediately stop the simulator or disconnect the low-voltage device before
   acknowledgement. Confirm pending feedback becomes **Change not acknowledged**,
   live values are cleared as unavailable, and neither the draft target nor
   requested mode is shown as successful after reconnection.
8. **Steam timeout context:** in the simulator, switch to Steam, set the steam
   reading to its target with `PUT /_simulator/temperatures`, and advance manual
   time with `POST /_simulator/advance`. Confirm the copy explains when the timer
   starts, the countdown is understandable, and mode returns to Brew after the
   five-minute interval.
9. **Accessibility and layout:** repeat the controls with VoiceOver and larger
   Dynamic Type. Confirm stepper actions, disabled bounds, selected mode,
   confirmation actions, and pending/rejected/disconnected announcements are
   understandable without relying only on color.

## PRD-006 Dashboard continuity and history review

Status: HUMAN ACCEPTED 2026-07-18

Automated tests cover lifecycle pause/resume, interrupted mutations, current-day
retention, device scoping, graph gaps/downsampling, and complete CSV
serialization. The following checks still require a physical iPhone and do not
constitute heater or pump safety evidence:

- minimize and restore the app while connected; confirm the last acknowledged
  Dashboard remains visible as refreshing, controls are unavailable, and the
  first fresh poll restores live state without a blank reconnect screen;
- minimize during a pending mutation; confirm no late response appears as an
  acknowledgement and the refreshed firmware state remains authoritative;
- force-close and reopen during the same local day; confirm the saved curve
  restores after pairing recovery while current machine state reconnects
  normally;
- confirm minimized/offline intervals and an ESP32 restart appear as graph gaps
  rather than connected or interpolated lines;
- confirm Live opens on the latest thirty-second window, horizontal paging
  without a visible scrollbar reaches earlier current-day readings, the page
  status makes Latest and Earlier windows unambiguous, heater/pump command
  bands match acknowledged command intervals, and the adaptive Live scale
  remains readable with larger Dynamic Type and VoiceOver;
- export through Files and AirDrop, inspect the CSV headers/rows, and confirm no
  bearer token or local network address is present; and
- cross local midnight or use a controlled date test, then confirm prior-day
  samples are pruned and no longer exported.

The owner accepted PRD-006 on 2026-07-18. This closes its dashboard/history
product review but does not provide heater, pump, wiring, or mains-safety
evidence.

## PRD-007 Rolling history and backfill review

Status: HUMAN/TARGET REVIEW PENDING

Automated contract, simulator, mobile, native firmware, sanitizer, and capture
checks cover the bounded device ring, strict history cursor pages, durable
mobile cursor commits, reboot/truncation gaps, and stable thirty-second graph
windows. Human iPhone acceptance must still confirm two/five/ten-minute
minimize and force-close recovery, older-window inspection while new samples
arrive, localized restoring/warning states, reboot/overflow gaps, and CSV
contents. A pinned ESP32-C3 target build plus connected-target heap, stack, and
representative request/control-loop timing evidence also remain required.

History values remain command-state observations. They do not prove heater or
pump operation, de-energization, flow, cooling, or physical safety.

### 2026-07-19 graph-page presentation observation

An owner-provided CSV captured a Manual extraction whose pump-command samples
were `true` from 14:23:20.589Z through 14:24:01.801Z and `false` beginning at
14:24:02.657Z. The over-temperature fault began later, at 14:24:29.453Z, while
the CSV continued to record `pump_active=false`. A screenshot taken after the
fault showed the older extraction window without identifying it as earlier
history, which made the correctly retained teal band appear current.

This is a mobile graph-presentation finding, not evidence of continued pump
operation or a firmware history error. The mobile follow/latest indicator,
time-range label, jump-to-latest action, and per-window warm-range scale require
fresh native review under HIST-007. HIST-007 and all target/physical acceptance
gates remain pending.

## PRD-012 Passive predictive temperature control

> Historical note: PRD-016 superseded this current-runtime path on 2026-07-28.
> The text below records the implementation and regressions as they existed at
> the time; it is not a claim about current firmware, API, or mobile behavior.

The first predictive-temperature firmware release is intentionally passive.
It filters the raw boiler reading, calculates a three-second slope and
diagnostic acceleration, integrates recent heater/pump command activity, and
evaluates fixed linear models for 5, 10, and 20 seconds. It also records the
duty reduction that the model would have requested.

The existing nonlinear ten-second heater-duty controller remains authoritative
and receives no prediction-derived input. Commanded heater and pump activity do
not prove physical energy, flow, or de-energization. The checked-in prototype
coefficients are an unvalidated slope-extrapolation seed for data collection,
not tuned thermal parameters.

A later separately approved task must implement prediction-based heater
reduction or cutoff. That task must first replace the prototype model with
traceable validated coefficients, define Brew/Steam applicability and accuracy
thresholds, preserve all existing fail-off and independent over-temperature
boundaries, and obtain supervised target/runtime and physical evidence. Passive
logs or simulator/host tests are not authorization to enable active correction.

### 2026-07-21 enriched-history transport regression

The owner measured firmware `0.3.0` returning `Content-Length: 17093` for an
enriched history page but delivering only 15,838 bytes before closing the
connection after 4.93 seconds. The incomplete JSON also delayed live state
polling long enough for the mobile graph to display real continuity gaps.

Firmware `0.3.1` bounds new history pages to eight samples and an 8 KiB
host-tested serialized response, logs ESP-IDF send failures without logging
payloads or credentials, and advances one-Hertz capture against fixed uptime
deadlines. Mobile yields between backfill pages while continuing to accept
legacy sixty-sample responses. The owner later confirmed complete responses,
one stable boot ID across repeated 50-request stress runs, and gap-free
one-minute close/reopen recovery on a stable 5 V supply. Gaps seen while USB
powered did not reproduce after the power-source change.

The following live run exposed a separate mobile data-path issue: ordinary
queryless API v2 state did not carry prediction diagnostics, so rows captured
while the app stayed open exported empty prediction columns unless retained
history later replaced them. Firmware `0.3.3` adds the opt-in
`GET /api/v2/state?include=prediction` shape while preserving queryless state.
Mobile now stores those live fields immediately, invokes retained history only
after a detected gap, waits for an already-running recovery before export, and
uses stable clock-aligned graph-page identities so incoming samples do not
reset an older inspected page. Native/target confirmation of this build remains
HIST-007 work.

## PRD-016 Brew PI controller and prediction removal

Status: SOFTWARE COMPLETE — TARGET/PHYSICAL A/B PENDING

PRD-016 intentionally breaks the prediction-enriched API v2/mobile history
surface as one matched firmware/mobile change. Current firmware has no
predictor runtime or model artifact dependency, `/api/v2/state` is queryless,
history pages are strictly limited to eight samples with controller
configuration/diagnostics, and SQLite migration discards old prediction JSON
while retaining ordinary current-day rows and source provenance. Historical
PRD-012, specifications, raw CSVs, modeling runs, and the offline tool remain
available.

`CONFIG_PHILCOINO_BREW_PI_CONTROL` defaults off. The default build keeps the
legacy Brew curve authoritative and calculates PI only as shadow diagnostics.
An enabled build selects PI requested duty only for Brew and still uses the
same ten-second SSR window, permission, cooldown inhibit, fault, lease,
minimum-pulse, and fail-off paths. Steam remains legacy. Host authority tests
cover both selectors and show that arbitrary shadow output cannot affect
commands or ordinary state.

Current candidate constants are Kp `0.08`, Ki `0.01`, EMA alpha `0.25`, a
500 ms exact update interval, and bounded conditional anti-windup. They are not
physically accepted tuning. The native/sanitizer matrix, strict captures, and
resource evidence prove software behavior only. A pinned ESP-IDF build plus
supervised instrumented legacy-vs-PI A/B runs with an independent thermometer,
SSR/current observation, and independent over-temperature protection remain
required. No energized test was performed or authorized by this software task.
