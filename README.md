# Philcoino

Philcoino is a Bun monorepo for an Expo mobile application and the planned ESP32 espresso-machine integration.

## Repository layout

- `apps/mobile`: Expo 54 / React Native mobile application.
- `firmware/espresso-machine`: reserved for the ESP-IDF firmware project.
- `packages/protocol`: reserved for the shared OpenAPI contract and runtime schemas.
- `tools/device-simulator`: reserved for the local device simulator.
- `docs`: product, architecture, protocol, hardware, and delivery documentation.

Reserved paths are created when their first implementation files are introduced.

## Mobile development

Run commands from the repository root:

```bash
bun run start
bun run lint
bun run typecheck
```

The root scripts delegate to the package in `apps/mobile`.
