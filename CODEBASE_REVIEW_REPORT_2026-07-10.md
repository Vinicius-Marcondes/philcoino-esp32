# Philcoino full codebase review

**Date:** 2026-07-10
**Method:** Static, read-only review; no source files changed, no dependencies installed, and no tests/builds executed.
**Decision:** **REQUEST CHANGES — do not treat the temperature-control system as production-safe or approve energized/unattended operation.**

## Scope

Reviewed authored firmware configuration, peripherals, temperature controller, ESP-IDF startup/network adapters, firmware HTTP API, host tests, OpenAPI/Zod protocol, simulator, mobile networking/discovery/pairing/storage/dashboard flows, mobile tests, workspace configuration, PRD/task status, architecture decisions, hardware notes, and temperature-control tuning documentation.

Generated, dependency, cache, build, coverage, binary-heavy, and local-database paths were excluded as required by `AGENTS.md`. Physical wiring, SSR authenticity, sensor mounting, thermostat behavior, heat-sink sizing, and energized behavior cannot be established through source review.

## Executive summary

| Severity | Count |
| --- | ---: |
| BLOCKER | 3 |
| MAJOR | 8 |
| MINOR | 8 |
| NIT | 2 |

The system has good foundations: firmware owns control state, target validation is bounded at several layers, faults are latched, protocol parsing is strict, mobile mutations wait for acknowledgement, polling is completion-driven, and host tests cover normal controller behavior. The safety case is nevertheless incomplete. Heater pulse shutoff and sensor sampling share a blocking application loop, sensor disagreement is not implemented, safety deadlines can be reset or evaded through ordinary API commands and temperature oscillation, and physical-control credentials are replayable over cleartext HTTP.

## Findings

### BLOCKER

#### B1. SSR pulses can remain on beyond their deadline if the control loop stalls

**Evidence:**

- `firmware/espresso-machine/components/control/src/control.cpp:394-413` turns the SSR off only when `TemperatureController::update_heater()` is called again.
- `firmware/espresso-machine/main/app_main.cpp:235-258` performs sampling, control, synchronization, and display work in the same loop.
- `firmware/espresso-machine/main/app_main.cpp:238` waits for the API mutex with `portMAX_DELAY`.
- `firmware/espresso-machine/components/networking/src/esp_networking.cpp:301-309` holds that mutex while the API handles commands.
- `firmware/espresso-machine/components/control/src/control.cpp:125-143` persists targets before forcing the heater off.
- `firmware/espresso-machine/components/peripherals/src/esp_peripherals.cpp:253-257` performs synchronous NVS write and commit.

The ten-second duty window is software-polled. If the loop stalls while GPIO20 is high, the output stays high beyond its calculated pulse. During the same stall, sensor validation, over-temperature detection, and heating timeout also stop advancing.

**Required direction:** Put heater-off deadlines in a fail-off hardware timer/one-shot or a dedicated high-priority control task. Use bounded lock acquisition, keep HTTP/NVS/display work outside the real-time control boundary, force off before blocking operations, and configure watchdog recovery. The independent physical thermal cutoff remains mandatory.

#### B2. Configured cross-sensor disagreement protection does not exist

**Evidence:**

- `firmware/espresso-machine/components/firmware_config/include/philcoino/config.hpp:25-29` defines a 10°C threshold for five minutes.
- `firmware/espresso-machine/components/control/src/control.cpp:367-379` checks only reading validity and individual over-temperature thresholds.
- The disagreement constants are not referenced by controller source; the only other reference is a static constant test.
- `firmware/espresso-machine/components/firmware_config/include/philcoino/config.hpp:16` currently disables dual sensors, and `firmware/espresso-machine/components/peripherals/src/peripherals.cpp:119-122` mirrors the brew reading into steam.

Two plausible but divergent readings can be accepted indefinitely when dual mode is restored. In the current diagnostic state, one sensor is the sole authority for brew and steam.

**Required direction:** Implement continuous disagreement timing with recovery/hysteresis and a latched fail-off fault. Test boundary, interruption, rollover, and inactive-sensor cases. Do not approve energized or dual-sensor operation until independent readings and the disagreement path are physically proven.

#### B3. A reusable physical-control credential is transmitted over cleartext HTTP

**Evidence:**

- `firmware/espresso-machine/components/networking/include/philcoino/api.hpp:12-15` serves port 80.
- `apps/mobile/src/networking/device-api-client.ts:207-220` sends the bearer token on authenticated requests.
- `apps/mobile/plugins/with-android-cleartext.js:3-12` enables cleartext traffic for the whole Android application.
- The token authorizes heater permission, mode changes, maximum targets, and over-temperature dismissal.

A passive LAN observer, malicious access point, or compromised router can capture and replay the token. The documented decision to accept LAN HTTP does not remove the physical-control consequence.

**Required direction:** Use an encrypted authenticated channel with pinned per-device identity (for example, pinned TLS or a provisioned device key plus an authenticated pairing protocol), rotate exposed tokens, and scope any temporary Android cleartext exception narrowly.

### MAJOR

#### M1. Any valid target PATCH resets both safety deadlines

