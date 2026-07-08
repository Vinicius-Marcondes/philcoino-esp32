# PHIL-008 — Build the mobile networking foundation

Status: Todo
Review Mode: Agent
Review Reason: Client parsing, persistence, retry policy, and app configuration are testable without visual judgment.

## Goal

Create the mobile API client, secure single-device storage, connection model, and required iOS local-network configuration.

## Scope

- Add protocol consumption and strict response validation.
- Add SecureStore-backed token/device persistence.
- Model connecting, online, unauthorized, not found, offline, and protocol-error states.
- Configure iOS local-network, Bonjour, and local HTTP declarations.
- Add bounded timeouts and cancellation.

## Non-Scope

- Discovery UI, dashboard UI, polling screen, or settings UI.

## Implementation Plan

1. Configure approved dependencies and native app settings.
2. Implement typed API client and error mapping.
3. Implement secure repository for one selected device.
4. Add tests around validation, timeouts, and persistence.

## Acceptance Criteria

- [ ] Every response is validated before entering app state.
- [ ] Token is never stored in plain AsyncStorage or logs.
- [ ] Connection errors map to stable UI states.
- [ ] Requests time out and cancel cleanly.
- [ ] iOS configuration declares local-network usage and service type.

## Verification Strategy

Run mobile unit tests, lint/type checks, and inspect generated Expo configuration.

## Dependencies

PHIL-002 and PHIL-003.

## Files Expected To Change

`apps/mobile` app configuration, networking, storage, state, tests, and package metadata.
