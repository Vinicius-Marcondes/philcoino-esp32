# ESP32-C3 Super Mini Firmware Code Review

**Date:** 2026-07-16  
**Scope:** `firmware/espresso-machine`, including control, peripherals,
networking, main-task ownership, and host tests  
**Reviewed branch:** `codex/reorganize-mobile-screens`  
**Target:** ESP32-C3 Super Mini / ESP-IDF 6.0.2  
**Decision:** **REQUEST CHANGES — not production-safe or unattended-use ready**

## Method and validation

One specialist agent reviewed the firmware independently. The primary reviewer
then reconstructed each accepted interleaving from source, compared the timer
claim with the pinned ESP-IDF behavior, inspected the host-test fakes, and
discarded unsupported candidates.

Configured checks passed:

- Strict native C++ host build: passed.
- CTest: 4/4 passed.
- Firmware contract captures: 26 passed schema validation.

The ESP-IDF 6.0.2 target build was not run. Host tests cannot execute FreeRTOS
scheduling, flash-cache suspension, real ISR placement, GPIO failure, or physical
heater/pump behavior. The owner's previously reported hardware acceptance remains
valid evidence for the tested configuration, but it does not close the source and
architecture findings below.

## Severity summary

| Severity | Count |
| --- | ---: |
| BLOCKER | 4 |
| MAJOR | 5 |
| MINOR | 1 |
| NIT | 1 |
| MITIGATED / ACCEPTED | 2 |

## Findings

### FW-001 — The heater safety lease is not build-enforced as cache-safe

**Severity:** BLOCKER  
**Category:** Safety / real-time timing  
**Status:** Validated — remediation approved, implementation pending

**Remediation decision (2026-07-16):** The firmware build will enable and
enforce both `CONFIG_GPTIMER_ISR_CACHE_SAFE` and
`CONFIG_GPIO_CTRL_FUNC_IN_IRAM`. The 1,500 ms heater safety lease will remain
unchanged. This decision addresses the flash-cache delay path without consuming
the available thermal margin by lengthening the lease.

**Evidence:**

- `components/peripherals/src/esp_peripherals.cpp:306-383` implements the lease
  with a GPTimer ISR callback that calls `gpio_set_level()`.
- The callback declarations are marked `IRAM_ATTR`, but
  `main/Kconfig.projbuild:1-22` does not require the ESP-IDF GPTimer cache-safe
  ISR option or the GPIO IRAM-control option.
- `components/peripherals/src/esp_peripherals.cpp:268-287` and
  `components/networking/src/api.cpp:1106-1143` can perform a profile NVS commit
  while normal heater control is active.

ESP-IDF documents that flash reads/writes can disable cache, delaying a normal
GPTimer ISR, and that cache-disabled execution requires
`CONFIG_GPTIMER_ISR_CACHE_SAFE`. It also documents that `gpio_set_level()` is
cache-disabled/ISR-safe only with `CONFIG_GPIO_CTRL_FUNC_IN_IRAM`. See the
[ESP-IDF GPTimer cache-safety documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c3/api-reference/peripherals/gptimer.html)
and [ESP-IDF GPIO documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c3/api-reference/peripherals/gpio.html).

**Impact:** The intended 1,500 ms independent maximum heater-high lease is not a
version-controlled build guarantee. A flash operation can delay the exact ISR
path that is supposed to force GPIO20 low when normal control stops renewing it.

**Approved solution:** Enable `CONFIG_GPTIMER_ISR_CACHE_SAFE` and
`CONFIG_GPIO_CTRL_FUNC_IN_IRAM`, make both options mandatory in the
version-controlled target configuration, and fail compilation when either is
absent. Keep the callback, every function it calls, and its context data in
internal memory. Audit the map file after the pinned target build. Do not perform
flash persistence while heater output is permitted unless the lease path has
been proven cache-independent.

**Required verification:** On the ESP32-C3 target, hold the heater command high,
trigger worst-case NVS/flash operations, stop renewing the lease, and capture
GPIO20 with a logic analyzer. Prove low transition at or before 1,500 ms for each
build configuration, plus a latched trip visible to normal control afterward.