`firmware/espresso-machine/components/control/src/control.cpp:125-143` persists every valid target payload, resets readiness and heater timing, clears the heating-demand timer, and cancels the steam timer. `firmware/espresso-machine/components/networking/src/api.cpp:534-555` exposes this to every authenticated caller. A no-op PATCH or a change only to the inactive target can therefore indefinitely postpone heating timeout and cancel steam auto-return.

**Recommendation:** Detect no-op and inactive-only changes, do not reset unrelated deadlines, and maintain absolute safety deadlines that remote traffic cannot extend indefinitely.

#### M2. Heating timeout clears on a target crossing, not on readiness

`firmware/espresso-machine/components/control/src/control.cpp:196-217` clears `heating_demand_active_` whenever heat is not currently demanded. Readiness separately requires three continuous seconds in band at `control.cpp:382-391`. A noisy or oscillating signal can repeatedly cross target, reset the ten-minute timer, and never become ready.

**Recommendation:** Keep the heating deadline active until readiness is actually achieved or an explicitly defined safe reset occurs. Add oscillation/noise tests.

#### M3. Failed off-writes are represented as confirmed heater-off state

`firmware/espresso-machine/components/peripherals/src/peripherals.cpp:200-220` sets internal `enabled_` false after a failed off attempt. `firmware/espresso-machine/components/control/src/control.cpp:242-247` ignores the `force_off()` result when latching faults, while `control.cpp:227-239` reports `heater_enabled=false`. Existing fakes change their simulated pin level before returning failure and cannot model a stuck-high output.

**Recommendation:** Represent the physical command state as on/off/unknown, escalate an unconfirmed off-write to fatal/watchdog handling, and test a fake whose output remains high when the off-write fails. UI copy should distinguish an off command from confirmed de-energization.

#### M4. Pairing and address recovery expose the token to a cloned identity

`apps/mobile/src/discovery/device-discovery.ts:35-57` accepts self-asserted mDNS TXT identity. `apps/mobile/src/pairing/pairing-service.ts:43-88,142-170` verifies only public `deviceId` data before sending the bearer token. `firmware/espresso-machine/components/firmware_config/src/config.cpp:7-11` derives the ID from only the final three MAC bytes. `apps/mobile/src/networking/device-address.ts:1-29` accepts any syntactically valid HTTP origin rather than proving a local or pinned device.

**Recommendation:** Provision and pin a device public key/fingerprint out of band, authenticate rediscovery before sending credentials, and treat the current ID only as a display/discovery label.

#### M5. Weak tokens are accepted and authentication is not throttled

`firmware/espresso-machine/main/app_main.cpp:20-23` requires only a non-empty token; `firmware/espresso-machine/main/Kconfig.projbuild:16-20` defines no entropy/length requirement; `firmware/espresso-machine/components/networking/src/api.cpp:421-459,492-495` has no failed-auth rate limit or backoff.

**Recommendation:** Generate/enforce per-device credentials with at least 128 bits of randomness, add rate limiting/backoff, and support rotation/revocation.

#### M6. mDNS failure disables the manual-IP HTTP fallback

`firmware/espresso-machine/components/networking/src/esp_networking.cpp:63-71` starts HTTP, then stops it if mDNS startup fails. This contradicts the manual-address recovery path in the product behavior.

**Recommendation:** Keep HTTP available when discovery fails, expose degraded discovery separately, and retry mDNS without tearing down the API.

#### M7. OLED runtime configuration contradicts the approved hardware state

`firmware/espresso-machine/components/firmware_config/include/philcoino/config.hpp:17` sets `kOledEnabled = true`, while `docs/TRACKER.md` and `docs/decisions/firmware-foundation.md:48-53` say it is temporarily disabled. `firmware/espresso-machine/main/app_main.cpp:176-203` aborts startup if the disconnected OLED cannot initialize/render. `firmware/espresso-machine/host-tests/firmware_config_test.cpp:37` checks only that the constant is a boolean.

**Recommendation:** Align configuration with the approved diagnostic state, assert the expected behavior in tests, and explicitly decide whether display failure should disable temperature control.

#### M8. The simulator is not behaviorally representative of firmware control

`tools/device-simulator/src/model.ts:229-343` moves temperatures directly toward targets. It does not implement the ten-second duty curve, recovery ramp, heating timeout, automatic over-temperature detection, invalid/disagreeing sensors, control-loop stalls, persistence blocking, or output-write failures. Faults are manually injected at `model.ts:181-188`.

**Recommendation:** Label it explicitly as a UI/API simulator and add a behavioral conformance suite that feeds identical sensor/time/command sequences into the C++ controller and a reference model. Do not cite simulator tests as heater-safety evidence.

### MINOR

#### m1. Unauthenticated slow request bodies can occupy the HTTP server indefinitely

`firmware/espresso-machine/components/networking/src/esp_networking.cpp:267-309` reads bodies before authentication and retries socket timeouts without a total deadline. Authenticate headers first and impose a total body deadline/retry cap.

#### m2. No-op target writes consume NVS endurance

