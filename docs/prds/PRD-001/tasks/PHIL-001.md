# PHIL-001 — Migrate to the monorepo layout

Status: Done
Review Mode: Agent
Review Reason: File moves, workspace configuration, linting, and Expo configuration resolution are deterministic.

## Goal

Move the existing Expo project into `apps/mobile` and establish the approved repository boundaries without changing application behavior.

## Scope

- Create the root Bun workspace configuration.
- Move current Expo source, assets, and configuration into `apps/mobile`.
- Reserve `firmware/espresso-machine`, `packages/protocol`, and `tools/device-simulator` paths.
- Update scripts, TypeScript, ESLint, Expo Router, and asset paths.

## Non-Scope

- Feature UI, firmware code, API schemas, or new runtime dependencies.

## Implementation Plan

1. Move the mobile project without modifying generated/dependency folders.
2. Make the root package private and configure workspaces.
3. Repair configuration and documentation paths.
4. Verify the migrated app resolves and lints.

## Acceptance Criteria

- [ ] Expo source and assets live under `apps/mobile`.
- [ ] Root workspace paths cover apps, packages, and tools.
- [ ] Existing routes and assets resolve unchanged.
- [ ] Mobile lint and TypeScript checks pass.

## Verification Strategy

Run the mobile lint/type checks and inspect Expo configuration output from the new directory.

## Dependencies

None.

## Files Expected To Change

`package.json`, `bun.lock`, `apps/mobile/**`, root configuration files, and affected documentation links.
