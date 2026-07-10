# Expo HAS CHANGED

Always use dev-mind whenever documentation is needed and it can help, if you cannot find the info you need, use exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

## 1. Overview

Philcoino is a local-only espresso-machine monitoring and temperature-control system composed of a mobile client, a language-neutral HTTP contract, a deterministic development simulator, and ESP32-C3 firmware. Firmware is the authority for sensor validation, persisted targets, real-time heater control, timeouts, and faults; the phone is never part of the safety loop.

## 2. Folder Structure

- `apps/mobile`: Expo 54 / React Native application for one selected machine.
  - `app`: Expo Router entry point and root layout. Route files default-export screens; navigation concerns stay here.
  - `components`: pairing, dashboard, machine controls, and reusable presentation. The large screen components currently combine orchestration and presentation, so trace their hooks and services before splitting them.
  - `hooks`: React lifecycle adapters. `use-machine-dashboard.ts` binds focus/AppState to polling and mutation sessions.
  - `src/discovery`: mDNS service parsing plus native and unsupported-platform adapters. TXT identity and resolved addresses are treated as untrusted input.
  - `src/pairing`: device inspection, bearer authentication, cached-address restore, identity re-checks, and rediscovery recovery.
  - `src/networking`: normalized local origins, the injected/fetch-backed API client, strict protocol parsing, timeout/cancellation ownership, error taxonomy, and debug client.
  - `src/storage`: strict single-device record and Expo SecureStore adapter; the record contains the device ID, last successful origin, and bearer token.
  - `src/dashboard`: completion-driven polling, serialized acknowledged mutations, connection mapping, and pure presentation helpers. Never display requested values as live state before a valid device response.
  - `test`: Bun tests for transport, persistence, discovery, pairing, polling, mutation races, simulator integration, debug mode, and view-model behavior.
  - `plugins/with-android-cleartext.js`: narrowly enables local HTTP in generated Android configuration; do not hand-edit generated native projects.
- `packages/protocol`: API v1 contract shared across TypeScript consumers and independently reimplemented by firmware.
  - `openapi.yaml`: authoritative wire contract, despite the extension it is JSON-compatible YAML 1.2. Paths, authentication, request/response shapes, limits, and errors start here.
  - `src`: strict Zod schemas, constants, and inferred TypeScript types. Unknown properties are rejected.
  - `fixtures`: accepted and rejected wire examples.
  - `scripts` and `test`: OpenAPI structural validation plus schema/example/drift checks.
- `tools/device-simulator`: development-only Bun/Hono API and UI-integration simulator.
  - `src/app.ts`: bearer middleware, API v1 routes, contract errors, and `_simulator` control routes.
  - `src/model.ts`: manually advanced, deterministic temperature/readiness/steam-timeout model with persisted-vs-volatile reset behavior.
  - `test`: contract, authentication, persistence, mutation, timeout, and injected-fault scenarios. Simulator success is not firmware-safety evidence.
- `firmware/espresso-machine`: independent ESP-IDF 6.0.2 CMake project, outside the Bun workspace.
  - `components/firmware_config`: version, identity, pins, ranges, timeouts, duty-curve constants, and diagnostic feature flags.
  - `components/peripherals`: host-testable MAX6675 decoding, target storage policy, fail-off SSR wrapper, SSD1306 rendering, and ESP-IDF GPIO/I2C/NVS adapters.
  - `components/control`: host-testable brew/steam state machine, readiness, steam return, heating timeout, fault latching, permission gating, and ten-second SSR duty windows.
  - `components/networking`: strict C++ API parser/serializer and ESP-IDF Wi-Fi, HTTP, bearer, mutex, and mDNS adapters.
  - `main`: fail-off startup ordering, storage/sensor/display initialization, control-loop ownership, API synchronization, and background network startup.
  - `host-tests`: native C++ policy/API tests and TypeScript validation of firmware contract captures; no hardware is required.