### FW-002 — A mutex-timeout emergency-off can be overwritten by the lock holder

**Severity:** BLOCKER  
**Category:** Safety / concurrency  
**Status:** Validated — remediation approved, implementation pending

**Remediation decision (2026-07-16):** Implement this finding as a small,
contained firmware change. Add a boot-latched emergency inhibit inside both
`FailOffSsr` and `FailOffPump`. A mutex timeout must set the inhibit before
requesting GPIO low, and every later high request must reject while inhibited.
Protect the inhibit check and the corresponding GPIO transition with the same
short critical section so an in-progress command cannot overtake emergency-off.
The inhibit must remain set until reboot. For defense in depth, the heater's
emergency-off path should leave an already armed safety lease active rather than
disarming it early.

**Evidence:**

- `main/app_main.cpp:144-152` calls `pump.force_off()` and `heater.force_off()`
  outside the workflow mutex when acquisition times out, then sets an atomic
  request for later fault handling.
- `components/peripherals/src/peripherals.cpp:283-328` has no internal
  serialization or emergency inhibit around an enable/force-off sequence.
- The owning workflow does not consume and latch the atomic request until it
  later acquires the mutex at `main/app_main.cpp:206-245`.

**Validated interleaving:** A lock holder begins `set_enabled(true)`, arms the
lease, and pauses before writing high. Another task times out, writes low and
disarms the lease outside the mutex. The original holder resumes and writes high.
The physical output can now be high with the safety lease disarmed until a later
control iteration notices the atomic request.

**Impact:** The emergency action is not monotonic: later work already in progress
can reverse it. This defeats both the immediate fail-off intent and, in the stated
interleaving, the independent lease bound.

**Approved solution:** Add a latched, atomic emergency inhibit owned by the
output layer. Set the inhibit before attempting low. Every high request must
check it before arming, after arming, and inside a short critical section shared
with the final GPIO transition; a detected inhibit must write low and leave the
lease in a safe state. Emergency-off must use that same critical section, and
the inhibit may only clear during boot initialization.

**Required verification:** Add deterministic barrier-based host tests for every
step of enable versus force-off, then stress the same race on target while
capturing GPIO20. No ordering may produce high after the emergency inhibit is set.

### FW-003 — A failed pump-off write is recorded as off and is not retried

**Severity:** BLOCKER  
**Category:** Safety / output-state certainty  
**Status:** Validated — remediation approved, implementation pending

**Remediation decision (2026-07-16):** Implement confirmed output-state
tracking for the pump. A failed GPIO-low write must leave the pump state as
unknown/failed-off rather than logical off, latch an `internal_error`, block new
extraction and cooldown starts, and cause every control iteration to retry the
low command until it succeeds or the device reboots. API/OLED state must not
represent an unconfirmed low write as confirmed off. If `unknown` is added to
the wire representation, begin the change in `packages/protocol/openapi.yaml`
and align schemas, fixtures, simulator, mobile, firmware captures, and tests.

**Evidence:**

- `components/peripherals/src/peripherals.cpp:381-386` sets `command_` to off
  before attempting the physical low write.
- The existing fake explicitly demonstrates the mismatch at
  `host-tests/peripherals_test.cpp:382-390`: after a failed low write, the fake
  remains high while `command()` reports off.
- Idle extraction and cooldown updates skip `force_off()` when the command is
  already logically off at `components/control/src/control.cpp:646-650` and
  `:821-826`.
- `main/app_main.cpp:247-251` only logs extraction output failure; it does not
  latch a machine fault or maintain a retry loop.

**Impact:** A pump GPIO/driver failure can leave GPIO10 high while firmware state
reports idle/off. Subsequent idle updates accept the logical value and do not
retry the physical low command. This can continue water flow beyond the requested
or maximum extraction interval.

**Approved solution:** Separate requested state, last confirmed command, and
`output_state_unknown`. Only publish confirmed off after a successful low write.
On any failed off write, latch an internal machine fault and retry low on every
control cycle (or reboot through a supervised fail-safe path) while keeping all
workflows blocked. Add an independent hardware mechanism where continued pump
operation has unacceptable consequences.

