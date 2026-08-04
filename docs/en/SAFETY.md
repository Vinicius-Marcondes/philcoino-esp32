# Safety and project status

[Português do Brasil](../SAFETY.md)

Philcoino is an experimental, mains-adjacent espresso-machine controller. The repository contains useful software and host-test coverage, but it is not a certified safety controller and is not approved for production or unattended use. On 2026-07-16, the owner accepted the tested configuration after reporting functional tests and technical-equipment checks of the energy controls; that acceptance is not general certification.

## Current status

- Human review of every implemented feature and the tested physical configuration was accepted by the owner on 2026-07-16. The Agent-owned PHIL-012 automated contract/resilience task remains pending.
- The current codebase review contains unresolved BLOCKER and MAJOR findings in firmware timing, sensor monitoring, timeout behavior, physical output certainty, transport, and credential/device identity.
- Current firmware permanently uses one boiler-base thermocouple for both brew and steam. It is a single point of control failure and provides no independent sensor cross-check.
- PRD-017 supersedes PRD-003's fixed Steam-only runtime correction with one
  persisted signed global offset applied once to Brew and Steam after raw
  validation. A missing record is uncalibrated `0°C`; corrupt or unreadable
  storage faults with the heater commanded off. The owner accepted the UI, but
  physical calibration, boiling-point accuracy, and energized operation remain
  pending.
- PRD-018 adds a transient estimate to Steam control only: the `12°C` default
  decays linearly over `12 min`. The published effective sensor value and the
  independent raw/effective `135°C` caps do not include this term. It is a
  thermal-lag hypothesis, not a second measurement, and its persisted values
  require supervised physical validation.
- The retained thermostat is identified by the owner/listing as nominally
  `145°C`, 10 A, 250 V. The listing does not prove installed tolerance,
  coupling, series wiring, or heater interruption. TCAL-008 permits an
  inclusive `135°C` Steam target; that is software evidence and does not
  validate the thermostat or authorize energized operation.
- PRD-004 software adds a fixed Manual/main `+2°C` heater-duty-only bias and a
  firmware-owned cooldown command workflow with a 45-second pump cutoff and
  five-second stabilization. The owner accepted THERM-002, THERM-010, and
  THERM-011 on 2026-07-16 after reporting tests of every feature and technical-
  equipment checks of the energy controls. Evidence is owner-reported and
  limited to the tested configuration.
- The previously disabled OLED/SSD1306 implementation was removed in PERF-010.
  GPIO8 and GPIO9 remain unassigned; this neither approves new hardware nor
  changes historical physical acceptance.
- The 2026-07-16 acceptance remains limited to the configuration tested then.
  PRD-012 prediction is now preserved only as historical/offline research.
  PRD-016 active Brew PI target/thermal/SSR A/B checks remain pending; the
  default-off selector and host evidence do not extend prior physical
  acceptance. Architecture, firmware, and security findings remain engineering
  work.

See the [codebase review](../../CODEBASE_REVIEW_REPORT.md), [tracker](../TRACKER.md), and [side notes](../side-notes.md) for the detailed evidence.

## What software currently attempts

Firmware owns the temperature-control loop and does not rely on app connectivity. Its policy code:

- validates MAX6675 status and finite readings;
- validates the raw reading, applies one persisted global offset in Brew and
  Steam, and uses the resulting effective temperature for decisions and
  snapshots;
- permits effective Steam temperature and the raw reading through `135°C`,
  inclusive, before correction; either one strictly above the cap latches
  `over_temperature` and commands the heater off;
- applies mode-specific target and over-temperature limits;
- requires a three-second ready hold;
- applies a heating timeout and persisted `1–15 min` steam-ready timeout,
  defaulting to five minutes;
- computes heater duty in ten-second windows;
- applies the fixed extraction bias only to Manual/main heater-duty
  calculations while leaving targets, readiness, deadlines, limits, and
  profile data unchanged;
- latches faults and commands the SSR output off;
- persists validated targets, complete four-slot extraction profile sets,
  temperature calibration, and Steam heat-soak settings in separate NVS
  records;
- runs Manual and persisted profiles in a dedicated monotonic controller,
  initializes GPIO10 `off`, and never restores `running` at boot;
- runs mutually exclusive cooldown through a bounded 10 ms workflow task,
  orders heater inhibit/off before pump Start, and never restores cooldown at
  boot;
- records up to 600 observational snapshots in RAM and exposes pages of at
  most 8; history supplies no input to heater, pump, readiness, timeout,
  fault, or mutation decisions;
- calculates bounded Brew PI and legacy requested-duty diagnostics at the
  fixed 500 ms interval; the default build keeps PI shadow-only, while an
  explicitly enabled build selects PI only for Brew through the unchanged
  ten-second command window;
- uses a 1500 ms GPTimer heater-command safety lease and one bounded workflow
  mutex, with NVS and HTTP transmission outside that boundary;
- starts critical hardware in a fail-off order.

These are design intentions and tested software behaviors, not proof of physical de-energization or thermal safety.

The PI selector is build-time only, defaults off, and does not weaken sensor
validation, heater permission, cooldown inhibit, fault latching, over-
temperature limits, the 1,500 ms safety lease, output-failure handling, or the
independent physical cutoff requirement. Kp, Ki, EMA alpha, and integral bounds
are compile-time candidates, not physically accepted tuning. History values
report requested/command state; `deliveredCommandDuty1s` is a firmware command
fraction, not measured SSR current or power.

