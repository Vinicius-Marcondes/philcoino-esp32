# PHIL-002 — Define the shared API contract

Status: Done
Review Mode: Agent
Review Reason: OpenAPI validity, examples, Zod parsing, and boundary tests are deterministic.

## Goal

Create the language-neutral API v1 contract and TypeScript runtime schemas used by the app and simulator.

## Scope

- Add OpenAPI 3.1 paths, authentication, payloads, enums, constraints, and errors.
- Add Zod schemas and inferred TypeScript types.
- Add valid and invalid contract fixtures.
- Test all documented examples against Zod.

## Non-Scope

- Firmware, simulator endpoints, mobile networking, or generated C++ code.

## Implementation Plan

1. Translate the protocol outline into OpenAPI components and paths.
2. Implement matching Zod schemas with strict object handling.
3. Add fixtures for state, device, temperature, mode, and errors.
4. Add drift-focused tests.

## Acceptance Criteria

- [ ] Every PRD endpoint and response is represented.
- [ ] Temperature and mode constraints match PRD-001.
- [ ] Valid examples parse and malformed examples fail.
- [ ] Package exports stable schemas and types.

## Verification Strategy

Run protocol unit tests and an OpenAPI syntax/schema validation check available in the repository.

## Dependencies

PHIL-001.

## Files Expected To Change

`packages/protocol/**`, root workspace metadata, and protocol documentation.