**Required verification:** Extend host tests through `ExtractionController` and
`CooldownController` using a stuck-high output. Assert repeated low attempts,
latched fault state, and no idle/off success report until a low write succeeds.
Inject the equivalent failure on target and observe GPIO10/current directly.

### FW-004 — One plausible-low sensor failure can command uncontrolled heating

**Severity:** MITIGATED / ACCEPTED (originally BLOCKER)  
**Category:** Safety / sensor architecture  
**Status:** Owner-confirmed hardware mitigation — no firmware change planned

**Mitigation decision (2026-07-16):** The machine retains its original
manufacturer-installed, non-resettable mechanical thermal fuse. The fuse is
wired in series with the heater power path and opens independently of the
ESP32-C3, firmware, GPIO20, and SSR control signal. Firmware cannot bypass or
reset it. The firmware target is limited to 120°C and the independent fuse is
rated to open at 140°C. This independent hardware cutoff is accepted as the
catastrophic over-temperature mitigation; a second firmware control sensor is
not required for the approved prototype configuration.

**Evidence:**

- `components/firmware_config/include/philcoino/config.hpp:51-53` configures one
  boiler thermocouple.
- `components/control/src/control.cpp:479-490` rejects invalid and over-limit
  readings but has no independent plausibility comparison.
- All brew and steam heater decisions use that same reading; Steam's software
  offset is not an independent measurement.

**Residual impact:** An electrically valid but incorrectly low reading caused by
mounting, converter drift, wiring, or thermal coupling remains indistinguishable
from a cold boiler. Firmware could demand unnecessary heat until its timeout or
the independent fuse opens. A fuse trip permanently disables the heater and
requires physical service, but the accepted independent series cutoff prevents
firmware from being the sole catastrophic over-temperature protection.

**Accepted solution:** Preserve the original manufacturer thermal fuse, its
series wiring, physical mounting, and 140°C rating. Never bypass it or replace it
with a resettable/software-controlled device. Any replacement must meet the
original manufacturer's temperature, voltage, current, breaking-capacity, and
installation requirements. Retain the 120°C firmware target ceiling.

**Closure evidence:** The owner confirmed the original manufacturer fuse is
present, non-resettable, mechanically actuated, in series with heater energy, and
independent of ESP32/firmware control. Earlier owner-reported technical-equipment
checks accepted the installed energy-control configuration. The single-sensor
diagnostic limitation remains documented, but there is no pending firmware task
for FW-004.

### FW-005 — Plaintext HTTP and an unconstrained static bearer protect physical commands

**Severity:** BLOCKER  
**Category:** Security / command authorization  
**Status:** Validated — cross-layer remediation approved, implementation pending

**Remediation decision (2026-07-16):** Replace plaintext reusable-bearer
authentication with encrypted, cryptographically authenticated per-device
pairing and sessions. A machine's IP address is only a temporary network locator;
it must never be used as its identity or credential binding. After one successful
pairing, the mobile app must reconnect automatically when DHCP changes the same
machine's address, but only after the new endpoint proves possession of the
previously pinned device identity. A public `deviceId` or copied mDNS record is
not sufficient proof.

The approved architecture must:

1. Give each ESP32-C3 a persistent cryptographic identity key/certificate that
   survives reboot, DHCP changes, and normal firmware updates.
2. Use a high-entropy, device-specific bootstrap secret only for initial pairing;
   never transmit that secret as a reusable bearer value.
3. Pin the authenticated device identity in mobile SecureStore and issue/store a
   per-app credential or key after pairing.
4. Establish encrypted sessions with integrity and replay protection before any
   credential, state, or physical command is exchanged.
5. Require a rediscovered/cached address to prove the pinned private identity
   before the app updates `lastSuccessfulAddress` or sends its client credential.
6. Support explicit client revocation, device-key rotation/re-pairing, and a
   documented factory-reset recovery path; never silently trust a changed key.
7. Reject plaintext/downgrade access to protected routes after migration.

