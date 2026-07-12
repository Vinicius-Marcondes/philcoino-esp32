# Philcoino Full Codebase Review

**Date:** 2026-07-09
**Review target:** `feature/PRD-001-espresso-control` at `d573b0b` against `main` at `1246ad0`
**Checked-out branch:** `main`
**Decision:** **REQUEST CHANGES — do not treat the temperature-control system as production-safe**

## Scope and repository state

The checked-out `main` branch contains only the original Expo starter. The actual mobile, protocol, simulator, and firmware implementation exists on `feature/PRD-001-espresso-control`; that branch was reviewed read-only with `git show`/`git diff`, without checking it out or modifying source.

The working tree also contains untracked native/build output from the feature branch. Generated, dependency, cache, binary, and secret-bearing local configuration paths were excluded from inspection as required by `AGENTS.md`.

This review covers authored firmware control/peripheral/networking code, firmware host tests, mobile discovery/pairing/networking/dashboard/control code, the OpenAPI/Zod contract, simulator behavior, project documentation, and repository scripts. Physical mains wiring, SSR authenticity, thermal cutoff behavior, sensor mounting, and energized validation remain human/hardware review items rather than claims established by source inspection.

## Executive summary

| Severity | Count |
| --- | ---: |
| BLOCKER | 3 |
| MAJOR | 8 |
| MINOR | 7 |
| NIT | 2 |

The code has several strong foundations: strict runtime schemas, bounded temperature targets, firmware-owned state, acknowledged mobile mutations, completion-driven polling, latched faults, wrap-safe elapsed-time arithmetic, and useful host/unit coverage. However, the most important safety guarantees are not yet robust against task stalls, single-sensor failure modes, repeated authenticated commands, or hostile LAN conditions.

## Findings

### BLOCKER

#### B1. Software-timed SSR pulses can remain on indefinitely if the control task stalls

**Evidence:**

- `firmware/espresso-machine/components/control/src/control.cpp:394-413` changes the SSR only when `TemperatureController::update_heater()` is called.
- `firmware/espresso-machine/main/app_main.cpp:235-258` runs sensor/control updates in the main loop and also performs display work there.
- `firmware/espresso-machine/main/app_main.cpp:238` waits on the shared API mutex with `portMAX_DELAY`.
- `firmware/espresso-machine/components/networking/src/esp_networking.cpp:301-309` holds that mutex while the API handles mutations.
- `firmware/espresso-machine/components/control/src/control.cpp:125-143` persists target changes before forcing the SSR off.
- `firmware/espresso-machine/components/peripherals/src/esp_peripherals.cpp:253-257` performs synchronous NVS write/commit.

The ten-second duty window is enforced only by periodically revisiting the GPIO. If the loop is delayed while the SSR is on—because of a stuck mutex, stalled flash commit, task starvation, or another blocking path—the output remains high past the calculated pulse, with no independent one-shot forcing it low. Over-temperature sampling and the ten-minute timeout stop progressing at the same time.

**Required direction:** Drive heater pulses through a fail-off hardware timer/one-shot or dedicated high-priority control task whose deadline cannot be extended by networking, display, or NVS. Use bounded lock acquisition; force off before any persistence/blocking operation; keep flash and HTTP work outside the real-time control lock; enable watchdog recovery. The independent physical thermal cutoff remains mandatory.

#### B2. The permanent single control sensor has no independent plausibility cross-check

**Evidence:**

- Firmware now permanently reads one boiler-base MAX6675 on GPIO4/GPIO6/GPIO7 and uses that reading in both brew and steam modes.
- Open, invalid, non-finite, and transport-failed samples latch `sensor_failure`, but a plausible incorrect value remains indistinguishable from a correct value.
- The dual-sensor flag, second GPIO set, paired readings, mirroring, and disagreement constants have been removed by explicit owner decision after physical interference made two boiler-mounted probes unreliable.

The sensor, its mounting, converter, wiring, and thermal coupling are therefore a single point of control failure. Software tests cannot establish the accuracy of that physical measurement.

**Required direction:** Validate the retained sensor across brew and steam ranges against an independent calibrated instrument, quantify lag/error/overshoot, and verify open-probe fail-off behavior. Retain a correctly rated independent thermal cutoff in series with the heater. Do not treat the single-sensor architecture or passing software tests as evidence for energized safety.

