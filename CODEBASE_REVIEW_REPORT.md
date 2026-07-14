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

### PRD-002 implementation addendum — 2026-07-12

PUMP-006 through PUMP-008 add a dedicated monotonic extraction controller,
strict firmware API v2 parsing/serialization, separate bounded extraction
synchronization, GPIO10 fail-off handling, OLED command labels, and cross-layer
contract tests. This does not close or downgrade the findings below:

- B1 remains open for heater GPIO20 timing; the dedicated pump task is not
  evidence that the heater control architecture is fixed.
- B3, M4, and M5 now also protect API v2 extraction commands, increasing the
  consequence of a stolen, replayed, weak, or misdirected bearer token.
- M3's physical-output uncertainty also applies conceptually to GPIO10:
  `running`/`off` are command state only and cannot prove pump current or SSR
  output state.
- M8 remains open. Simulator extraction scenarios are UI/contract evidence, not
  ESP-IDF scheduling, GPIO, SSR, or physical timing evidence.

The owner completed and accepted the PUMP-009 target functional review on
2026-07-14, reporting successful rebuilt HTTP/mDNS reachability, Manual and
profile execution, Stop/cutoff, disconnect continuation, and reset/power-cycle
non-resumption. No independently reviewed GPIO waveform, exact
board/build/instrument record, injected GPIO failure, target timer-wrap capture,
or separately authorized energized evidence was supplied. The review decision
therefore remains REQUEST CHANGES and no electrical, energized, or
production-safe claim is made.

### PRD-003 implementation addendum — 2026-07-14

STEAM-001 through STEAM-003 define and implement one compile-time, owner-selected
`+5°C` correction after raw sensor validation and only while Steam mode is
active. The controller uses the effective value for duty, recovery, readiness,
timeouts, over-temperature policy, API snapshots, and OLED input; Brew remains
raw. The API shape, target ranges, persisted targets, and mobile mutation flows
remain unchanged.

This does not close or downgrade any finding below. In particular, B2 remains
open because the correction still relies on one sensor and cannot detect a
plausible incorrect reading. API/OLED agreement, host tests, simulator tests,
contract captures, and a target build establish software behavior only. The
physical gradient, sensor mounting/lag/error, independent cutoff, SSR behavior,
and energized safety require the separately authorized STEAM-004 instrumented
human review.

The final affected software matrix passed OpenAPI validation, 71 protocol
tests, 44 simulator tests, 79 mobile tests, all configured TypeScript
typechecks/mobile lint, the strict C++17 build and 4/4 firmware host tests, and
14 generated firmware response captures. The ESP-IDF 6.0.2 target build was not
run because no configured `idf.py`/`IDF_PATH` environment was available. These
results do not change the REQUEST CHANGES assessment.

### PRD-004 implementation addendum — 2026-07-14

THERM-001 through THERM-009 add strict additive API v2 compensation/cooldown
state, deterministic simulator/mobile flows, phase-exact firmware duty bias,
volatile cooldown policy, one bounded workflow mutex, a high-priority 10 ms
workflow task, independent C++ routes/captures, and command-only OLED wording.
Target NVS now occurs after a bounded heater-off preparation and outside the
workflow mutex. The existing 1500 ms GPTimer safety lease remains independent
of HTTP/display/NVS and is renewed by healthy control updates.

These changes materially supersede some historical B1 evidence below: current
source no longer uses an unbounded temperature/extraction mutex split, and
target persistence no longer holds the workflow mutex or waits to request
heater off until after NVS. B1 nevertheless remains open pending the pinned
ESP-IDF target build, target-runtime lock/stall/watchdog evidence, physical
GPIO/SSR observation, and verification of the independent thermal cutoff. A
software GPIO-low command or timer callback cannot interrupt an SSR failed
shorted or prove heater current stopped.

No other BLOCKER or MAJOR is closed or downgraded:

- B2 remains because Steam `+5°C`, extraction `+2°C`, and cooldown all depend on
  the same single physical sensor without an independent plausibility channel.
- B3/M4/M5 now cover cooldown and extraction commands as well as temperature
  control, increasing the impact of stolen, weak, or cloned bearer authority.
- M1/M2 remain because PRD-004 deliberately does not redesign readiness or
  remote target/deadline reset semantics.