`firmware/espresso-machine/components/networking/src/api.cpp:534-555` and `firmware/espresso-machine/components/peripherals/src/esp_peripherals.cpp:253-257` commit unchanged values. Skip no-ops and coalesce/throttle persistence.

#### m3. Temperature limits are duplicated in the firmware HTTP parser

`firmware/espresso-machine/components/networking/src/api.cpp:331-367` hard-codes 85/95/110/120 instead of using `config.hpp`. Current values match, but future tuning can silently drift.

#### m4. Critical failure sequences are absent from host tests

`firmware/espresso-machine/host-tests/control_test.cpp` does not cover single-sensor mode, disagreement duration, loop starvation, no-op deadline reset, inactive-target deadline reset, target oscillation without readiness, NVS stalls while on, rollover of every timer, or stuck-high off failures.

#### m5. Forget-device storage failure leaves the UI busy and rejects unhandled

`apps/mobile/components/pairing-screen.tsx:249-259` awaits SecureStore deletion without error handling or `finally`. A storage failure prevents cleanup and leaves `busy=true`.

#### m6. Core mobile screens mix orchestration, presentation, and large style blocks

`apps/mobile/components/dashboard-screen.tsx` is 986 lines, `pairing-screen.tsx` is 566 lines, and `machine-controls.tsx` is 553 lines. Split stateful orchestration from focused presentational units so safety-related UI states are easier to review and test.

#### m7. User-facing and safety copy is hard-coded throughout mobile code

Messages are embedded in screens, dashboard sessions, and view models. Centralize governed copy and introduce i18n before safety wording and localization diverge.

#### m8. Architecture documentation describes a repository that no longer exists

`docs/ARCHITECTURE.md:5-10` says only an Expo starter exists and explicitly denies the implemented transport, persistence, protocol, simulator, and firmware. It also documents deleted starter routes. This is dangerous onboarding material for future maintainers.

### NIT / maintainability

#### n1. The hand-written firmware JSON implementation is a large maintenance surface

`firmware/espresso-machine/components/networking/src/api.cpp` is 606 lines and owns parsing, escaping, validation, authentication helpers, serialization, and routing behavior. Keep it aggressively fuzzed/contract-tested or adopt a pinned, size-appropriate parser supported by the firmware toolchain.

#### n2. There is no authoritative full verification command

The root `package.json` exposes separate mobile/protocol/simulator checks and omits mobile tests and firmware host tests from an aggregate command. PHIL-012 is still Todo and explicitly requires cross-workspace resilience and drift checks.

## Positive controls observed

- Firmware remains authoritative for targets, mode, heater permission, faults, timeouts, and SSR command state.
- Target ranges are consistently bounded in Zod, OpenAPI, mobile requests, simulator validation, firmware HTTP parsing, and controller storage.
- Mobile live values change only after validated acknowledgements; polling is paused during mutations.
- Polling is completion-driven and cancellation-aware, and connection failures clear stale snapshots.
- Fault protocol states require `heaterActive=false` and include structured codes/messages.
- Elapsed-time comparisons use unsigned subtraction and are generally rollover-safe.
- MAX6675 frames reject open-circuit and invalid-frame flags.
- Secrets are not committed in firmware defaults and mobile persistence uses Expo SecureStore.

## Verification and readiness gaps

No commands that execute project code were run because this review was requested as read-only. Therefore this report makes no new pass/fail claim for compilation, lint, unit tests, host tests, ESP-IDF builds, Expo builds, or hardware.

Repository records also show:

- `docs/prds/PRD-001/tasks/PHIL-012.md` (end-to-end contract/resilience) is Todo.
- `docs/prds/PRD-001/tasks/PHIL-013.md` (supervised physical integration) is Todo.
- Dual thermocouples are disabled, the steam reading is mirrored, and physical iPhone checks remain deferred.
- Independent cutoff, SSR reset behavior, 3.3V activation, heat sinking, sensor placement, and energized behavior remain physical risks in `docs/side-notes.md`.

## Prioritized remediation

1. Make SSR shutoff deadline-driven and independent of networking, NVS, display, and the main loop; add bounded locking and watchdog handling.
2. Implement and adversarially test sensor disagreement, stuck-high output failure, monotonic heating timeout, and immutable steam deadline behavior.
3. Prevent remote/no-op commands and temperature crossings from resetting safety deadlines.
4. Restore independent dual-sensor monitoring and complete low-voltage validation before any energized approval.
5. Replace cleartext bearer control with cryptographic device identity and encrypted authenticated commands.
6. Correct the OLED configuration and keep manual HTTP available when mDNS fails.
7. Complete PHIL-012 with cross-implementation conformance/adversarial tests and one reproducible verification entry point.
8. Only after software blockers close, perform PHIL-013 under its documented stop conditions with independent temperature/electrical measurement.

## Final assessment

The non-real-time architecture is promising and much of the contract/mobile code is careful, but the temperature-control safety case is not complete. The current implementation should be treated as development/low-voltage software, not production-safe heater control. All BLOCKER items and the timeout/output-state MAJOR items should be closed before supervised energized testing, and unattended operation should remain out of scope without independently verified hardware protection.