#### B3. A reusable physical-control credential and commands travel over cleartext HTTP

**Evidence:**

- `firmware/espresso-machine/components/networking/include/philcoino/api.hpp:12-15` serves API v1 on HTTP port 80.
- `apps/mobile/src/networking/device-api-client.ts:207-220` sends `Authorization: Bearer ...` with state and mutation requests.
- `apps/mobile/plugins/with-android-cleartext.js:10-12` enables Android cleartext traffic globally.
- The stolen token authorizes heater permission, steam mode, maximum targets, and over-temperature dismissal after cooldown.

A passive observer on the LAN, malicious access point, or compromised router can capture and replay the token. The PRD explicitly accepts private-LAN HTTP for v1, but that product decision does not remove the physical-control vulnerability.

**Required direction:** Use an authenticated encrypted channel: preferably per-device pinned TLS or a provisioned device key with an authenticated application protocol/PAKE. Scope Android cleartext exceptions narrowly during migration and rotate any token ever sent in cleartext.

### MAJOR

#### M1. Any target PATCH—including a no-op—resets both safety deadlines

**Evidence:** `firmware/espresso-machine/components/control/src/control.cpp:125-143` always resets readiness, the heater window, `heating_demand_active_`, recovery state, and `steam_timeout_active_` after a valid save. `firmware/espresso-machine/components/networking/src/api.cpp:534-555` exposes this through authenticated PATCH.

Repeatedly sending the existing targets can indefinitely restart the ten-minute heating timeout and cancel the five-minute steam auto-return. A benign change to only the inactive target has the same effect. This violates the documented monotonic timeout behavior.

**Required direction:** Detect no-op and inactive-only changes; do not reset unrelated deadlines. Define exactly which genuine active-target change may restart which timer, and preserve an absolute maximum heating/steam deadline that remote traffic cannot extend indefinitely.

#### M2. Heating timeout resets when temperature crosses target even if readiness was never achieved

**Evidence:** `firmware/espresso-machine/components/control/src/control.cpp:196-217` clears `heating_demand_active_` whenever heat is not currently demanded, while `control.cpp:382-391` requires three continuous seconds in band for readiness.

A noisy or oscillating reading can repeatedly cross the target, reset the timeout, fall below target, and start a fresh ten-minute interval without ever remaining stable enough to become ready. That conflicts with “ten minutes from first heater demand without reaching readiness.”

**Required direction:** Keep the heating deadline active until readiness is actually achieved (or an explicit safe reset event occurs), not merely until one sample reaches/crosses target. Add oscillation and noisy-sensor tests.

#### M3. Failed off-writes are reported as heater off even when physical state is unknown

**Evidence:** `firmware/espresso-machine/components/peripherals/src/peripherals.cpp:200-224` sets `enabled_ = false` after failed off attempts; `firmware/espresso-machine/components/control/src/control.cpp:242-247` ignores the return from `force_off()` while latching a fault; `control.cpp:227-239` then serializes `heater_enabled=false`/`heaterActive=false`.

If GPIO de-energization fails after a successful on-write, software cannot know that the pin or SSR input is actually low, yet the app displays “Heater command is off.” Existing fakes set the level before returning failure and therefore do not exercise a stuck-high output.

**Required direction:** Represent output state as `on/off/unknown`, escalate a failed off-write to watchdog/reboot/fatal handling, and test a fake that remains physically high when an off-write fails. UI copy must distinguish “off command attempted” from confirmed safe physical state.

#### M4. Pairing/recovery identity can be cloned to steal the token

**Evidence:** `apps/mobile/src/discovery/device-discovery.ts:35-57` trusts mDNS TXT identity; `apps/mobile/src/pairing/pairing-service.ts:43-79,116-164` verifies only the public `deviceId` before transmitting the token; `firmware/espresso-machine/components/firmware_config/src/config.cpp:7-11` derives that public ID from only the last three MAC bytes.

A LAN attacker can advertise the same identity, serve schema-valid public/authenticated responses, collect the token, and replay it against the real machine.

**Required direction:** Provision and pin a device public key/fingerprint out of band (QR, local display code, or equivalent), and authenticate address recovery before sending credentials.

#### M5. Weak bearer tokens are accepted and authentication has no throttling