Agreement between control and API establishes only software consistency.
It does not prove that a user-observed offset represents calibrated physical
temperature or the local boiling point, that `+2°C` improves extraction, or
that a cooldown command produces flow or cooling. It does not replace
independent measurement, a thermal cutoff, or energized review.

Likewise, historical `heaterActive` and `pumpActive` values describe the last
known firmware command. Backfill, SQLite, graph, and CSV data do not prove
physical operation, flow, cooling, or de-energization and must never be used as
control-loop feedback.

## Known high-risk limitations

The current review identifies, among others:

- the GPTimer lease and bounded workflow mutex reduce software-command timing
  exposure, but the pinned target build/runtime stall matrix and watchdog
  recovery remain unresolved in source-review evidence; the owner accepted the
  tested physical GPIO/SSR/cutoff configuration without adding raw traces;
- the permanent single control sensor cannot detect a plausible but incorrect reading through sensor disagreement;
- some valid remote/no-op writes can reset heating deadlines, allowing a client to extend timeout protection;
- a failed GPIO off-write can still be presented as heater off even when physical state is unknown;
- the pump has no current, SSR, flow, or series-switch feedback; `running` and
  `off` describe only GPIO10 command state and a write failure can leave physical
  state unknown;
- mDNS startup failure currently tears down the HTTP server, defeating manual-address fallback;
- pairing verifies a public stable ID rather than a cryptographic device identity;
- plaintext HTTP bearer credentials lack minimum-strength enforcement, throttling, rotation, and transport confidentiality;
- the simulator omits critical firmware timing, sensor, scheduler, persistence-stall, and GPIO failure behavior.

Do not soften or hide these findings in user-facing documentation. Resolve and verify them before production, unattended use, or use of another hardware configuration.

## Physical safety boundary

Software cannot replace:

- a correctly rated independent thermal fuse/thermostat wired in series with the heater;
- correctly selected fuse/breaker, conductor, terminal, insulation, creepage, clearance, enclosure, strain relief, and protective earth;
- verified SSR authenticity, input margin, load rating, failure mode, heat sink, mounting, and temperature derating;
- pressure-vessel and dry-boil protections already required by the appliance;
- qualified review and supervised measurement on the actual unit.

An SSR may fail shorted. A successful API response or low GPIO command does not prove that heater or pump mains current stopped.

## Allowed development scope

Without explicit human authorization, limit work to:

- static analysis and documentation;
- protocol, simulator, mobile, and host-test development;
- firmware compilation and non-energized host tests;
- supervised low-voltage ESP32/peripheral checks with the heater/load disconnected.

Do not connect, disconnect, modify, or energize mains wiring based on repository instructions alone.

## Security model

APIs v1 and v2 use local plaintext HTTP and the same bearer token. Public identity is advertised over mDNS. This may be acceptable for constrained development on an isolated trusted LAN, but it does not defend against a hostile local peer that can observe traffic, clone identity, steal/replay a token, or brute-force a weak token. API v2 expands a stolen credential's impact to extraction commands.

Until the known findings are resolved:

- use a dedicated isolated development network;
- use a high-entropy unique token and never commit or log it;
- do not reuse personal/account credentials;
- do not expose the device port to the internet;
- treat a changed address or identity as untrusted;
- rotate/remove credentials after demos or shared-network testing.

## Evidence levels

| Evidence | What it supports | What it does not support |
| --- | --- | --- |
| Protocol/Zod tests | Wire-shape consistency | Firmware timing or hardware behavior |
| Simulator tests | Mobile/API flows under deterministic model | Real control loop, sensors, GPIO, SSR, or thermal safety |
| Firmware host tests | Pure C++ policies and serialization | ESP-IDF scheduling/I/O or physical output |
| ESP-IDF target build | Target compilation/link integration | Correct wiring or runtime safety |
| Low-voltage bench check | Specific observed peripheral/GPIO behavior | Mains heater operation |
| Supervised instrumented hardware test | The measured scenario on one build | Certification or unattended safety |

Always state which level produced a claim.

## Requirements before production, unattended use, or another energized configuration

At minimum:

1. close every relevant BLOCKER and MAJOR finding with adversarial tests;
2. validate the single sensor's mounting, lag, error, and failure behavior against an independent instrument, and retain an independent hardware thermal cutoff;
3. verify the heater safety lease and bounded workflow timing on the pinned
   target, add watchdog/stall evidence, and retain the independent physical
   cutoff;
4. represent and escalate unknown physical output state;
5. prevent client traffic from extending safety deadlines;
6. resolve device identity, token strength, throttling, transport, and recovery security;
7. complete the pinned ESP-IDF build and target-runtime checks;
8. verify independent cutoff, SSR drive/current/thermal behavior, wiring, enclosure, and protection with qualified supervision;
9. record explicit human acceptance for each exact hardware configuration; the configuration tested on 2026-07-16 has owner-reported acceptance.

Completion of this list still does not imply regulatory certification.

## Reporting safety issues

Do not include live tokens, Wi-Fi credentials, private addresses, or exploit details tied to an exposed device in a public issue. Preserve reproducible evidence, affected code paths, failure sequence, and expected fail-safe behavior, then coordinate privately with the repository owner before public disclosure.
