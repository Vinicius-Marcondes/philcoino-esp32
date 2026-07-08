# Expo HAS CHANGED

Always use dev-mind whenever documentation is needed and it can help, if you cannot find the info you need, use exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

## 1. Overview

Philcoino is a local espresso-machine monitoring and temperature-control system spanning a phone client, a language-neutral wire contract, a deterministic simulator, and device firmware. Firmware remains authoritative for real-time control, validation, persistence, heater safety, and fault handling.

## 2. Folder Structure

- `apps/mobile`: Expo 54 and React Native client.
  - `app`: Expo Router route tree and layouts; keep screen and navigation work here.
  - `components`, `hooks`, and `constants`: reusable UI, platform hooks, and theme primitives.
  - `src/dashboard`: polling and mutation sessions plus presentation view models; acknowledged device responses, not requested values, drive live state.
  - `src/discovery` and `src/pairing`: mDNS adapter boundaries, identity verification, authentication, and cached-address recovery.
  - `src/networking`: typed local-device client, strict protocol parsing, timeout/cancellation handling, and connection-state mapping.
  - `src/storage`: single-device persistence boundary backed by Expo SecureStore.
  - `test`: Bun coverage for networking, persistence, discovery, polling, mutation races, simulator integration, and view-model behavior.
  - `assets`: application icons and static images.
- `packages/protocol`: language-neutral API boundary shared by clients and simulators.
  - `openapi.yaml`: authoritative HTTP v1 paths, payloads, limits, and errors.
  - `src`: strict Zod schemas and inferred TypeScript types.
  - `fixtures` and `test`: valid/invalid wire examples and contract verification.
- `tools/device-simulator`: development-only Bun/Hono implementation of the protocol.
  - `src`: authenticated API surface, manual-time machine model, and simulator-only controls kept outside `/api/v1`.
  - `test`: deterministic state, persistence, timeout, and fault scenarios.
- `firmware/espresso-machine`: independent ESP-IDF 6.0.2 CMake project; it is not a Bun workspace.
  - `components/firmware_config`: host-testable identity, pins, limits, and safety constants.
  - `components/peripherals`: pure C++ peripheral policies plus ESP-IDF SPI, I2C, NVS, and GPIO adapters.
  - `components/control`: host-testable mode, readiness, timeout, persistence, fault-latching, and SSR-control policy.
  - `components/networking`: host-testable HTTP contract plus ESP-IDF Wi-Fi, HTTP, and mDNS adapters.
  - `main`: device startup wiring and local configuration boundary.
  - `host-tests`: native policy tests and firmware contract captures that do not require hardware.
- `docs`: source of truth for delivery scope and approved decisions.
  - `prds`: approved requirements, supervised task files, and acceptance criteria.
  - `architecture`, `decisions`, and `protocol`: repository boundaries, durable decisions, and API design.
  - `hardware` and `references`: wiring status and exact-version implementation sources.
  - `side-notes.md`: deferred human checks and unresolved physical-safety risks that must remain visible after software approval.
  - `TRACKER.md`: current task status, evidence, decisions, and branch/merge guidance.
- Root workspace files coordinate packages under `apps/*`, `packages/*`, and `tools/*`; firmware tooling and generated output remain outside that workspace.

## 3. Working Agreements

- Respond in the user's preferred language; if unspecified, infer it from the repository. Keep technical terms in English and never translate fenced code blocks.
- Build context before editing: read the active PRD task, `docs/TRACKER.md`, relevant decisions/references, related usages, full data flow, failure paths, and shared boundaries.
- Follow the active task exactly. Apply the narrowest complete root-cause fix, check callers and API boundaries, and do not advance later tasks or broaden approved scope.
- Treat `packages/protocol/openapi.yaml` as the wire-contract source of truth. Keep Zod schemas, simulator behavior, mobile parsing, firmware validation, fixtures, and examples aligned without coupling C++ to TypeScript.
- Keep heater control, timeouts, sensor validation, persistence authority, and fault ownership in firmware. Mobile validation exists only for feedback, and requested mutations must not appear live before firmware acknowledgement.
- Ask when a human decision affects scope, hardware behavior, security, or tradeoffs. Never infer approval for mains-powered work, unresolved wiring, or physical acceptance; record deferred checks in `docs/side-notes.md`.
- Preserve unrelated worktree changes. Never read, open, or recursively search dependency, generated, cache, build, coverage, binary-heavy, or local database paths, including `node_modules`, `.expo`, `dist`, `build`, `coverage`, and SQLite files, unless a specific file is explicitly requested.
- Do not install packages, programs, CLIs, or dependencies without explicit user permission. Task-required tests may use existing infrastructure; ask before adding test/lint/formatter infrastructure or configuration.
- Use project-pinned documentation: prefer `dev-mind` when available, otherwise use links in `docs/references` and exact Expo 54 or ESP-IDF 6.0.2 documentation. Do not guess framework APIs.
- Keep new functions and modules single-purpose and colocated with the owning concern. Preserve strict runtime validation, cancellation semantics, deterministic simulator time, and fail-off firmware behavior.
- Run all configured checks relevant to each changed workspace. Keep package checks scoped to that package; validate firmware through its independent CMake/ESP-IDF and host-test boundaries.
- Report changed behavior, compatibility or safety impact, verification evidence, assumptions, deferred human checks, and remaining blockers. Do not claim human acceptance until the owner explicitly grants it.
- Before every Git operation, reread the Git guidance under `docs`; preserve unrelated changes and stage only the intended task files. Never push `master`. Create pull requests only through the GitHub Connector or `gh`.
