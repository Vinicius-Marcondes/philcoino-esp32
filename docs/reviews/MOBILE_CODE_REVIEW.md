# Mobile Code Review — iOS and Android

**Date:** 2026-07-16  
**Scope:** `apps/mobile`, plus the shared protocol surfaces directly consumed by the app  
**Reviewed branch:** `codex/reorganize-mobile-screens`  
**Decision:** **REQUEST CHANGES**

## Method and validation

One specialist agent reviewed the native discovery, pairing, networking, storage,
dashboard, mutations, extraction/profile flows, platform configuration, and tests.
The primary reviewer then traced every candidate through its callers and failure
paths. Only reproducible or source-demonstrable findings are retained below.

Configured checks passed:

- `bun run test` in `apps/mobile`: 98 passed, 0 failed, 698 expectations.
- `bun run typecheck` in `apps/mobile`: passed.
- `bun run lint` in `apps/mobile`: passed.

Those checks are useful regression evidence, but the accepted findings concern
threat assumptions, failure recovery, and event ordering that the current suite
does not cover.

## Severity summary

| Severity | Count |
| --- | ---: |
| BLOCKER | 1 |
| MAJOR | 3 |
| MINOR | 3 |
| NIT | 1 |

## Findings

### MOB-001 — Reusable bearer credentials and physical commands use plaintext HTTP

**Severity:** BLOCKER  
**Category:** Security / command authorization  
**Status:** Validated — cross-layer remediation approved, implementation pending

**Remediation decision (2026-07-16):** Implement the encrypted per-device
pairing/session design recorded in FW-005. The app must pair once, pin the
machine's cryptographic identity in SecureStore, and reconnect automatically
after the same machine receives a different DHCP address. An IP address is only
a locator. Before updating a cached address or releasing any client credential,
the endpoint must prove possession of the pinned device identity. Protected
commands must reject plaintext and downgrade paths after migration.

**Evidence:**

- `apps/mobile/src/networking/device-address.ts:7-29` defaults to and only accepts
  `http:` origins.
- `apps/mobile/src/networking/device-api-client.ts:337-350` sends the reusable
  bearer token in the `Authorization` header.
- `apps/mobile/plugins/with-android-cleartext.js:3-12` enables cleartext traffic
  for the entire Android application.

**Impact:** A hostile or compromised peer on the same LAN can observe and replay
the token. The token authorizes temperature, heater, extraction, profile, and
cooldown operations. Device ID checks do not protect the credential in transit.
This design is suitable only for a deliberately trusted development network, not
for production or unattended heater control.

**Solution:** Introduce cryptographic device authentication and an encrypted,
replay-resistant channel. Prefer per-device keys provisioned during pairing and
authenticated TLS, or a deliberately designed PAKE/session protocol if TLS is not
feasible. Bind credentials to the device identity, support rotation/revocation,
and remove the application-wide Android cleartext allowance once migration is
complete. A protocol change must begin in `packages/protocol/openapi.yaml` and be
implemented across firmware, simulator, mobile parsing, and tests.

**Required verification:** Capture traffic from both iOS and Android builds and
prove that credentials and command bodies are not readable or replayable. Add
negative tests for a wrong certificate/key, replayed request, rotated credential,
and cloned discovery identity.

### MOB-002 — Pairing and recovery treat a public device ID as trusted identity

**Severity:** MAJOR  
**Category:** Security / pairing trust  
**Status:** Validated — remediation approved with MOB-001/FW-005, implementation pending

**Remediation decision (2026-07-16):** Replace public-device-ID trust with the
persistent cryptographic device identity defined by FW-005. Preserve automatic
IP-change recovery, but require proof of the pinned private identity before the
stored address or per-app credential is used. A changed identity requires an
explicit re-pair flow and must never be accepted silently.

**Evidence:**

- `apps/mobile/src/discovery/device-discovery.ts:35-57` accepts a schema-valid
  public mDNS identity and address.