ESP-IDF's supported HTTPS/TLS server components should be preferred over a
home-grown encrypted transport. The exact Expo 54 certificate-pinning/native
network implementation and any new dependency require a reviewed implementation
decision before packages or native configuration are introduced.

**Evidence:**

- `components/networking/include/philcoino/api.hpp:12-15` serves HTTP on port 80.
- `main/Kconfig.projbuild:16-20` accepts an arbitrary token string.
- `main/app_main.cpp:22-25` only verifies that the token is non-empty.
- `components/networking/src/api.cpp:797-835` compares the token carefully, but
  the protected physical-command routes at `:865-889` still receive it in cleartext.

**Impact:** A LAN observer can steal/replay the token, while a weak configured
token can be guessed. The same authority controls heater and pump workflows.
Constant-time comparison does not provide confidentiality, replay protection,
rate limiting, rotation, or device authentication.

**Approved solution:** Implement the per-device cryptographic identity,
encrypted session, and IP-independent reconnection requirements above together
with MOB-001/MOB-002. Enforce generated high-entropy bootstrap credentials,
rotation/revocation, request freshness, and throttling. Keep all physical
commands fail-safe when authentication state is uncertain. Start the breaking
wire change in `packages/protocol/openapi.yaml`, version it explicitly, and align
firmware, simulator, mobile, fixtures, captures, tests, and public documentation.

**Required verification:** In addition to replay, expired-session, rotation,
rate-limit, downgrade, and packet-capture tests, pair once at address A, change
the same device to address B, rediscover it, and prove automatic reconnection
without re-entering the bootstrap secret. A second endpoint that copies the
device ID at address B must receive no client credential or command. Cover device
reboot, router/DHCP renewal, mDNS recovery, manual-address recovery, app restart,
identity-key change, and factory reset.

### FW-006 — No-op and inactive-target writes reset safety deadlines

**Severity:** MAJOR  
**Category:** Safety policy / remote mutation semantics  
**Status:** Validated — remediation approved, implementation pending

**Remediation decision (2026-07-16):** Implement target-change semantics that
preserve controller-owned safety deadlines. A no-op temperature PATCH must
return the current acknowledged targets without writing NVS or resetting
readiness, heating-demand, heater-window, recovery, or Steam timeout state. A
change affecting only the inactive mode target may be persisted and acknowledged,
but must not reset the active mode's readiness or safety deadlines. Only a real
change to the active target may start the explicitly defined target-transition
behavior, and ordinary authenticated requests must never extend an already
running absolute heating or Steam deadline.

**Evidence:**

- `components/networking/src/api.cpp:954-993` persists and adopts every valid
  temperature PATCH, including unchanged values.
- `components/control/src/control.cpp:216-231` resets readiness, heater-window,
  heating-demand, recovery, and steam-timeout state whenever persisted targets
  are adopted.

**Impact:** Repeating an authenticated no-op PATCH can continually restart the
heating timeout. Changing only the inactive mode target also resets the active
mode's deadlines. A faulty client or stolen credential can therefore extend
heating without changing the effective target.

**Approved solution:** Compare the validated update with current targets under the control
lock. Return success without persistence or deadline changes for a no-op. When
only the inactive target changes, persist it without resetting active-mode safety
state. Track safety deadlines as absolute controller state that ordinary remote
configuration cannot refresh.

**Required verification:** Repeatedly send no-op and inactive-target PATCHes
across the heating-timeout boundary and assert that the original deadline still
latches the fault. Preserve wraparound coverage.

### FW-007 — Crossing the target once restarts the heating timeout

**Severity:** MAJOR  
**Category:** Safety policy / timeout semantics  
**Status:** Validated — remediation approved, implementation pending

**Remediation decision (2026-07-16):** Implement an absolute warm-up deadline
that starts with the first heating-demand episode and remains active through
temporary target crossings and oscillation. A momentary reading at or above the
target must not clear or restart it. The deadline may close only after the
existing continuous ready-stability requirement is satisfied, or through an
explicitly defined safe transition such as heater disable, reviewed mode change,
fault, or reboot. If post-readiness recovery requires a timeout, model it as a
separate deadline rather than reusing or extending the original warm-up limit.

