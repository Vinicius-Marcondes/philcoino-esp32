# Safety and project status

Philcoino is an experimental, mains-adjacent espresso-machine controller. The repository contains useful software and host-test coverage, but it is not a certified safety controller and is not approved for production, unattended use, or mains-powered heater operation.

## Current status

- PRD-001 software tasks have progressed through mobile monitoring and acknowledged controls, but the tracker still lists later review/physical tasks as incomplete.
- The current codebase review contains unresolved BLOCKER and MAJOR findings in firmware timing, sensor monitoring, timeout behavior, physical output certainty, transport, and credential/device identity.
- Current firmware source uses one thermocouple reading for both brew and steam (`kDualThermocouplesEnabled = false`), which does not satisfy final dual-sensor acceptance.
- Current firmware source enables the OLED (`kOledEnabled = true`), while tracker text records a temporary disabled-OLED state. Treat this as an unresolved documentation/configuration discrepancy, not an approved hardware state.
- Physical iPhone discovery, final sensor behavior, relay/SSR installation, independent cutoff, and supervised energized validation remain human checks.

See [CODEBASE_REVIEW_REPORT.md](../CODEBASE_REVIEW_REPORT.md), [docs/TRACKER.md](TRACKER.md), and [docs/side-notes.md](side-notes.md) for the detailed evidence.

## What software currently attempts

Firmware owns the temperature-control loop and does not rely on app connectivity. Its policy code:

- validates MAX6675 status and finite readings;
- applies mode-specific target and over-temperature limits;
- requires a three-second ready hold;
- applies a heating timeout and five-minute steam-ready timeout;
- computes heater duty in ten-second windows;
- latches faults and commands the SSR output off;
- persists only validated targets;
- starts critical hardware in a fail-off order.

These are design intentions and tested software behaviors, not proof of physical de-energization or thermal safety.

## Known high-risk limitations

The current review identifies, among others:

- heater pulse shutoff and shared-control access can be delayed by loop stalls or unbounded mutex/I/O work;
- diagnostic single-sensor mode removes independent dual-sensor monitoring and disagreement detection is not implemented;
- some valid remote/no-op writes can reset heating deadlines, allowing a client to extend timeout protection;
- a failed GPIO off-write can still be presented as heater off even when physical state is unknown;
- mDNS startup failure currently tears down the HTTP server, defeating manual-address fallback;
- pairing verifies a public stable ID rather than a cryptographic device identity;
- plaintext HTTP bearer credentials lack minimum-strength enforcement, throttling, rotation, and transport confidentiality;
- the simulator omits critical firmware timing, sensor, scheduler, persistence-stall, and GPIO failure behavior.

Do not soften or hide these findings in user-facing documentation. Resolve and verify them before reconsidering energized operation.

## Physical safety boundary

Software cannot replace:

- a correctly rated independent thermal fuse/thermostat wired in series with the heater;
- correctly selected fuse/breaker, conductor, terminal, insulation, creepage, clearance, enclosure, strain relief, and protective earth;
- verified SSR authenticity, input margin, load rating, failure mode, heat sink, mounting, and temperature derating;
- pressure-vessel and dry-boil protections already required by the appliance;
- qualified review and supervised measurement on the actual unit.

An SSR may fail shorted. A successful API response or low GPIO command does not prove that mains current stopped.

## Allowed development scope

Without explicit human authorization, limit work to:

- static analysis and documentation;
- protocol, simulator, mobile, and host-test development;
- firmware compilation and non-energized host tests;
- supervised low-voltage ESP32/peripheral checks with the heater/load disconnected.

Do not connect, disconnect, modify, or energize mains wiring based on repository instructions alone.

## Security model

API v1 uses local plaintext HTTP and a bearer token. Public identity is advertised over mDNS. This may be acceptable for constrained development on an isolated trusted LAN, but it does not defend against a hostile local peer that can observe traffic, clone identity, steal/replay a token, or brute-force a weak token.

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

## Requirements before energized consideration

At minimum:

1. close every relevant BLOCKER and MAJOR finding with adversarial tests;
2. restore and validate independent dual-sensor monitoring and disagreement behavior;
3. make heater-off timing independent of blocking network/storage/display/control-loop work;
4. represent and escalate unknown physical output state;
5. prevent client traffic from extending safety deadlines;
6. resolve device identity, token strength, throttling, transport, and recovery security;
7. complete the pinned ESP-IDF build and target-runtime checks;
8. verify independent cutoff, SSR drive/current/thermal behavior, wiring, enclosure, and protection with qualified supervision;
9. record explicit human acceptance for the exact hardware configuration.

Completion of this list still does not imply regulatory certification.

## Reporting safety issues

Do not include live tokens, Wi-Fi credentials, private addresses, or exploit details tied to an exposed device in a public issue. Preserve reproducible evidence, affected code paths, failure sequence, and expected fail-safe behavior, then coordinate privately with the repository owner before public disclosure.