- `apps/mobile/src/pairing/pairing-service.ts:69-79` only compares `deviceId`
  before transmitting a newly entered token.
- `apps/mobile/src/pairing/pairing-service.ts:116-164` uses the same public value
  to select a rediscovered address and then sends the stored token to it.

**Impact:** Another LAN host can advertise or serve the same device ID. During
restore or rediscovery, the app can send the saved bearer token to the impostor.
The subsequent authenticated state request does not help because disclosure has
already occurred.

**Solution:** Pin a cryptographic device identity at initial pairing. Before any
stored secret is sent, require proof of possession of the pinned private key.
Treat mDNS and `/api/v1/device` fields only as routing/display hints. Surface an
explicit re-pair flow when the key changes instead of silently recovering by ID.

**Required verification:** Add a two-server adversarial test where the impostor
copies the real device ID. Assert that the app never sends the stored credential
to the impostor and reports an identity mismatch.

### MOB-003 — One transient profile request failure disables profile UI until remount

**Severity:** MAJOR  
**Category:** Reliability / recovery  
**Status:** Validated

**Evidence:**

- `apps/mobile/hooks/use-machine-dashboard.ts:210-227` loads local profiles and
  firmware profiles once with a shared `Promise.all` and a shared error state.
- `apps/mobile/components/dashboard-screen.tsx:414-434` and `:462-485` require
  both values to be non-null before rendering extraction/profile controls.
- Normal polling refreshes machine state, but does not retry `getProfiles()`.

**Impact:** A temporary timeout or disconnect during the initial profile request
leaves at least one profile set null. Reconnection can restore the dashboard
state while extraction/profile controls remain stuck on the loading/error card
for the lifetime of the mounted screen.

**Solution:** Load local and remote profiles independently with separate status
and error fields. Keep successfully loaded local data when the remote call fails.
Retry the remote profile request on reconnect/focus and provide an explicit retry
action. Deduplicate concurrent retries and cancel them on unmount.

**Required verification:** Simulate initial remote profile failure followed by a
successful reconnect without remounting. Assert that the profile/extraction UI
recovers and that local-storage failure does not erase valid machine profiles.

### MOB-004 — Concurrent local-profile saves can publish stale state out of order

**Severity:** MAJOR  
**Category:** Concurrency / persistence consistency  
**Status:** Validated

**Evidence:**

- `apps/mobile/components/dashboard-screen.tsx:250-262` fires
  `saveMobileProfiles()` without awaiting or serializing it.
- `apps/mobile/hooks/use-machine-dashboard.ts:281-294` publishes the argument
  after each asynchronous save completes, regardless of whether a newer save
  has already completed.
- `apps/mobile/components/extraction-preview.tsx:530-546` does not disable Save
  or Clear while persistence is pending.

**Impact:** Two fast edits can resolve in reverse order. The older write can then
replace newer React state, and depending on the storage adapter ordering, stale
profiles can also become the persisted value.

**Solution:** Give profile persistence a single owner. Serialize/coalesce writes
through a mutation queue and attach a monotonically increasing revision. Only
the newest acknowledged revision may update UI state. Disable or visibly mark
Save/Clear while a conflicting write is pending, while still allowing a queued
latest edit if that is the chosen UX.

**Required verification:** Use deferred promises to resolve save A after save B.
Assert that the final visible and persisted profile set is B and that failures do
not roll state back past a newer success.

### MOB-005 — Forget-device failure leaves the pairing screen permanently busy

**Severity:** MINOR  
**Category:** Error handling / UX  
**Status:** Validated

**Evidence:** `apps/mobile/components/pairing-screen.tsx:307-317` sets busy, awaits
`repository.clear()`, and clears busy only on success. The callback is invoked as
a discarded promise at `:326-333`.

**Impact:** If secure storage deletion rejects, the rejection is not presented to
the user and `busy` remains true. The user can be left with disabled controls and
no recovery path other than remounting/restarting.