- `docs`: human-facing source of truth.
  - `README.md`: documentation map and document authority.
  - `ARCHITECTURE.md`: implemented end-to-end runtime flows and ownership boundaries.
  - `DEVELOPMENT.md`: prerequisites, local workflows, simulator/debug modes, and verification matrix.
  - `SAFETY.md`: prototype limits, known blockers, physical-validation boundary, and safe contribution rules.
  - `prds` and `TRACKER.md`: approved scope, supervised tasks, acceptance state, and evidence; do not infer completion from code presence.
  - `architecture`, `decisions`, `protocol`, `hardware`, `references`, and `side-notes.md`: durable decisions, detailed contracts, exact-version sources, wiring/tuning notes, and deferred human checks.
- Root files:
  - `README.md` and `CONTRIBUTING.md`: public project entry points; keep setup, status, safety, and verification claims aligned with current source.
  - `CODEBASE_REVIEW_REPORT.md`: current review findings and quality-gate evidence; unresolved BLOCKER/MAJOR findings must remain visible.
  - `package.json`: Bun workspace orchestration for `apps/*`, `packages/*`, and `tools/*`; it intentionally excludes firmware.

## 3. Working Agreements

- Respond in the user's preferred language; otherwise infer it from the repository. Keep technical terms in English and never translate fenced code blocks.
- Before editing, read the active PRD task, `docs/TRACKER.md`, relevant decision/reference/safety documents, all callers, the full success and failure flow, and shared contract boundaries. Do not advance or mark later tasks complete without the required approval.
- Start wire changes in `packages/protocol/openapi.yaml`, then align Zod schemas, fixtures, simulator, mobile parsing, firmware parsing/serialization, tests, and public docs. C++ validates independently; never couple firmware to TypeScript implementation details.
- Preserve firmware authority. The app may validate for feedback, but firmware owns targets, persistence, sensors, readiness, timeouts, heater permission/output, and faults. UI mutations stay pending until acknowledged; failure or cancellation must not appear as success or retain stale live data.
- Treat mains-powered heater work as safety-critical. Do not infer approval for wiring, energized tests, production use, or unresolved review findings. Keep `docs/SAFETY.md`, `docs/side-notes.md`, hardware docs, and `CODEBASE_REVIEW_REPORT.md` aligned; report deferred physical checks explicitly.
- Preserve strict boundaries: normalize local origins, validate all untrusted discovery/storage/HTTP data, keep cancellation first-cause semantics, avoid overlapping polls, serialize mutations, maintain deterministic simulator time, and default firmware failures to an off command.
- Preserve unrelated worktree changes. Never read or recursively search dependency, generated, cache, build, coverage, binary-heavy, or database paths such as `node_modules`, `.expo`, `dist`, `build`, `coverage`, `managed_components`, `sdkconfig`, or SQLite files unless the user explicitly requests a specific file.
- Never install a package, program, CLI, SDK, or dependency without explicit user permission. Ask before introducing tests, lint/formatter infrastructure, generated native projects, or new configuration systems.
- Use project-pinned documentation: prefer `dev-mind`; otherwise use `docs/references` and exact Expo 54 / React Native 0.81 / ESP-IDF 6.0.2 sources. Do not guess version-sensitive APIs.
- Keep new functions and modules single-purpose and colocated with their owner. Follow existing TypeScript strict schemas and injected boundaries; keep pure C++ policy separate from ESP-IDF adapters.
- Run every configured check relevant to changed areas. Type-check TypeScript packages with their package `typecheck` scripts; run Bun tests for affected workspaces; validate OpenAPI for contract changes; use the independent host CMake suite and, when available, the pinned ESP-IDF target build for firmware changes. Never present simulator tests as heater-safety validation.
- Report changed behavior, affected areas, contract/API compatibility, safety impact, verification evidence, assumptions, checks not run, deferred human acceptance, and remaining blockers.
- Before every Git operation, reread `docs/GIT_RULES.md`. Stage only intended files, never push `master`, and create pull requests only through the GitHub Connector or `gh`.
