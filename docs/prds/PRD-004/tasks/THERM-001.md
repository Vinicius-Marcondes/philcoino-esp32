# THERM-001 — Define the API v2 thermal-workflow contract

Status: Done
Review Mode: Agent
Review Reason: OpenAPI structure, strict schemas, compatibility, idempotency, and conflict behavior are deterministic and fully testable.

## Goal

Define the additive API v2 contract for extraction compensation and cooldown while preserving every API v1 path and shape.

## Scope

- Add acknowledged compensation state to extraction/machine state without exposing runtime configuration.
- Add cooldown idle, pumping, and stabilizing state plus idempotent Start and Stop operations.
- Define timing, command-state wording, terminal outcomes, and same-key replay.
- Define strict conflicts for Steam extraction, active workflows, ineligible temperature, and unavailable sensor/fault state.
- Add strict Zod mirrors, types, accepted/rejected fixtures, examples, and drift tests.

## Non-Scope

- Simulator, mobile, firmware behavior, UI design, or physical thermal claims.

## Implementation Plan

1. Extend `packages/protocol/openapi.yaml` with the minimum additive API v2 shapes and operations.
2. Mirror the contract in strict Zod schemas and exported types.
3. Add fixtures for every state, replay, boundary, conflict, and unknown-field rejection.
4. Prove API v1 compatibility and API v2 internal consistency.

## Acceptance Criteria

- [x] API v2 represents fixed compensation activity without a mutation surface for its constants.
- [x] Cooldown state and Start/Stop responses encode pumping, stabilization, timing, outcomes, and GPIO command semantics strictly.
- [x] Same-key replay cannot reset a cooldown deadline; competing workflows and Steam eligibility have stable conflict shapes.
- [x] API v1 remains unchanged and all versioned errors remain unambiguous.
- [x] OpenAPI validation, protocol tests, and protocol typecheck pass.

## Verification Strategy

- Run OpenAPI structure/drift checks, protocol fixtures/tests, and protocol typecheck.
- Include rejected fixtures for malformed keys, invalid state/command combinations, and conflict-body drift.

## Completion Evidence

### Changed behavior

- API v2 combined state now requires strict acknowledged `compensation` and
  `cooldown` snapshots alongside the unchanged nested API v1 machine state and
  existing extraction state.
- Compensation exposes only inactive/active activity and the eligible Manual or
  main-extraction phase. Pre-infusion's fixed zero-degree policy and soak both
  acknowledge inactive while the extraction phase remains explicit; no bias
  value or mutation surface is exposed.
- Authenticated `POST /api/v2/cooldowns/start` and
  `POST /api/v2/cooldowns/stop` define idempotent Start/replay and Stop
  acknowledgements for idle, pumping, stabilizing, and retained terminal state.
- Strict conflicts now distinguish Brew-required extraction, active extraction,
  active cooldown, ineligible temperature, unavailable sensor, and latched
  machine fault. Profile replacement and extraction Start also expose active
  cooldown conflicts.

### Decisions

- Cooldown `brewTargetC` is the firmware-snapshotted completion threshold;
  `elapsedMs` is monotonic from acknowledged Start and `remainingMs` is the
  current pump/stabilization deadline. Pumping timing must total exactly 45
  seconds, and stabilization is bounded to five seconds.
- Same-key Start replay returns the retained cooldown identity and its current
  or terminal state instead of a replay flag. This keeps the original deadline
  authoritative even when a retry arrives during stabilization or after
  completion. A different key may replace a terminal acknowledgement only
  after fresh eligibility checks.
- Terminal idle retains identity, target, elapsed time, and outcome until reset,
  power loss, or a later eligible Start. A failed terminal outcome is valid in
  combined state only with a machine fault so removing the transient inhibit
  cannot represent restored heating.
- `running`, `off`, and `heaterInhibited` remain firmware command/control state;
  they do not claim flow, current, cooling, SSR state, or physical
  de-energization.

### Compatibility and safety impact

- Every API v1 path, request/response schema, and error enum is unchanged.
- API v2 gains required strict fields and two additive endpoints; existing v2
  consumers must be aligned by the supervised later tasks before cross-layer
  checks can pass.
- No simulator, mobile, firmware, GPIO, timing implementation, runtime tuning,
  or physical behavior changed in this task. The contract preserves firmware
  authority and does not close any finding in `CODEBASE_REVIEW_REPORT.md`.

### Verification evidence

- `bun run validate:openapi` — passed; OpenAPI 3.1.1 syntax, exact approved
  paths, bearer security, and local references are valid.
- `bun run test:protocol` — passed: 111 tests, 224 expectations. Coverage
  includes accepted/rejected compensation and cooldown states, exact timing
  bounds, same-key terminal replay, command/inhibit combinations, mutual
  exclusion, Brew-only extraction, fault coupling, unknown fields, conflict
  drift, examples, API v1 isolation, and OpenAPI/Zod drift.
- `bun run typecheck:protocol` — passed with `tsc --noEmit`.
- `git diff --check` — passed before task completion.

### Checks not run

- Simulator, mobile, firmware host tests/captures, and ESP-IDF target build were
  not run because THERM-001 changes only the authoritative protocol package;
  those layers intentionally remain unaligned until THERM-002 through
  THERM-009.
- No package, CLI, SDK, program, or dependency was installed.
- No low-voltage, GPIO, physical, or energized check was performed; software
  contract evidence is not heater/pump safety evidence.

### Remaining blockers and human acceptance

- No blocker remains for THERM-001.
- THERM-002 is the next task and requires explicit owner approval of the debug
  mobile hierarchy, copy, interactions, large-text behavior, and accessibility
  before THERM-003 may begin.

## Dependencies

- PRD-004 approved.

## Files Expected To Change

- `packages/protocol/openapi.yaml`
- `packages/protocol/src/`
- `packages/protocol/fixtures/`
- `packages/protocol/test/`