**Evidence:** `components/control/src/control.cpp:288-309` clears
`heating_demand_active_` whenever temperature no longer demands heat, even if the
stable-ready condition has not completed. `active_temperature_demands_heat()` at
`:379-381` becomes false at the target crossing, while readiness requires a
stable interval at `:493-502`.

**Impact:** A system that briefly reaches target, then repeatedly falls below it,
receives a fresh heating timeout each cycle without ever becoming stably ready.
The timeout therefore does not bound total time to achieve stable readiness.

**Approved solution:** Define and track an absolute warm-up deadline from the
beginning of a heat-up episode. Clear it only after stable readiness, explicit
heater disable, a safe mode transition, or a fault/reset policy—not on a single
target crossing. If recovery needs a different bound, model it as a separate
named deadline.

**Required verification:** Feed oscillating temperatures that cross the target
without satisfying the ready-stability duration. Assert a heating-timeout fault at
the original absolute deadline.

### FW-008 — Target persistence does not keep the heater inhibited for the full transaction

**Severity:** MAJOR  
**Category:** Safety / persistence transaction  
**Status:** Validated — remediation approved, implementation pending

**Remediation decision (2026-07-16):** Implement a controller-owned
`target_update_in_progress` heater inhibit covering the complete persistence
transaction:

1. Under the workflow mutex, set `target_update_in_progress = true` before
   forcing the heater off.
2. Make `update_heater()` reject every heater-high request while the inhibit is
   set; it must continue requesting off.
3. Keep the NVS save outside the workflow mutex.
4. After a successful save, reacquire the mutex, validate/install the persisted
   targets, and clear the inhibit only after adoption completes successfully.
5. If persistence fails, the unchanged old targets may resume only through an
   explicit rollback transition performed under the mutex. The rollback must
   validate that the old targets remain authoritative, reset the heater-control
   window safely, and clear the inhibit only after it succeeds.
6. If the mutex cannot be reacquired, adoption fails, or rollback fails, retain
   the inhibit, keep requesting heater off, and latch/request `internal_error`.

No mutex may be held during NVS I/O, and no failure path may implicitly clear the
inhibit.

**Evidence:**

- `components/networking/src/api.cpp:975-993` locks and calls
  `prepare_target_update()`, unlocks for NVS, then locks again to adopt.
- `components/control/src/control.cpp:204-213` requests heater off but sets no
  persistent inhibit.
- The normal control task can run between those locks and re-enable heat using
  the old targets and permissions.

**Impact:** The stated heater-off-before-persistence boundary is momentary rather
than transactional. Heater output can resume during the flash operation, which
also compounds FW-001.

**Approved solution:** Add a target-update inhibit established under the
workflow lock before forcing off. Normal control must honor it until persistence
succeeds or fails and final state is adopted. On persistence failure, remain
safely off until the controller explicitly rolls back/unlatches through a
reviewed transition. Keep NVS outside the mutex.

**Required verification:** Pause the storage backend between prepare and adopt,
run many control iterations, and assert that no heater-high request occurs. Test
successful persistence/adoption, persistence failure with successful rollback,
rollback failure, adoption failure, and mutex-reacquisition failure. Only the
explicit successful rollback may resume the old targets; every unresolved path
must remain inhibited with `internal_error` latched/requested.

### FW-009 — Extraction idempotency is forgotten immediately at completion or stop

**Severity:** MAJOR  
**Category:** Reliability / command replay  
**Status:** Validated — cross-layer remediation approved, implementation pending

**Remediation decision (2026-07-16):** Retain a volatile terminal extraction
idempotency record after completion, explicit stop, or output failure. The record
must contain the idempotency key, normalized selection/request identity,
extraction ID, terminal outcome, and the response data required to answer a
replay without starting the pump.

- Repeating the same key with the same normalized selection must return the same
  logical extraction identity/result and must never issue another pump-high
  command.
- Reusing the same key with a different selection must return a deterministic
  conflict/idempotency-mismatch error; it must not replay or start anything.
- Preserve the terminal record until a different extraction key is successfully
  accepted or the device reboots. Rejected attempts must not evict it.
