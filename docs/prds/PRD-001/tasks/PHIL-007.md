# PHIL-007 — Implement firmware HTTP, authentication, and mDNS

Status: Todo
Review Mode: Agent
Review Reason: Endpoint schemas, bearer handling, mDNS metadata, and command delegation are deterministic and integration-testable.

## Goal

Expose the control state machine through the approved local API and discovery contract.

## Scope

- Implement HTTP server lifecycle and every API v1 endpoint.
- Add constant-time bearer verification and stable errors.
- Advertise `_philcoino._tcp` with required metadata.
- Delegate mutations to the control state machine and serialize snapshots.

## Non-Scope

- Mobile code, UI, WebSockets, HTTPS, or control logic duplication.

## Implementation Plan

1. Add serializers/parsers matching OpenAPI.
2. Add public and authenticated handlers.
3. Add mDNS advertisement and stable identity.
4. Add component/integration tests and malformed-input coverage.

## Acceptance Criteria

- [ ] Paths and payloads conform to the shared contract.
- [ ] Public endpoints expose no token or sensitive state.
- [ ] Protected endpoints reject missing/invalid tokens.
- [ ] mDNS advertises required identity and version fields.
- [ ] API handlers never bypass domain validation.

## Verification Strategy

Run firmware tests/build and contract-check captured responses against protocol fixtures.

## Dependencies

PHIL-006.

## Files Expected To Change

Firmware networking/auth/mDNS modules, integration tests, and protocol fixtures if corrections are required.
