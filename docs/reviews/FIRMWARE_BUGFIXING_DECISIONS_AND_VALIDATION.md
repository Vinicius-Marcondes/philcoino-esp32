# Firmware bug-fixing decisions and validation

Date: 2026-07-16

Branch: `bugfixing`
Source review: `docs/reviews/FIRMWARE_CODE_REVIEW.md`

## Scope and completion state

This batch implements the approved remediation for FW-001, FW-002, FW-003,
FW-006, FW-007, FW-008, FW-009, FW-011, and FW-012. FW-004 and FW-010 retain
their approved accepted/mitigated behavior. FW-013 was intentionally excluded
from this batch and is now implemented separately under PRD-005; its remaining
target-runtime and incremental resource evidence stays tracked there.

FW-005 is **not implemented**. It remains a release-blocking security finding.
The mobile half requires an Expo 54 local native module for authenticated TLS
identity pinning. The official Expo module workflow requires the
`create-expo-module` scaffolder, but downloading or installing that tool is not
authorized by this repository's rules. An approval request was rejected because
the owner did not explicitly permit the download. No handwritten substitute was
introduced because it would bypass both the project rule and the official module
scaffold required for the pinned Expo version.

## Decisions taken

### FW-001 — cache-safe heater lease

- Kept the 1,500 ms lease unchanged.
- Kept both required settings in `sdkconfig.defaults` and added compile-time
  failures if `CONFIG_GPTIMER_ISR_CACHE_SAFE` or
  `CONFIG_GPIO_CTRL_FUNC_IN_IRAM` is disabled in the effective target config.
- Did not treat host compilation as proof of cache-disabled target behavior.

### FW-002 — emergency output race

- Added separate boot-latched emergency inhibits to the pump and SSR owners.
- Serialized each inhibit check and GPIO transition through the same short
  output critical section.
- Routed workflow-mutex timeouts through `emergency_off()` for both outputs.
- Rejected every later high command after an emergency inhibit. Only reboot and
  output reinitialization clear it.
- Left an armed SSR safety lease armed after emergency-off, including later
  normal off retries, for an independent delayed low transition.

### FW-003 and accepted FW-010 — failed low commands

- The pump now records only a successfully acknowledged command. A failed low
  after a confirmed running command retains `running` as the last confirmed
  command and separately records output state as unknown.
- Chose not to add an `unknown` wire enum. The existing `pumpCommand` now means
  last confirmed command, while the terminal extraction outcome and machine
  `internal_error` expose the failure. This preserves strict compatibility and
  avoids claiming electrical feedback that the hardware does not provide.
- Idle extraction and cooldown control retry low on every iteration while the
  pump state is unknown. New pump-high requests remain blocked.
- A failed extraction output command retains a failed terminal record; API and
  OLED state do not collapse a last-confirmed running command to off.
- Preserved FW-010's command-state semantics for the SSR. Failed low commands
  latch `internal_error`, keep the lease armed, and are retried; no software
  field is described as proof of mains isolation.

### FW-004 — accepted hardware mitigation

- Made no firmware behavior change. The approved manufacturer thermal fuse
  decision remains intact. Its physical presence and rating still require owner
  verification and are not proven by this batch.

### FW-005 — secure device identity and sessions

- Selected the approved direction: persistent ESP32 device identity,
  authenticated encrypted transport, device-identity pinning in an Expo local
  native module, per-app credentials, replay protection, revocation, rotation,
  and explicit factory-reset/re-pairing behavior.
- Did not partially migrate ports, discovery metadata, credentials, or storage.
  A partial HTTPS or public-key-only change would leave misleading mixed trust
  boundaries and would not satisfy the approved finding.
- Required next authorization: explicitly allow Expo's official local-module
  scaffolder to be downloaded/run. Generated native projects, additional crypto
  dependencies, and device key provisioning must each remain separately
  reviewed if they become necessary.

### FW-006 and FW-007 — absolute heating deadlines

- A no-op target PATCH now returns the current acknowledgement without NVS I/O
  or controller resets.
- An inactive-mode target change persists without resetting the active mode's
  readiness, warm-up, recovery, heater-window, or Steam deadline.
- The initial warm-up deadline starts on first heating demand and remains
  absolute across temporary target crossings and active-target changes.
- Stable readiness closes the warm-up deadline. A later heat-recovery episode
  uses its own absolute recovery deadline rather than restarting warm-up.
- Explicit heater disable, reviewed mode change, fault, and reboot retain their
  approved deadline-reset semantics.

### FW-008 — target persistence transaction

- Added a controller-owned `target_update_in_progress` inhibit before forcing
  the SSR command low.
- NVS remains outside the workflow mutex. Normal controller iterations continue
  requesting low for the full unlocked persistence interval.
- Adoption and rollback are explicit locked transitions. Adoption or rollback
  failure retains the inhibit and latches/requests `internal_error`.
- A real active-target adoption resets readiness/control-window state but never
  extends an already running absolute heating deadline.

### FW-009 — terminal extraction idempotency