- Reboot semantics are explicitly volatile: after an uptime reset, the mobile
  mutation layer must not retry a pre-reboot extraction-start request. If stronger
  cross-reboot idempotency is later required, design it separately without adding
  an NVS write to every extraction by default.
- Define the terminal replay representation and mismatch error in the protocol
  before implementation, then align firmware, simulator, mobile, fixtures,
  captures, and tests.

**Evidence:**

- `components/control/src/control.cpp:603-638` recognizes a replay only while an
  extraction is active.
- `clear_active()` at `:723-730` deletes the idempotency key and extraction ID.
- Completion and stop call that function at `:641-657`.
- Cooldown already demonstrates the safer pattern by retaining its terminal key
  and ID at `:777-818`.

**Impact:** If the start response is lost and the client retries after the short
extraction completes, the same idempotency key starts a second pump run. This
violates the purpose of an idempotency key and can double an extraction.

**Approved solution:** Retain a bounded terminal idempotency record containing
the key, selection, extraction ID, outcome, and terminal timing. A replay must
return the same logical result instead of starting again. Define eviction/reboot
semantics in the wire contract; if terminal state is exposed, update OpenAPI,
schemas, simulator, mobile, firmware captures, and tests together.

**Required verification:** Drop the original response, advance beyond completion,
and repeat the identical request. Assert the same extraction ID/outcome and no
second pump-high command. Repeat after explicit stop and output failure. Verify
that the same key with a different selection returns the defined mismatch error,
a rejected different key does not evict the terminal record, a successfully
accepted different key does replace it, and the mobile does not replay an
in-flight pre-reboot key after detecting an uptime reset.

### FW-010 — A failed heater-low write is reported as inactive

**Severity:** MITIGATED / ACCEPTED (originally MAJOR)  
**Category:** Safety / state observability  
**Status:** Accepted command-state semantics — no separate protocol change planned

**Mitigation decision (2026-07-16):** `heaterActive` and the OLED heater value
represent the firmware's command state only; they are not confirmation of GPIO
voltage, SSR contact state, heater current, or mains isolation. A failed low
write must continue to return failure and latch `internal_error`. The existing
armed safety lease must not be disarmed after a failed-off write, and faulted
control iterations must continue retrying the low command. FW-001 will make the
lease callback cache-safe, while FW-002 will prevent an emergency-off command
from being overtaken. The original manufacturer-installed series thermal fuse
remains the independent physical over-temperature protection.

No `on | off | unknown` wire-state expansion is required for FW-010 because
software GPIO acknowledgement still cannot prove electrical heater current. A
future electrical-confirmation feature would require independent current or
contactor feedback and must not be inferred from this command-state field.

**Evidence:** `components/peripherals/src/peripherals.cpp:315-328` sets
`enabled_ = false` before returning a failed low write. `is_enabled()` at
`:331-337` consequently reports false even when the output abstraction could not
confirm low. API snapshots derive heater state from this logical flag.

**Residual impact:** API/OLED can show the heater command as inactive while GPIO
or the downstream SSR remains energized. This is accepted because the same state
also exposes a latched `internal_error`, the command is retried, the safety lease
remains armed, and the UI/documentation does not claim confirmed electrical off.
No software value confirms mains current.

**Accepted solution:** Preserve command-only reporting, latched
`internal_error`, repeated low attempts, the still-armed safety lease, and the
independent manufacturer thermal fuse. Documentation and UI wording must never
describe `heaterActive: false` as confirmed mains isolation.

**Closure verification:** As part of FW-001/FW-002 testing, use a GPIO fake that
preserves high on a failed-low write. Assert `internal_error`, command-state
reporting, repeated low attempts, and that the lease was not disarmed. Target
logic-level testing must confirm the cache-safe lease trip; it must not be
presented as proof of SSR current or mains isolation. There is no separate
firmware implementation task for FW-010.

### FW-011 — mDNS startup failure tears down a healthy HTTP server

**Severity:** MAJOR  
**Category:** Availability / recovery  
**Status:** Validated — remediation approved, implementation pending

