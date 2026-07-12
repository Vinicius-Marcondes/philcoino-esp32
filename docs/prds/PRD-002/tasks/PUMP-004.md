# PUMP-004 — Connect mobile profiles and extraction control

Status: Done
Review Mode: Agent
Review Reason: Persistence validation, acknowledged mutations, cancellation, synchronization, and simulator integration are deterministic and testable.

## Goal

Connect the approved mobile design to durable local profiles and API v2 while preserving firmware-acknowledged live-state rules.

## Scope

- Add strict local storage for four mobile profile slots and seed defaults only on first use.
- Add API client operations for machine profiles, export, Start, Stop, and v2 state.
- Detect mobile/machine differences deterministically and block unsynchronized custom Start.
- Serialize extraction mutations, generate/reuse idempotency keys correctly, and preserve first-cause cancellation behavior.
- Integrate polling/lifecycle behavior so active firmware extraction remains authoritative across app disconnects and resumes.

## Non-Scope

- Firmware, automatic synchronization, background phone timing, or API v1 removal.

## Implementation Plan

1. Add strict profile storage and canonical comparison helpers.
2. Extend the injected API client with validated v2 calls.
3. Add extraction polling/mutation sessions with acknowledged update rules.
4. Connect the approved components to real and debug data sources.
5. Test against the simulator including disconnection and retry races.

## Acceptance Criteria

- [x] Mobile edits remain local until explicit export and survive app restart.
- [x] Export acknowledgement replaces the known machine set; failure leaves sync status unresolved or unsynchronized.
- [x] Unsynchronized custom Start is blocked, while Manual remains available.
- [x] Same-tap retries reuse one idempotency key and never display an unacknowledged Start or Stop as successful.
- [x] Disconnects clear stale live data without stopping the firmware-owned extraction.
- [x] Mobile tests, lint/typecheck, simulator integration, Expo config inspection, and web export pass.

## Verification Strategy

- Bun tests for storage corruption, schema rejection, export races, Start replay, Stop idempotency, cancellation, disconnect/reconnect, and simulator integration.

## Dependencies

- PUMP-003.

## Files Expected To Change

- `apps/mobile/src/storage/`
- `apps/mobile/src/networking/`
- `apps/mobile/src/dashboard/`
- `apps/mobile/hooks/`
- `apps/mobile/test/`

## Implementation Record

### Changed behavior

- Added strict independent mobile profile persistence with first-use seeding and corruption rejection.
- Added validated API v2 combined state, profile read/replace, Start, and Stop client operations with version-correct error parsing.
- Changed dashboard polling to one completion-driven API v2 stream that publishes machine and extraction state together.
- Connected the approved Dashboard/Profiles/Machine UI to real and debug data sources, acknowledged mutations, and persistent local profiles.
- Added canonical sync detection, unsynchronized custom Start blocking, globally serialized mutations, and stable Start-key reuse after unacknowledged outcomes.

### Decisions made

- Reused Expo SecureStore rather than adding a storage dependency; the profile key is independent from the selected-device key and is not cleared when a device is forgotten.
- Local profile state updates only after the storage write resolves. Machine profile state updates only from validated export acknowledgement.
- API v2 active-conflict errors retain the acknowledged active extraction payload instead of collapsing to protocol failure.
- Background/unfocus cancellation never sends Stop; reconnect polling rehydrates firmware-owned extraction state.
- The debug data source implements the same client boundary in memory without HTTP.

### Safety and compatibility impact

- API v1 remains used for public identity/pairing and its existing temperature operations remain available.
- Requested Start, Stop, export, and profile drafts are never displayed as acknowledged machine state before validated responses.
- Disconnect clears live machine/extraction snapshots but does not imply or request pump shutdown.
- `running`/`off` remains GPIO10 command-only wording.

### Verification evidence

- PASS — `bun run --cwd apps/mobile test` (77 tests after final debug-v2 coverage; all passed).
- PASS — `bun run typecheck`.
- PASS — `bun run lint`.
- PASS — `bun run test:simulator` (43 tests, 212 expectations).
- PASS — `bun run typecheck:simulator`.
- PASS — `bun run validate:openapi`.
- PASS — `bun run test:protocol` (69 tests, 143 expectations).
- PASS — `bun run typecheck:protocol`.
- PASS — `bun run --cwd apps/mobile expo config --type public`.
- PASS — `EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run --cwd apps/mobile expo export --platform web --output-dir /tmp/philcoino-pump004-web`.

### Checks not run

- Physical iPhone/Android lifecycle and accessibility checks were not available.
- Firmware API v2 is intentionally outside PUMP-004 and remains unavailable until its owning later task; simulator integration is not firmware evidence.

### Remaining blockers or human acceptance

- None for PUMP-004. Physical mobile review remains deferred and firmware API v2 integration is outside the requested PUMP-005 boundary.
