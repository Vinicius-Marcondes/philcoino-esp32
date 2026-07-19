# Safety and project status

[Português do Brasil](../SAFETY.md)

Philcoino is an experimental, mains-adjacent espresso-machine controller. The repository contains useful software and host-test coverage, but it is not a certified safety controller and is not approved for production or unattended use. On 2026-07-16, the owner accepted the tested configuration after reporting functional tests and technical-equipment checks of the energy controls; that acceptance is not general certification.

## Current status

- Human review of every implemented feature and the tested physical configuration was accepted by the owner on 2026-07-16. The Agent-owned PHIL-012 automated contract/resilience task remains pending.
- The current codebase review contains unresolved BLOCKER and MAJOR findings in firmware timing, sensor monitoring, timeout behavior, physical output certainty, transport, and credential/device identity.
- Current firmware permanently uses one boiler-base thermocouple for both brew and steam. It is a single point of control failure and provides no independent sensor cross-check.
- PRD-003 implements an owner-selected fixed `+5°C` correction only after raw
  validation and only in Steam. The corrected value drives control, limits,
  API, and OLED behavior. The owner accepted the value for the tested
  configuration in STEAM-004; raw instrument/measurement records are not in the repository.
- PRD-004 software adds a fixed Manual/main `+2°C` heater-duty-only bias and a
  firmware-owned cooldown command workflow with a 45-second pump cutoff and
  five-second stabilization. The owner accepted THERM-002, THERM-010, and
  THERM-011 on 2026-07-16 after reporting tests of every feature and technical-
  equipment checks of the energy controls. Evidence is owner-reported and
  limited to the tested configuration.
- Current firmware source enables the OLED (`kOledEnabled = true`), while tracker text records a temporary disabled-OLED state. Treat this as an unresolved documentation/configuration discrepancy, not an approved hardware state.
- No Human feature or tested-configuration checks remain pending. Architecture, firmware, and security findings remain engineering work.

See the [codebase review](../../CODEBASE_REVIEW_REPORT.md), [tracker](../TRACKER.md), and [side notes](../side-notes.md) for the detailed evidence.

## What software currently attempts

Firmware owns the temperature-control loop and does not rely on app connectivity. Its policy code:

- validates MAX6675 status and finite readings;
- uses the raw reading in Brew and applies one compile-time `+5°C` correction
  in Steam before decisions and snapshots;
- applies mode-specific target and over-temperature limits;
- requires a three-second ready hold;
- applies a heating timeout and five-minute steam-ready timeout;
- computes heater duty in ten-second windows;
- applies the fixed extraction bias only to Manual/main heater-duty
  calculations while leaving targets, readiness, deadlines, limits, and
  profile data unchanged;
- latches faults and commands the SSR output off;
- persists validated targets and complete four-slot extraction profile sets;
- runs Manual and persisted profiles in a dedicated monotonic controller,
  initializes GPIO10 `off`, and never restores `running` at boot;
- runs mutually exclusive cooldown through a bounded 10 ms workflow task,
  orders heater inhibit/off before pump Start, and never restores cooldown at
  boot;
- records up to 600 observational snapshots in RAM and exposes pages of at
  most 60; history supplies no input to heater, pump, readiness, timeout,
  fault, or mutation decisions;
- uses a 1500 ms GPTimer heater-command safety lease and one bounded workflow
  mutex, with NVS, display, and HTTP transmission outside that boundary;
- starts critical hardware in a fail-off order.

These are design intentions and tested software behaviors, not proof of physical de-energization or thermal safety.

Agreement between control, API, and OLED establishes only software consistency.
It does not prove that `+5°C` represents the physical boiler gradient, that
`+2°C` improves extraction, or that a cooldown command produces flow or cooling.
It does not replace independent measurement, a thermal cutoff, or energized
review.

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
