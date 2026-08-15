# Philcoino mobile app

Expo 54 / React Native client for discovering, pairing with, monitoring, and
submitting acknowledged requests to one API v4 Philcoino machine. Firmware—not
the phone—owns sensors, targets, persistence, control, outputs, timeouts, and
faults.

This generation must be rebuilt and freshly paired. API v3 is unsupported, the
ESP32-S3 has a new identity, and API v4 uses new SRP binding domains.

## Runtime behavior

The app restores one strict SecureStore device record, revalidates identity,
then uses pinned HTTPS and completion-driven acknowledged state. It never
publishes a requested mutation as live state before a valid response.

Dashboard always labels Boiler and Steam temperatures and emphasizes the sensor
controlling the active mode. History and extraction charts draw independent
lines and preserve nullable gaps. Machine provides separate Boiler and Steam
calibration actions through one parameterized screen; only one firmware session
can run. Steam settings contain only the 1–15 minute ready timeout.

Temperature history uses SQLite schema version 8 with nullable Boiler and Steam
columns. Migrated rows preserve the old boiler value and store Steam as `NULL`;
obsolete Steam compensation metadata is discarded. Saved shot traces likewise
add nullable Steam temperature without rewriting older records. Both status and
shot CSV exports include the two sensor values.

## Code boundaries

- `src/networking`: API v4 parsing, pinned transport, timeouts, cancellation.
- `src/discovery` and `src/pairing`: strict v4 mDNS identity and SRP pairing.
- `src/dashboard`: serialized polling/mutation sessions and presentation data.
- `src/history`: SQLite v8 migration, dual-temperature rows, CSV export.
- `src/telemetry`: extraction telemetry v2 replay and chart geometry.
- `components`: dual readings, charts, extraction console, and calibration UI.

## Run and verify

```bash
bun run start
bun run ios
bun run android
bun run typecheck
bun run --cwd apps/mobile test
bun run lint
```

Native mDNS/pairing requires a rebuilt iOS/Android development app and local
network permissions. Debug-device mode remains available for presentation-only
work:

```bash
EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run start
```

See [Development](../../docs/DEVELOPMENT.md),
[Architecture](../../docs/ARCHITECTURE.md), and
[Safety](../../docs/en/SAFETY.md).
