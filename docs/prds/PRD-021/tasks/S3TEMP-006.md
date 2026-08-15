# S3TEMP-006 — Migrate mobile control and history surfaces

Status: Done
Review Mode: Agent
Review Reason: Strict parsing, reducers, database migrations, chart geometry, and exports have deterministic tests.

## Goal
Require API v4 and expose both temperatures throughout pairing, calibration, live state, history, traces, and exports.

## Scope
- Migrate networking, pairing, debug client, and state ownership to v4.
- Show both readings, emphasize the active sensor, add two calibration actions, and retain only Steam-ready timeout UI.
- Migrate continuous and shot histories, charts, SQLite schemas, and CSV exports.

## Non-Scope
- Backward-compatible v3 parsing or background monitoring.

## Implementation Plan
1. Align transport and state types with v4.
2. Parameterize calibration and update live/history presentation.
3. Add nullable Steam columns and preserve legacy rows through migrations.

## Acceptance Criteria
- [x] Old API generations fail clearly and S3 pairing requires a new binding.
- [x] Boiler and Steam remain labeled, nullable, gap-preserving, and independently charted.
- [x] Both histories and CSV exports preserve Steam readings; old rows migrate with null Steam values.

## Verification Strategy
- Run mobile tests, typecheck, simulator integration, and native migration tests available in the repo.

## Dependencies
- S3TEMP-001 and S3TEMP-005.

## Files Expected To Change
- `apps/mobile/`