**Remediation decision (2026-07-16):** Decouple API availability from mDNS
advertisement. After Wi-Fi and the HTTP/HTTPS API server start successfully, an
mDNS initialization or advertisement failure must leave the API server running
and mark discovery as degraded. Retry mDNS independently with bounded backoff.
Service start/stop/retry operations must be idempotent, must not register
duplicate handlers, and must recover correctly after Wi-Fi disconnect/reconnect.
Manual-address access remains available throughout discovery degradation. mDNS
identity remains untrusted routing metadata and must not replace the pinned
cryptographic identity approved in FW-005.

**Evidence:** `components/networking/src/esp_networking.cpp:79-87` starts Wi-Fi
and HTTP, but if mDNS fails it stops HTTP and returns failure. Mobile and project
documentation advertise manual-address entry as the fallback when discovery is
unavailable.

**Impact:** The implementation removes the exact service required by manual
fallback. A transient mDNS failure makes the machine unreachable until reboot or
another external recovery path, even though the HTTP server started successfully.

**Approved solution:** Treat mDNS advertisement as a degradable service. Keep
HTTP alive, report degraded discovery status, and retry mDNS with bounded
backoff. Ensure network reconnect logic can restart either service independently
without duplicating handlers.

**Required verification:** Force `start_mdns()` to fail while HTTP succeeds and
prove health/device/authenticated endpoints remain reachable by IP. Then allow a
later retry to advertise successfully without restarting control. Repeat failure,
recovery, Wi-Fi disconnect/reconnect, and API restart sequences; assert one set
of handlers/advertisements, bounded retry timing, and uninterrupted manual-IP
access whenever the API server itself is healthy.

### FW-012 — Request bodies are read before authentication with an unbounded timeout loop

**Severity:** MINOR  
**Category:** Security / resource exhaustion  
**Status:** Validated — remediation approved, implementation pending

**Remediation decision (2026-07-16):** For every protected route, validate the
method/path and authenticated secure session or client credential before reading
the request body. Apply a monotonic absolute body deadline, finite timeout count,
and existing maximum byte limit; close or reject the request when any limit is
exceeded. Do not loop indefinitely on `HTTPD_SOCK_ERR_TIMEOUT`. Public health,
identity, and initial-pairing routes must also have bounded header/body time even
when their authentication policy differs. The FW-005 encrypted-session migration
must preserve these limits rather than relying on TLS alone to prevent slow-client
resource exhaustion.

**Evidence:** `components/networking/src/esp_networking.cpp:276-313` reads the
authorization header, then receives the full body before calling
`FirmwareApi::handle()`. Repeated `HTTPD_SOCK_ERR_TIMEOUT` results continue the
loop indefinitely.

**Impact:** An unauthenticated slow client can occupy an HTTP worker by declaring
a bounded body length and sending it indefinitely slowly. The 1,024-byte size cap
limits memory, but not worker time or connection starvation.

**Approved solution:** Reject missing/malformed authorization before reading
protected route bodies. Add an absolute per-request body deadline and a maximum
timeout count, then close the connection. Configure bounded server socket
timeouts and consider per-peer throttling.

**Required verification:** Send an authorized and unauthenticated slow body with
repeated timeouts. Assert bounded termination, worker availability for another
client, and correct authentication/timeout behavior. Cover exact-size and
oversized bodies, partial bodies, pairing routes, TLS/session establishment, and
deadline arithmetic across uptime wrap. No slow or unauthenticated request may
delay heater Stop/state traffic indefinitely.

### FW-013 — The API codec is a 1,281-line hand-written maintenance hotspot

**Severity:** NIT  
**Category:** Maintainability / code smell  
**Status:** Implemented — PRD-005 acceptance evidence pending

**Planning decision (2026-07-16):** FW-013 is important architectural work and
must become its own reviewed PRD before implementation. It is explicitly outside
the bulk FW-001–FW-012 remediation batch. A later implementation agent must not
perform an opportunistic rewrite of `api.cpp` while fixing another finding.

The dedicated PRD must define supervised tasks and acceptance evidence for:

1. Characterizing all accepted/rejected API v1/v2 inputs and exact response
   shapes before moving code.