**Evidence:** `firmware/espresso-machine/main/app_main.cpp:20-23` checks only non-empty configuration; `firmware/espresso-machine/main/Kconfig.projbuild:16-20` has no entropy/length requirement; `firmware/espresso-machine/components/networking/src/api.cpp:421-459,492-495` compares tokens but adds no failed-auth rate limit.

Even a one-character configured token is accepted and can be guessed online without backoff.

**Required direction:** Generate/enforce per-device tokens with at least 128 bits of randomness, reject weak configuration, add rate limiting/backoff, and support rotation/revocation.

#### M6. mDNS failure disables the otherwise usable manual-IP HTTP API

**Evidence:** `firmware/espresso-machine/components/networking/src/esp_networking.cpp:63-71` starts HTTP, then stops it if `start_mdns()` fails.

The product promises manual address entry when discovery is unavailable, but a firmware-side mDNS startup failure removes the HTTP fallback as well.

**Required direction:** Keep HTTP serving when mDNS fails; report degraded discovery separately and retry mDNS without tearing down the API.

#### M7. OLED “disabled” diagnostic state is actually enabled in code

**Evidence:** `firmware/espresso-machine/components/firmware_config/include/philcoino/config.hpp:17` sets `kOledEnabled = true`, while `docs/TRACKER.md:25-30` and `docs/decisions/firmware-foundation.md` state it is temporarily false. `firmware/espresso-machine/main/app_main.cpp:176-203` aborts startup and forces off if the disconnected OLED cannot initialize/render.

The commit titled “Allow firmware boot without OLED” added the flag as `true`; the test at `firmware/espresso-machine/host-tests/firmware_config_test.cpp:37` checks only that it is a boolean, not the intended value. On the documented current hardware state, temperature control will not boot.

**Required direction:** Make the runtime configuration match the approved diagnostic state, test the expected value/behavior, and avoid using a display failure as an unreviewed control-availability dependency.

#### M8. The simulator does not simulate the firmware’s critical control behavior

**Evidence:** `tools/device-simulator/src/model.ts` uses a simple move-toward-target model. It does not implement the ten-second duty curve, recovery ramp, heating timeout, automatic over-temperature detection, physical sensor invalidity, mutex/task stalls, or output-write failures. Faults are manually injected.

The simulator is useful for mobile contract/UI tests, but its green tests cannot validate firmware safety or timing behavior and can conceal contract-level behavioral drift.

**Required direction:** Explicitly label it as a UI/API simulator, and add a shared behavioral conformance suite that feeds identical time/sensor/command sequences to the C++ controller and a reference model. Do not use simulator tests as evidence for heater safety.

### MINOR

#### m1. Unauthenticated slow bodies can occupy the HTTP server indefinitely

`firmware/espresso-machine/components/networking/src/esp_networking.cpp:267-309` reads request bodies before authentication and retries every socket timeout forever. Add a total body deadline/retry cap and authenticate headers before reading mutating bodies.

#### m2. No-op target writes unnecessarily consume NVS endurance

`firmware/espresso-machine/components/networking/src/api.cpp:534-555` and `firmware/espresso-machine/components/peripherals/src/esp_peripherals.cpp:253-257` commit every valid PATCH, including unchanged values. Skip unchanged writes and throttle/coalesce persistence.

#### m3. Temperature bounds are duplicated inside the firmware JSON parser

`firmware/espresso-machine/components/networking/src/api.cpp:331-367` hard-codes 85/95/110/120 instead of using `config.hpp`. Current values match, but future tuning can silently drift between domain validation and HTTP error classification. Use the authoritative constants.

#### m4. Critical-path tests omit stall and physical single-sensor scenarios

Host tests now cover the permanent single-reading controller, open-circuit failure, mode-specific limits, and rollover conversion timing. They still cannot cover physical sensor detachment/thermal lag, and there are no tests for control-loop starvation, no-op deadline resets, target-crossing-without-readiness, NVS stalls while on, or stuck-high off-write failures.

#### m5. Mobile screens are oversized and mix orchestration, presentation, and styling

`apps/mobile/components/dashboard-screen.tsx` is about 986 lines, `pairing-screen.tsx` about 566, and `machine-controls.tsx` about 553. Split stateful orchestration from focused cards/controls/styles; this will make safety-related UI states easier to review and test.

#### m6. Mobile user-facing copy is entirely hard-coded

