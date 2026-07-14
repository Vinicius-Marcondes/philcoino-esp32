# STEAM-001 — Define corrected Steam temperature contract semantics

Status: Done
Review Mode: Agent
Review Reason: The semantic-only contract change and backward-compatible wire
shape can be validated deterministically through OpenAPI, schema, fixture, and
drift checks.

## Goal

Define `boilerTemperatureC` as the active effective control temperature so every
consumer has one unambiguous source of truth before firmware behavior changes.

## Scope

- Update the authoritative OpenAPI description of `boilerTemperatureC` to state
  that Brew reports the validated raw boiler-base reading and Steam reports the
  validated reading plus the firmware-configured offset.
- Document that a mode switch may change the reported value without a new
  physical sensor change.
- Preserve all API v1/v2 paths, field names, schemas, target ranges,
  authentication, error shapes, and mutation behavior.
- Clarify that simulator temperature controls operate on the already-effective
  logical control temperature and do not model a physical boiler gradient.
- Update protocol fixtures/examples or drift tests only where required to
  express and validate the clarified semantics.

## Non-Scope

- Firmware control implementation, OLED rendering, mobile-side correction, or
  runtime offset configuration.
- New protocol fields for raw temperature or offset metadata.
- Claims that the simulator or protocol validates physical calibration.

## Implementation Plan

1. Update the OpenAPI field description without changing its numeric schema.
2. Align the human-readable protocol documentation and simulator semantics.
3. Adjust only the contract examples/tests needed to prevent semantic drift.
4. Run the protocol verification matrix and confirm existing consumers remain
   type-compatible.

## Acceptance Criteria

- [x] OpenAPI identifies `boilerTemperatureC` as raw in Brew and offset-adjusted
  in Steam.
- [x] The contract explicitly allows a `5°C` reported jump on mode change with
  an unchanged raw sample.
- [x] No raw-temperature or offset field, endpoint, mutation, or persistence
  surface is added.
- [x] API v1/v2 shapes, target ranges, and existing mobile parsing remain
  backward compatible.
- [x] Simulator documentation treats its temperature as an already-effective
  logical value and makes no physical-calibration claim.
- [x] OpenAPI validation, protocol tests, and protocol typecheck pass.

## Verification Strategy

- Run `bun run validate:openapi`, `bun run test:protocol`, and
  `bun run typecheck:protocol`.
- Run simulator and mobile typechecks if any shared fixture or schema source
  changes.
- Review the generated/parsed schema diff to confirm there is no wire-shape
  change.

## Dependencies

None.

## Files Expected To Change

- `packages/protocol/openapi.yaml`
- `packages/protocol/fixtures/`
- `packages/protocol/test/`
- `docs/protocol/api-v1-outline.md`
- `docs/protocol/api-v2-outline.md`
- `docs/DEVELOPMENT.md`

## Implementation Record

- Completed: 2026-07-14.
- Evidence: `bun run validate:openapi` passed; `bun run test:protocol` passed
  71 tests with 147 expectations; `bun run typecheck:protocol` passed.
- Decision: `boilerTemperatureC` remains the only temperature field and its
  numeric schema, examples, paths, ranges, errors, and mutation shapes are
  unchanged. Its OpenAPI description now defines Brew as the validated raw
  boiler-base value and Steam as that value plus the firmware-configured
  `+5°C` offset. Protocol tests pin the mode-change semantic without adding a
  runtime field.
- Simulator boundary: simulator controls supply an already-effective logical
  temperature and do not add the firmware offset or claim physical-gradient,
  calibration, or heater-safety evidence.
- Commit: This commit.