2. Separating routing/authentication, per-domain parsing, validation,
   serialization, and controller/storage orchestration into single-purpose
   owners without changing current wire behavior in the initial refactor.
3. Preserving strict unknown-field rejection, error taxonomy, authentication
   boundaries, bounded input sizes, and independent C++ contract validation.
4. Adding malformed-input fuzz/property coverage and sanitizer-backed host tests
   around the pure codec boundaries.
5. Measuring firmware binary size, RAM/stack impact, compile warnings, and
   ESP32-C3 target compatibility at each extraction stage.
6. Coordinating with the FW-005 versioned authentication/protocol work so the
   refactor reduces, rather than duplicates, the future secure API surface.
7. Treating any embedded JSON library or new dependency as a separate explicit
   decision requiring owner approval; the PRD must include a no-new-dependency
   path.
8. Migrating incrementally with reversible stages and running protocol fixtures,
   simulator/mobile compatibility checks, firmware captures, and the target
   build before completion.

**Evidence:** `components/networking/src/api.cpp` is 1,281 lines and combines
manual JSON tokenization, validation, routing, serialization, authorization, and
controller/storage orchestration for API v1 and v2.

**Impact:** Contract changes require editing a large, coupled parser/serializer
surface independently from the TypeScript schemas. This raises drift and edge-case
risk even though current fixture/capture tests are valuable.

**PRD direction:** First split pure per-domain parsing and serialization from
routing and orchestration without changing the wire contract. Expand
accepted/rejected fixtures and add fuzz/property tests around the pure codec. A
new embedded JSON dependency should only be considered through an explicit,
reviewed dependency decision; it is not required for the initial refactor.

**Required verification:** Preserve byte/shape compatibility for all captures,
run malformed-input fuzzing under sanitizers on host, and keep the pinned target
size/build budget visible.

**Implementation update (2026-07-17):** PRD-005 was approved, split into
FWAPI-001 through FWAPI-007, and implemented on
`feature/PRD-005-firmware-api-codec`. Generic JSON syntax, machine codecs,
workflow codecs, response/error helpers, route/access metadata, orchestration,
and ESP-IDF transport now have separate owners. All 29 final captures are
byte-identical to the untouched `main` baseline and validate against the strict
protocol schemas; native and ASan/UBSan suites pass; and the pinned ESP-IDF
6.0.2 target image grows by 496 bytes (0.0439%) with no `.data + .bss` growth.

FW-013 is not yet marked closed. Connected-target request heap and HTTP
high-water stack measurements are unavailable, and separate target snapshots
were not preserved for every logical extraction stage. The exact evidence and
remaining acceptance checks are recorded in
`docs/prds/PRD-005/evidence/IMPLEMENTATION.md`. FW-005 remains separate and
release-blocking.

## Rejected candidates

The primary validation rejected or narrowed these candidate concerns:

- unsigned timer wraparound is handled with subtraction-based elapsed checks;
- Steam's temperature offset is not applied twice;
- extraction and cooldown mutual exclusion is enforced;
- the prior stale-OLED concern is superseded by the enabled display path;
- MAX6675 data-out GPIO5 is used as input and is not configured as an output;
- NVS is not performed while holding the workflow mutex; FW-008 is specifically
  the missing heater inhibit across the unlocked persistence interval;
- mode and heater-enable transitions were not categorized as deadline bypasses:
  identical values are short-circuited, while explicit disable/mode changes have
  distinct safety semantics. FW-006 is limited to no-op/inactive target writes.

## Recommended order

1. Fix FW-001 through FW-003 before relying on the firmware safety lease or
   command-state reporting.
2. Preserve the accepted FW-004 manufacturer thermal fuse without modification,
   and address FW-005 as an architecture/protocol change.
3. Make deadlines and persistence transactional through FW-006 to FW-008.
4. Repair FW-009, FW-011, and FW-012; preserve the accepted FW-010 command-state
   semantics and verify them with FW-001/FW-002.
5. Create and approve the dedicated FW-013 PRD, then execute its incremental
   behavior-preserving refactor separately from the remediation batch.
