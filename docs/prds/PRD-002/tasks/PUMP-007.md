# PUMP-007 — Serve API v2 from firmware

Status: Done
Review Mode: Agent
Review Reason: Strict parsing, serialization, authentication, command delegation, and contract captures are deterministic and independently testable.

## Goal

Expose the firmware extraction controller through authenticated API v2 without regressing API v1 or real-time pump timing.

## Scope

- Parse/serialize v2 state, profiles, export, Start, Stop, replay, and conflict responses.
- Delegate under bounded synchronization without holding locks across NVS, HTTP transmission, display work, or pump deadlines.
- Preserve v1 endpoints and authentication behavior during migration.
- Add extraction information to OLED only where it remains legible on the 128×32 display and does not displace fault-critical information.
- Produce firmware contract captures validated by shared schemas.

## Non-Scope

- API v1 retirement, TLS/security redesign, mobile visual changes, or physical pump claims.

## Implementation Plan

1. Extend the host-testable API dispatcher with strict v2 routes.
2. Add bounded controller/profile synchronization and response snapshots.
3. Integrate network handlers and compact OLED extraction presentation.
4. Validate captures against OpenAPI/Zod and run target builds.

## Acceptance Criteria

- [x] Firmware accepts only strict authenticated v2 requests and returns contract-valid acknowledgements/errors.
- [x] Profile persistence and HTTP response work cannot extend active pump-on deadlines.
- [x] API v1 captures and behavior remain compatible.
- [x] OLED prioritizes fault and safety-critical state and labels pump command without claiming measured state.
- [x] Firmware API/host tests, capture validation, and protocol checks pass; the pinned target build was unavailable.

## Verification Strategy

- Native API tests for malformed input, auth, conflicts, replay, persistence failure, bounded locking, captures, and v1 regression; ESP-IDF build.

## Dependencies

- PUMP-006.

## Files Expected To Change

- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`

## Implementation Evidence

- Changed behavior: firmware now serves authenticated `GET /api/v2/state`,
  `GET`/`PUT /api/v2/profiles`, and idempotent Start/Stop endpoints while all
  API v1 routes remain unchanged. Strict C++ parsing rejects unknown, malformed,
  misordered-slot, invalid-profile, and invalid-selection shapes.
- Synchronization: temperature and extraction use separate bounded mutexes;
  HTTP bodies are parsed before locking, profile NVS writes and HTTP response
  transmission occur without the extraction lock, and the dedicated extraction
  task commands off after any 50 ms synchronization failure.
- Display: the OLED retains temperature and fault/mode lines and uses its final
  line for `PUMP RUN/OFF` plus the command phase only while extraction is active.
  This is a GPIO command label, not physical pump feedback.
- Verification: the strict C++17 host build and 4/4 CTest executables passed;
  13 firmware response captures validated against Zod; OpenAPI validation,
  69 protocol tests, and protocol typecheck passed.
- Compatibility: API v1 paths, authentication, payloads, error shapes, and eight
  existing capture classes remain compatible; API v2 is additive.
- Not run: `idf.py build` because the pinned ESP-IDF 6.0.2 command is unavailable
  in the current environment. No target, flash, or physical GPIO work ran.
- Remaining human acceptance: PUMP-009 still owns the exact-target build,
  disconnected GPIO10 timing/reset observations, and mobile review.
- Target follow-up 2026-07-12: the first device run exposed ESP-IDF's default
  URI-handler capacity after API v2 expanded the server to 12 routes. Firmware
  now sets `max_uri_handlers` from the route table size before `httpd_start()`;
  host tests and 13 capture validations still pass. A rebuilt/flashed target
  must confirm the `HTTP and mDNS services started` log before PUMP-009 evidence.
