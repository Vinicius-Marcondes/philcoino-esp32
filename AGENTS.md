# Expo HAS CHANGED

Always use dev-mind whenever documentation is needed and it can help, if you cannot find the info you need, use exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

## 1. Overview

Philcoino is a local espresso-machine monitoring and temperature-control system spanning a phone client, a shared wire contract, a deterministic simulator, and device firmware. The firmware remains the authority for real-time control, validation, persistence, heater safety, and fault handling.

## 2. Folder Structure

- `apps/mobile`: Expo 54 and React Native client.
  - `app`: Expo Router route tree and layouts; keep screen and navigation work here.
  - `components`, `hooks`, and `constants`: reusable UI, platform hooks, and theme primitives.
  - `src/networking`: typed local-device client, strict protocol parsing, timeout/cancellation handling, and connection-state mapping.
  - `src/storage`: single-device persistence boundary backed by Expo SecureStore.
  - `test`: Bun unit coverage for mobile networking and persistence behavior.
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
  - `hardware`, `references`, and `side-notes.md`: wiring status, exact-version documentation, and unresolved physical-safety risks.
  - `TRACKER.md`: current task status, evidence, decisions, and branch/merge guidance.
- Root workspace files coordinate packages under `apps/*`, `packages/*`, and `tools/*`; firmware tooling and generated output remain outside that workspace.

## 3. Working Agreements

- Respond in the user's preferred language; if unspecified, infer it from the repository. Keep technical terms in English and never translate fenced code blocks.
- Build context before editing by reviewing related usages, flows, shared abstractions, recurring patterns, approved PRD scope, and likely impact.
- Fix the underlying cause, not only the visible symptom; use the narrowest complete change that resolves affected flows without broadening the active task.
- Treat `packages/protocol/openapi.yaml` as the wire-contract source of truth. Keep Zod, simulator, mobile, and firmware behavior aligned without coupling firmware to TypeScript.
- Keep safety rules in firmware even when the mobile app duplicates validation for feedback. Never move heater control, timeouts, sensor validation, or fault ownership to the phone.
- Ask actively when a human decision affects scope, hardware behavior, security, or tradeoffs. Never infer approval for mains-powered testing or unresolved wiring.
- Check side effects across callers, shared abstractions, and behavior/API boundaries; report relevant changes, compatibility risks, verification results, and remaining blockers.
- Run the checks already configured for every changed workspace. Keep package-only verification scoped to that package and validate firmware through its independent CMake boundary.
- Ask before introducing tests, lint/formatter configuration, packages, programs, CLIs, or dependencies. Never install anything without explicit user permission; explain why any new external dependency is necessary.
- Keep new functions and modules single-purpose and colocated with the code that owns the concern.
- Preserve unrelated working-tree changes. Never read, open, or recursively search `node_modules`, generated, dependency, cache, build, coverage, binary-heavy, or local database paths unless the user explicitly requests a specific file.
- Follow `docs/TRACKER.md` and the active task file exactly. Do not advance later tasks, broaden a PRD, or claim human acceptance without confirmation.
- Before Git operations, read the Git guidance under `docs`. Never push `master`; create pull requests only through the GitHub Connector or `gh`.
