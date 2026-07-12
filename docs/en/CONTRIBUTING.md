# Contributing to Philcoino

[Português do Brasil](../../CONTRIBUTING.md)

Thank you for helping improve Philcoino. This repository crosses mobile networking, an HTTP contract, embedded firmware, and mains-adjacent temperature control, so a good contribution keeps ownership and safety boundaries visible.

> [!IMPORTANT]
> Philcoino is a prototype and is not approved for production, unattended, or mains-powered heater operation. Read [Safety](SAFETY.md) and the [current review findings](../../CODEBASE_REVIEW_REPORT.md) before changing firmware, control logic, sensors, SSR behavior, networking security, or hardware guidance.

## Before you start

1. Read the [project overview](README.md), [architecture](../ARCHITECTURE.md), and [development guide](../DEVELOPMENT.md).
2. Check [the tracker](../TRACKER.md) and the relevant PRD/task. Code presence does not imply human acceptance.
3. Read the relevant decision, protocol, hardware, reference, and side-note documents.
4. Before any Git operation, read [the Git rules](../GIT_RULES.md).
5. For AI-assisted changes, follow [AGENTS.md](../../AGENTS.md).

Discuss first when a change affects product scope, API compatibility, physical hardware, security assumptions, persistent data, or safety behavior. Never infer authorization for energized testing.

## Development setup

The TypeScript workspaces use Bun. Expo SDK 54 requires Node.js 20.19 or newer. Install declared dependencies only after reviewing the manifest change:

```bash
bun install
```

Firmware is independent and pinned to ESP-IDF 6.0.2 / ESP32-C3. Its host tests need CMake and a C++17 compiler; target builds need the pinned ESP-IDF environment. See [Development](../DEVELOPMENT.md) for exact workflows.

Do not commit `.env` values, bearer tokens, Wi-Fi credentials, `sdkconfig`, generated native projects, dependency folders, build output, caches, coverage, or local databases.

## Choose the owning boundary

- Routes and navigation belong in `apps/mobile/app`; reusable UI belongs in `apps/mobile/components`.
- Discovery, pairing, networking, storage, polling, and mutation orchestration stay in their existing `apps/mobile/src/*` boundaries.
- API changes begin in `packages/protocol/openapi.yaml`.
- Deterministic contract/UI behavior belongs in `tools/device-simulator`; simulator-only controls stay under `/_simulator`.
- Pure firmware policy belongs in host-testable components. ESP-IDF calls stay in `esp_*` adapters or `main` wiring.
- Product, architecture, development, and safety claims belong under `docs` and must match current source.

Avoid adding a new abstraction when the owning boundary already exists. Keep new functions small, single-purpose, and near their consumers.

## Changing the API

Treat an API change as one coordinated change:

1. Update `packages/protocol/openapi.yaml`.
2. Align Zod schemas/types and valid/invalid fixtures.
3. Update simulator request handling and responses.
4. Update the mobile client, error mapping, and affected sessions/UI.
5. Update firmware parsing, serialization, and route registration independently in C++.
6. Extend contract, simulator, mobile, and firmware-capture tests.
7. Update human-readable protocol and architecture docs.

Unknown properties are rejected. Do not weaken runtime validation to absorb drift silently.

## Preserving runtime behavior

- Firmware owns sensors, target validation, NVS persistence, readiness, timeouts, heater permission/output, and faults.
- Mobile mutations must remain pending until a valid acknowledgement. Never optimistically publish a requested mode, target, or heater state as live.
- Pause polling while a mutation is in flight and ignore stale work after cancellation/generation changes.
- Clear live snapshots when the connection becomes unavailable; do not present cached values as current machine state.
- Keep first-cause timeout versus caller-cancellation semantics.
- Preserve deterministic manual time in the simulator. Do not claim the simulator models the firmware's real-time duty loop or safety response.
- Firmware failure paths must attempt to command the SSR off, but documentation must not equate a software command with confirmed physical de-energization.

## Validation

Run checks for every affected area, not just the package you edited. The complete command matrix is in [Development](../DEVELOPMENT.md).

At minimum:

| Changed area | Required checks |
| --- | --- |
| Mobile | mobile typecheck, tests, lint; exercise affected native/web behavior where applicable |
| Protocol | OpenAPI validation, protocol typecheck/tests, every dependent package check |
| Simulator | simulator typecheck/tests plus protocol checks |
| Firmware policy/API | native host build/tests and contract capture validation |
| ESP-IDF adapters/config | host checks plus pinned `idf.py build` when the toolchain is available |
| Documentation | commands and claims checked against manifests/source; local Markdown links checked |

Report checks that could not run. Passing simulator or host tests are not physical hardware acceptance.

## Pull requests

Keep one clear goal per pull request and use the GitHub Connector or `gh` to create it. Include:

- what changed and why;
- affected packages and runtime flows;
- API compatibility and persisted-data impact;
- safety or hardware impact;
- automated and manual verification, including omissions;
- assumptions, deferred human checks, and remaining blockers;
- documentation updated with the behavior.

Never push directly to `master`, discard unrelated work, or include generated/dependency output.
