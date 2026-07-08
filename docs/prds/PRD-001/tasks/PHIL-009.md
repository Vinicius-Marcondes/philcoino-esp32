# PHIL-009 — Implement discovery and pairing

Status: Todo
Review Mode: Human

## Human Review Needs

Verify local-network permission timing, discovered-device presentation, token entry, manual IP fallback, and recovery on a physical iPhone.

## Goal

Let the user discover, select, authenticate, and remember one espresso machine.

## Scope

- Browse `_philcoino._tcp.local` and resolve device metadata/address.
- Present discovered devices and manual IP fallback.
- Request token after device selection and verify it through the API.
- Save only a successfully authenticated device.
- Restore cached address first and rediscover stable ID after failure.

## Non-Scope

- Dashboard, temperature editing, mode switching, or Wi-Fi provisioning.

## Implementation Plan

1. Add discovery adapter and lifecycle cleanup.
2. Build pairing and manual-IP flows.
3. Add authentication and secure save behavior.
4. Add automated state tests and physical-iPhone review.

## Acceptance Criteria

- [ ] Discovered identity/version details are shown before token entry.
- [ ] Invalid tokens are not persisted.
- [ ] Manual IP can complete the same pairing flow.
- [ ] Cached address and DHCP rediscovery work as specified.
- [ ] Permission denial and no-device states are actionable.

## Verification Strategy

Run automated flow tests with the simulator, then perform the listed human review on a physical iPhone and local network.

## Dependencies

PHIL-008.

## Files Expected To Change

Mobile discovery adapter, pairing routes/components, state, tests, and app configuration.
