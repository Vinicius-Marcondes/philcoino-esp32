# Repository layout

Status: ACCEPTED

## Objective

Keep the Expo application, ESP-IDF firmware, API contract, simulator, and documentation in one repository without coupling the C++ firmware to TypeScript implementation details.

## Structure

```text
philcoino/
├── apps/
│   └── mobile/                  # Expo 54 / React Native application
├── firmware/
│   └── espresso-machine/        # ESP-IDF C++ project
├── packages/
│   └── protocol/                # OpenAPI contract, examples, and app schemas
├── tools/
│   ├── device-simulator/        # Optional Bun/Hono ESP32 simulator
│   └── thermal-modeling/        # Offline Python analysis, fitting, simulation, and reviewed export
├── docs/
│   ├── architecture/
│   ├── decisions/
│   ├── protocol/
│   └── prds/
├── package.json                 # Bun workspace root
└── bun.lock
```

The ESP-IDF project remains an independent CMake project. It is not a Bun workspace package.

## API contract ownership

`packages/protocol/openapi.yaml` should become the language-neutral source of truth for HTTP paths, payloads, enums, limits, and errors.

- The mobile app uses Zod at runtime to reject malformed firmware responses.
- The firmware implements equivalent C++ request and response structures and validates all commands independently.
- The simulator implements the same contract for app development without physical hardware.
- The thermal-modeling tool consumes CSV exports offline and may generate a reviewed firmware-candidate header, but never edits, flashes, or controls firmware.
- Contract examples are tested against the mobile schemas and exercised against firmware integration tests.

No safety rule should exist only in the mobile application. Temperature limits and state-transition validation belong in the firmware, with the app duplicating them only for immediate user feedback.

## Workspace boundaries

The Expo project lives in `apps/mobile/`. The root Bun workspace discovers JavaScript packages under `apps/*`, `packages/*`, and `tools/*`; the Python thermal tool and ESP-IDF firmware remain outside that JavaScript workspace.
