# THERM-009 — Validate workflows end to end and align documentation

Status: Done
Review Mode: Agent
Review Reason: Cross-layer contract scenarios, regression suites, and documentation consistency are deterministic and reviewable without physical operation.

## Goal

Prove mobile, simulator, protocol, and firmware agree on PRD-004 behavior and accurately document the remaining physical boundary.

## Scope

- Add cross-layer scenarios for Steam blocking, compensation phases, cooldown threshold/cutoff/Stop/stabilization, retry, conflict, disconnect, reset, and failures.
- Run all affected configured checks across protocol, simulator, mobile, and firmware.
- Align architecture, API v2 outline, tuning, development, safety, side notes, and review findings.
- Record compatibility, command-state limitations, checks not run, and deferred physical acceptance.

## Non-Scope

- Human visual approval, flashing hardware, low-voltage observation, energized testing, or changing fixed constants from unmeasured assumptions.

## Implementation Plan

1. Add shared scenario coverage and validate all firmware captures.
2. Run the complete affected verification matrix.
3. Update public/internal documentation and unresolved-finding references.
4. Prepare exact THERM-010 and THERM-011 human checklists without executing them.

## Acceptance Criteria

- [x] All layers agree on state, errors, timing, idempotency, reset, and failure semantics.
- [x] API v1 and unrelated PRD-002 extraction/profile behavior remain regression-safe.
- [x] Documentation distinguishes requested/commanded/observed physical state and all evidence levels.
- [x] Unresolved single-sensor, cutoff, SSR, timing, security, wiring, and enclosure findings remain visible.
- [x] Every configured affected check passes or is explicitly recorded as unavailable/deferred.

## Verification Strategy

- Run OpenAPI validation; protocol, simulator, and mobile tests/typechecks; mobile lint/config/export; strict firmware host tests; capture validation; and pinned target build when available.

## Dependencies

- THERM-008.

## Files Expected To Change

- Cross-workspace tests and fixtures
- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/protocol/api-v2-outline.md`
- `docs/hardware/temperature-control-tuning.md`
- `docs/SAFETY.md`
- `docs/en/SAFETY.md`
- `docs/side-notes.md`
- `CODEBASE_REVIEW_REPORT.md`

## Completion Evidence

### Changed behavior

- No product behavior changed in THERM-009. This task validated the completed
  cross-layer implementation and aligned architecture, development, protocol,
  tuning, safety, side-note, review, and Human-gate documentation.
- Existing scenarios collectively cover Steam blocking, exact compensation
  phases/clamp, threshold/45-second/Stop cooldown completion, five-second
  stabilization, active/terminal replay, conflicts, disconnect/reconnect,
  reset/power-cycle, sensor/fault/output failures, shared-pump ownership, and
  unchanged extraction/profile/v1 behavior.
- `HUMAN_REVIEW.md` contained the exact THERM-010 disconnected target/mobile
  checklist and THERM-011 authorization prerequisites. Both were later accepted
  by the owner on 2026-07-16 for the tested configuration.

### Decisions

- Documentation uses four distinct evidence concepts: a user request, an
  acknowledged firmware policy/command, a directly observed logic-level state,
  and a physical/electrical/thermal observation. No lower layer is promoted to
  the next.
- The API v2 outline now includes seven additive v2 operations and the complete
  machine/extraction/compensation/cooldown snapshot; API v1 remains unchanged.
- The architecture documents one bounded non-nested workflow mutex, the 10 ms
  task, atomic fail-safe handoff, GPTimer lease, and NVS/render/HTTP exclusion
  without closing target-runtime/watchdog/physical risks.
- The codebase review retains its REQUEST CHANGES decision. Its PRD-004
  addendum records that historical unbounded-lock/NVS ordering evidence was
  superseded while B1 remains open for target/runtime/physical proof; B2/B3 and
  every applicable MAJOR remain visible.

### Compatibility and safety impact

- Protocol/simulator/mobile/firmware agreement confirms deterministic software
  semantics only. API/OLED `running`, `off`, `heaterActive`, and
  `heaterInhibited` do not establish water flow, cooling, current, SSR state,
  switch position, or de-energization.
- The owner accepted the fixed Steam `+5°C`, extraction `+2°C`, pre-infusion
  `0°C`, Brew cooldown threshold, 45-second cutoff, and five-second
  stabilization for the configuration tested on 2026-07-16. Raw measurement
  artifacts were not committed.
- Single-sensor plausibility, independent cutoff, SSR failure/drive/thermal
  behavior, watchdog/target timing, timeout reset, cleartext credentials/device
  identity, wiring, grounding, enclosure, water/pressure, and supervised
  operation remain unresolved engineering limitations rather than pending
  Human gates.
- No package, program, CLI, SDK, or dependency was installed. No generated,
  dependency, cache, build, coverage, database, secret, `managed_components`,
  or `sdkconfig` path was inspected.

### Verification evidence

- OpenAPI 3.1.1 validation passed.
- Protocol passed 111 tests/224 expectations and TypeScript typecheck.
- Simulator passed 59 tests/359 expectations and TypeScript typecheck.
- Mobile passed 96 tests/326 expectations, TypeScript typecheck, Expo lint,
  Expo SDK `54.0.0` public config inspection, and debug web export of three
  static routes plus one bundle to `/tmp/philcoino-prd004-web`.
- Fresh strict C++17 `-Wall -Wextra -Werror` host build and CTest passed 4/4.
- Firmware capture generation and strict validation passed 26/26 response
  captures, including unchanged API v1 and full workflow success/replay/
  conflict/failure state.
- Diff/document review confirmed fixed constants, API v1 compatibility,
  command-only wording, Human-gate status, and required unresolved findings.

### Checks not run

- ESP-IDF 6.0.2 target build was unavailable because neither `idf.py` nor
  `IDF_PATH` is configured. No toolchain installation was attempted.
- Native iOS/Android Dynamic Type and screen readers, exact target flash/runtime,
  disconnected logic-level observation, physical GPIO/OLED/SSR/pump behavior,
  and all energized/instrumented work were not run.

### Remaining blockers and human acceptance

- No Agent blocker remains for THERM-009; the PRD-004 software scope is complete
  through its final Agent task.
- Vinicius explicitly accepted THERM-002, THERM-010, and THERM-011 on
  2026-07-16. No PRD-004 Human acceptance remains pending.
