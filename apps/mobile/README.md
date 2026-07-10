# Philcoino mobile app

Expo 54 / React Native client for discovering, pairing with, monitoring, and submitting acknowledged changes to one local Philcoino machine.

The app is a client, not the temperature-control authority. Firmware owns sensors, targets, persistence, readiness, timeouts, heater output, and faults.

## Runtime flow

```text
PairingScreen
  -> restore cached SecureStore record
  -> inspect cached address or rediscover stable device ID
  -> authenticate bearer token
  -> DashboardScreen
       -> one completion-driven state poll per second
       -> serialized mutations with polling paused
       -> live state updates only from valid acknowledgements
```

Key code boundaries:

- `app`: Expo Router entry and layout;
- `components`: pairing, dashboard, controls, and presentation;
- `src/discovery`: mDNS abstraction and strict TXT/address parsing;
- `src/pairing`: inspection, authentication, persistence, and address recovery;
- `src/networking`: strict API client, cancellation/timeouts, and error mapping;
- `src/storage`: strict one-device record and Expo SecureStore adapter;
- `src/dashboard`: polling, acknowledged mutations, and pure view models;
- `test`: Bun tests for the above boundaries.

## Run

From the repository root after `bun install`:

```bash
bun run start
```

Use `bun run ios`, `bun run android`, or `bun run web` for a target. Native mDNS requires an iOS/Android development build and local-network permissions; web/unsupported platforms use manual address entry.

## Debug-device mode

Exercise discovery, token entry, and the dashboard without mDNS, SecureStore, or
HTTP:

```bash
EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run start
```

The simulated scan finds one `Philcoino debug` machine. Select it and enter
`debug-token` to continue to the in-memory dashboard. A wrong token shows the
normal authentication error, forgetting the machine returns to scanning, and a
reload starts the flow from the scan screen again. Use the device simulator for
API integration work.

## Simulator integration

Run `bun run simulator` at the repository root, manually enter a reachable simulator address, and use `philcoino-dev-token`. A physical phone cannot reach a computer through the phone's own `localhost`; use the computer's LAN address.

## Verify

```bash
bun run typecheck
bun run --cwd apps/mobile test
bun run lint
```

Also exercise the affected platform for UI, discovery, permissions, native configuration, or lifecycle changes.

See the root [development guide](../../docs/DEVELOPMENT.md), [architecture](../../docs/ARCHITECTURE.md), and [safety status](../../docs/SAFETY.md).