Dashboard, pairing, error, accessibility, and mutation strings are embedded throughout `.tsx` and view-model/session files. This violates the code-review i18n quality gate and makes safety wording difficult to govern consistently. Centralize copy and add i18n before localization becomes costly.

#### m7. Forget-device storage failures are unhandled

`apps/mobile/components/pairing-screen.tsx:249-259` awaits SecureStore deletion without `try/finally`. A storage failure leaves `busy=true` and produces an unhandled rejection. Surface the failure and always restore UI state.

### NIT / maintainability

#### n1. The hand-written firmware JSON parser/serializer is a large maintenance surface

`firmware/espresso-machine/components/networking/src/api.cpp` is about 606 lines and includes custom JSON parsing/escaping rules. The current command shapes are strict, but future fields increase drift and parser-risk. Keep it aggressively tested/fuzzed or adopt a size-appropriate, pinned parser already supported by the firmware toolchain.

#### n2. Root scripts do not provide one authoritative full verification command

The root `package.json` delegates individual mobile/protocol/simulator checks but has no single test/check script and no firmware host-test entry. Add a documented aggregate command that remains install-free and clearly separates host tests from the ESP-IDF target build.

## Quality gates

All checks were run from an isolated archive under `/private/tmp` using already-installed dependencies; no packages were installed and no repository source was modified.

| Check | Result | Detail |
| --- | --- | --- |
| Firmware host compile/tests | PASS | 4/4: config, peripherals, control, API |
| Protocol typecheck | PASS | `tsc --noEmit` |
| Protocol tests | PASS | 41 passed |
| OpenAPI validation | PASS | syntax, paths, security, local refs |
| Simulator typecheck | PASS | `tsc --noEmit` |
| Simulator tests | PASS | 25 passed |
| Mobile typecheck | PASS | `tsc --noEmit` |
| Mobile tests | PASS | 52 passed |
| Mobile lint | INCONCLUSIVE | isolated archive could not reproduce Bun's normal workspace link for ESLint; only five `@philcoino/protocol` resolution errors appeared, while TypeScript/tests resolved and passed |
| ESP-IDF target build | NOT RUN | avoided dependency/toolchain installation and generated/dependency inspection |

Passing tests do not cover the blocker/major failure sequences listed above.

## Positive controls observed

- Firmware owns validation, sampling state, targets, timeouts, and fault latching; the phone is not in the real-time loop.
- Target ranges are enforced in Zod, OpenAPI, mobile requests, simulator requests, firmware HTTP parsing, and the controller storage boundary.
- Mobile mutations remain pending until validated firmware acknowledgement; polling is paused to prevent stale-response races.
- Polling is completion-driven, cancellable, and clears unavailable live state.
- Fault responses require `heaterActive=false`; over-temperature dismissal validates readings, hard limits, and cooldown.
- Bearer comparison is length-aware and constant-time for the configured expected-token length.
- Mobile token persistence uses Expo SecureStore; no production Wi-Fi password or bearer token is committed.
- The MAX6675 frame mask was checked against the manufacturer's [Rev. 3 datasheet](https://www.analog.com/media/en/technical-documentation/data-sheets/max6675.pdf): D15 must be zero, D1 is the device-ID bit, and D0 is tri-state, so ignoring D0 is correct.

## Prioritized remediation

1. Replace loop-dependent SSR pulse shutoff with a fail-off timer/task architecture and bound every shared-control wait.
2. Validate the permanent single sensor against an independent instrument and verify the independent thermal cutoff before any energized consideration.
3. Make heating and steam deadlines monotonic against no-op/remote-reset traffic and require readiness to clear heating timeout.
4. Move NVS/network/display work outside the real-time control boundary; force off before blocking work.
5. Secure pairing and transport with cryptographic device identity plus encrypted authenticated commands; enforce strong rotating credentials.
6. Correct the OLED diagnostic flag and keep manual HTTP available when mDNS fails.
7. Add the missing adversarial firmware tests and behavioral conformance suite; then rerun all gates plus ESP-IDF target build.
8. Only after software blockers are closed, execute PHIL-013 low-voltage and supervised physical validation with the independent thermal cutoff verified.

## Final assessment

The architecture is promising and much of the non-real-time application code is careful, but the temperature-control safety case is incomplete. The branch should not be merged as production-ready or used for unattended/energized operation until all BLOCKER findings and the timeout/persistence MAJOR findings are resolved and verified with adversarial host tests plus supervised hardware validation.