- M3 also applies to cooldown heater/pump off attempts: API/OLED expose command
  state, not confirmed electrical or mechanical state.
- M8 remains: deterministic simulator coverage is API/UI evidence, not firmware
  scheduling, GPIO, SSR, water-flow, or thermal evidence.

The final Agent matrix passed OpenAPI validation, 111 protocol tests/224
expectations, 59 simulator tests/359 expectations, 96 mobile tests/326
expectations, all configured TypeScript typechecks and mobile lint, Expo SDK 54
config, debug web export, strict C++17 build and 4/4 firmware host tests, and 26
strict generated firmware response captures. The ESP-IDF 6.0.2 target build was
not run because `idf.py`/`IDF_PATH` were unavailable, and no toolchain was
installed. THERM-002, THERM-010, and THERM-011 Human evidence remains pending;
the REQUEST CHANGES and non-production/non-energized assessment is unchanged.

## Findings

### BLOCKER

#### B1. Heater timing still lacks complete target-runtime and physical validation

**Evidence:**

- `FailOffSsr` now arms a 1500 ms GPTimer safety lease before a heater-high
  command; its cache-safe callback requests GPIO20 low and latches a trip for
  the boot.
- `main/app_main.cpp` uses one 50 ms bounded workflow mutex, a high-priority 10
  ms pump-workflow task, and an atomic fail-safe handoff. Missed acquisition
  attempts both commands off.
- Temperature target mutation now requests heater off before synchronous NVS,
  releases the workflow mutex for persistence, then reacquires it to acknowledge
  the saved targets. OLED rendering and HTTP transmission are also outside.
- The ESP-IDF 6.0.2 target build and target-runtime stall/priority/watchdog
  matrix were unavailable for PRD-004 Agent review. Host tests cannot execute
  FreeRTOS scheduling, flash stalls, cache/interrupt behavior, or actual GPIO.
- A GPIO-low request still cannot interrupt an SSR whose AC output is failed
  shorted; the independent physical thermal cutoff remains unverified.

The prior unbounded-mutex/NVS pulse-extension path is materially mitigated in
source, but the complete target timing and physical fail-off claim is not
established. A stalled sampling/control path also stops sensor validation,
over-temperature detection, readiness, and heating-timeout progress even when
the safety lease bounds the commanded GPIO-high interval.

**Required direction:** Build and exercise the pinned target with controlled
task/lock/flash/display/network stalls, verify the GPTimer deadline and latched
fault at logic level, add watchdog recovery evidence, and preserve the bounded
no-I/O workflow boundary. Independently verify the correctly rated thermal
cutoff and SSR failure behavior before any energized consideration.

#### B2. The permanent single control sensor has no independent plausibility cross-check

**Evidence:**

- Firmware now permanently reads one boiler-base MAX6675 on GPIO4/GPIO6/GPIO7 and uses that reading in both brew and steam modes.
- Steam software adds the fixed `+5°C` correction after raw validity checks,
  but this compensation provides no second measurement or plausibility
  cross-check.
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

1. Validate the implemented GPTimer fail-off lease and bounded workflow
   coordination under pinned-target stalls, add watchdog evidence, and retain
   the independent physical cutoff.
2. Validate the permanent single sensor against an independent instrument and verify the independent thermal cutoff before any energized consideration.
3. Make heating and steam deadlines monotonic against no-op/remote-reset traffic and require readiness to clear heating timeout.
4. Preserve the implemented NVS/network/display exclusion and heater-off-before-
   persistence ordering; add adversarial target-runtime evidence.
5. Secure pairing and transport with cryptographic device identity plus encrypted authenticated commands; enforce strong rotating credentials.
6. Correct the OLED diagnostic flag and keep manual HTTP available when mDNS fails.
7. Add the missing adversarial firmware tests and behavioral conformance suite; then rerun all gates plus ESP-IDF target build.
8. Only after software blockers are closed, execute PHIL-013 low-voltage and supervised physical validation with the independent thermal cutoff verified.

## Final assessment

The architecture is promising and much of the non-real-time application code is careful, but the temperature-control safety case is incomplete. The branch should not be merged as production-ready or used for unattended/energized operation until all BLOCKER findings and the timeout/persistence MAJOR findings are resolved and verified with adversarial host tests plus supervised hardware validation.