**Solution:** Wrap the operation in `try/catch/finally`, translate and display a
specific clear-storage error, and always release `busy` while the component is
active. Decide explicitly whether the existing paired state remains usable after
the failed deletion.

**Required verification:** Make `repository.clear()` reject and assert that the
error is visible, controls become usable again, and no unhandled rejection is
emitted.

### MOB-006 — Synchronous discovery failure is overwritten by the no-results timer

**Severity:** MINOR  
**Category:** Event ordering / diagnostics  
**Status:** Validated

**Evidence:**

- `apps/mobile/components/pairing-screen.tsx:126-149` assigns the scan cleanup and
  timer after calling `discovery.scan()`.
- `apps/mobile/src/discovery/native-device-discovery.native.ts:57-80` may invoke
  `onError` synchronously when the native scan throws.

**Impact:** The synchronous error calls `stopBrowsing()` before the new cleanup
or timer has been assigned. Control returns to `startBrowsing()`, which assigns
both anyway; the timer later replaces the useful discovery-unavailable message
with the less accurate no-machines-found message.

**Solution:** Make scan startup have an explicit result, or defer all callbacks
until after registration. In the screen, track a scan generation/terminal flag
and only schedule the timeout if startup is still active. Ignore late callbacks
from older generations.

**Required verification:** Use a discovery adapter that calls `onError`
synchronously and returns a cleanup function. Assert one cleanup, no live timer,
`scanning === false`, and preservation of the discovery-unavailable message.

### MOB-007 — The 60-second extraction duration is rendered as `0:60`

**Severity:** MINOR  
**Category:** Presentation correctness  
**Status:** Validated

**Evidence:**

- `packages/protocol/src/schemas.ts:8-10` permits a 60-second extraction.
- `apps/mobile/components/extraction-preview.tsx:734-737` hardcodes the minute
  component to zero and prints total seconds.

**Impact:** A valid boundary value is displayed in non-normalized time format,
which is confusing in both elapsed and remaining fields.

**Solution:** Compute minutes with `Math.floor(totalSeconds / 60)` and seconds
with `totalSeconds % 60`, padding only the seconds component.

**Required verification:** Add formatter cases for 0, 1, 59, 60, and values above
60 seconds; the 60-second result must be `1:00`.

### MOB-008 — Screen components combine too many responsibilities

**Severity:** NIT  
**Category:** Maintainability / code smell  
**Status:** Validated

**Evidence:** `dashboard-screen.tsx` is 1,493 lines,
`extraction-preview.tsx` is 946, `thermal-workflow-preview.tsx` is 775,
`pairing-screen.tsx` is 650, and `machine-controls.tsx` is 563. The largest files
combine orchestration, persistence triggers, navigation state, domain mapping,
presentation, and styling.

**Impact:** Cross-feature edits have a wide regression surface and make ordering
bugs such as MOB-003 and MOB-004 harder to reason about and test in isolation.

**Solution:** Extract focused controller hooks for profile loading/persistence,
pairing scan lifecycle, and dashboard page state. Split presentation by domain
while preserving current public props and acknowledged-mutation semantics. Do
this incrementally with characterization tests; avoid a wholesale restructure.

**Required verification:** Existing tests must remain green, and each extracted
controller should gain direct failure/order tests for the responsibility it owns.

## Rejected candidates

The primary validation rejected these agent candidates because current source
already prevents them or no reproducible path was found:

- overlapping completion-driven polls;
- late poll responses overwriting acknowledged mutations;
- requested temperature values being shown as live before acknowledgement;
- unvalidated discovery, storage, or API objects entering trusted state;
- unbounded temperature history (it is capped);
- a previously reported hard-coded-copy issue that is now covered by centralized
  localization and tests.

## Recommended order

1. Resolve MOB-001 and MOB-002 together as one protocol/device-trust redesign.
2. Fix and regression-test MOB-003 and MOB-004 before expanding profile UX.
3. Apply the bounded error/format fixes MOB-005 through MOB-007.
4. Use MOB-008 as incremental cleanup while implementing the behavior fixes.