- Added a volatile terminal extraction record containing the key, normalized
  selection, extraction ID, outcome, elapsed time, and last confirmed pump
  command.
- Replaying the same key and selection returns the retained result without a
  pump-high command. Reusing the key with another selection returns HTTP 409
  `idempotency_mismatch`.
- Rejected different keys do not evict the terminal record; a different accepted
  extraction does. Reboot clears it by design.
- Extended OpenAPI, Zod schemas, fixtures, firmware serialization/captures,
  simulator behavior, mobile parsing, localization, and tests together.
- Mobile polling detects uptime rollback and clears volatile pending extraction
  and cooldown keys before any retry against the rebooted device.

### FW-011 — mDNS degradation

- HTTP remains available when mDNS startup fails.
- mDNS retries in a single idempotent recovery task with exponential delay from
  1 second to a 30-second maximum.
- HTTP handler registration and mDNS startup are guarded against duplication.
  A recovered IP connection can request mDNS recovery without restarting the
  control loop or HTTP server.

### FW-012 — authentication and bounded request bodies

- Protected routes authenticate before reading any body.
- Kept the 1,024-byte body limit and added a two-second monotonic absolute body
  deadline, at most three socket timeouts, a one-second receive timeout, and a
  two-second send timeout.
- The absolute deadline is checked even while a client continues sending small
  successful chunks; it is not merely a timeout counter.
- Public routes still pass through the same bounded server socket behavior.

## Automated validation completed

- Fresh host CMake build and CTest: 4/4 suites passed.
- Deterministic barrier-based SSR/pump emergency race tests passed.
- Firmware response capture validation: 26 captures passed against the shared
  protocol.
- OpenAPI structural/security/reference validation passed.
- Protocol: 115 tests passed; TypeScript typecheck passed.
- Device simulator: 60 tests passed; TypeScript typecheck passed.
- Mobile: 100 tests passed; TypeScript typecheck and Expo lint passed.

An ESP-IDF 6.0.2 toolchain was not available in this environment, so the real
ESP32-C3 target build, map/IRAM audit, and hardware tests remain mandatory.

## Owner and hardware validation still required

Do not energize mains hardware merely to complete this checklist. Use the
project's safety procedure, isolation, current limiting, qualified supervision,
and low-voltage substitutes where specified.

- [ ] Build the ESP32-C3 target with pinned ESP-IDF 6.0.2. Confirm both cache-safe
  config symbols are `y`; inspect the map/placement of the GPTimer callback and
  its GPIO-low path.
- [ ] With a logic analyzer on GPIO20, create worst-case NVS/flash activity, stop
  lease renewal, and prove low at or before 1,500 ms. Confirm the lease trip is
  latched and normal control cannot re-enable output.
- [ ] Stress every enable/emergency ordering on GPIO20 and GPIO10. After the
  emergency inhibit is set, prove no later high transition occurs until reboot.
- [ ] Inject a stuck-high/failed-low pump output. Confirm repeated low attempts,
  latched `internal_error`, no new extraction/cooldown start, API last-confirmed
  command reporting, OLED `PUMP CMD RUN FAULT`, and actual GPIO/current behavior.
- [ ] Inject a failed SSR-low write. Confirm the lease remains armed, low retries
  continue, the fault is visible, and UI wording is treated only as command state,
  not electrical isolation.
- [ ] Send repeated no-op, inactive-target, active-target, and oscillating target
  traffic across the original warm-up deadline, including 32-bit uptime wrap.
  Confirm no request extends that deadline and recovery uses a new deadline only
  after stable readiness.
- [ ] Pause target NVS save between prepare and adopt. Run control iterations and
  prove GPIO20 never receives high. Exercise success, save failure with rollback,
  rollback failure, adoption failure, and mutex reacquisition failure.
- [ ] Lose extraction start/completion/stop responses and replay the same key.
  Confirm the same terminal identity is returned with no pump-high transition;
  verify mismatch and rejected-key retention. Reboot during an unacknowledged
  mobile request and confirm the app uses a fresh key.
- [ ] Force mDNS start failure while the API succeeds. Confirm authenticated and
  public routes remain reachable by IP, bounded retry later advertises once, and
  disconnect/reconnect does not duplicate handlers or interrupt control.
- [ ] Exercise authorized and unauthorized slow bodies, continuous small chunks,
  exact 1,024-byte and oversized bodies, partial disconnects, and uptime wrap.
  Confirm bounded worker release and availability for concurrent Stop/state calls.
- [ ] Physically verify the accepted non-resettable 140°C thermal fuse is present,
  correctly rated, in series with heater energy, and independent of firmware.
- [ ] After FW-005 authorization and implementation, validate DHCP address change,
  false-device substitution, device reboot, app restart, key rotation, revocation,
  factory reset, and refusal to send credentials before the endpoint proves the
  pinned device identity.

## Remaining release blockers

- FW-005 remains open and plaintext reusable-bearer HTTP remains in the product.
- The ESP32-C3 target build and every target/hardware validation above remain
  incomplete.
- No simulator or host result in this note is heater-safety or mains-isolation
  evidence.
