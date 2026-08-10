# Philcoino mobile app

Expo 54 / React Native client for discovering, pairing with, monitoring, and submitting acknowledged changes to one local Philcoino machine.

The app is a client, not the temperature-control authority. Firmware owns sensors, targets, persistence, readiness, timeouts, heater output, and faults.

Machine also opens a focused Temperature Calibration modal. Its dedicated
session reads and mutates only the strict API v2 calibration resource, presents
requested candidates only after acknowledgement, cancels on lifecycle exit,
and never commands the pump or steam valve. The user opens the wand manually,
adjusts the raw target in whole degrees, reviews the derived global offset, and
explicitly confirms Save.

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
  strict app-local display preferences are stored separately and never cleared
  when a machine is forgotten;
- `src/profiles`: seeded app-wide four-slot profile set stored only on the phone;
- `src/dashboard`: polling, acknowledged mutations, and pure view models;
- `src/history`: indefinite local status/shot persistence, migration, and CSV export;
- `src/telemetry`: persistent extraction-stream replay and shared plot geometry;
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

Debug mode also supplies the PRD-002 API v2 dashboard through the same client
boundary using deterministic in-memory acknowledgements rather than HTTP. The
five-tab navigation separates Dashboard, Profiles, Machine, Scale, and Shots.
Dashboard graphs today's locally stored state; Machine exports or clears all
status rows; Scale owns diagnostics/calibration/defaults; Shots is the sole
history list/detail/export/clear surface. The full-screen extraction console is
Start/Stop plus live 250 ms telemetry and shows a simple ready state when idle.

Outside debug mode the same pages use API v2 combined polling and acknowledged
Start/Stop mutations. Profiles persist only in mobile SecureStore, and each
profile Start includes the exact selected snapshot; no machine profile read,
synchronization, import, or export exists.

## Simulator integration

Run `bun run simulator` at the repository root, manually enter a reachable simulator address, and use `philcoino-dev-token`. A physical phone cannot reach a computer through the phone's own `localhost`; use the computer's LAN address.

## Verify

```bash
bun run typecheck
bun run --cwd apps/mobile test
bun run lint
```

Also exercise the affected platform for UI, discovery, permissions, native configuration, or lifecycle changes.

See the root [development guide](../../docs/DEVELOPMENT.md), [architecture](../../docs/ARCHITECTURE.md), and [safety status](../../docs/en/SAFETY.md).
