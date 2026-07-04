# Philcoino documentation

This directory is the source of truth for product, architecture, protocol, and delivery documentation for the Philcoino iPhone app and ESP32 integration.

## Initial product scope

Philcoino will discover an espresso-machine ESP32 on the user's local network, authenticate with it, remember the selected device, and provide live monitoring and control of the machine.

The first release is expected to cover:

- local-network device discovery and reconnection;
- bearer-token authentication and secure local persistence;
- machine health, connection state, current temperature, configured brew temperature, configured steam temperature, and operating status;
- explicit handling for offline, unauthorized, and device-not-found states.

## Planned documents

- `prds/`: product requirements and deterministic acceptance criteria;
- `architecture/`: app boundaries, discovery strategy, persistence, networking, and state management;
- `protocol/`: versioned ESP32 HTTP API contract, authentication, discovery identity, error formats, and examples;
- `decisions/`: short architecture decision records for choices that are costly to reverse.

## Current drafts

- [`architecture/repository-layout.md`](architecture/repository-layout.md): proposed Expo and ESP-IDF monorepo organization.
- [`decisions/firmware-foundation.md`](decisions/firmware-foundation.md): human-approved ESP-IDF, identity, safety-constant, display, GPIO, and secret-handling decisions.
- [`hardware/esp32-c3-wiring.md`](hardware/esp32-c3-wiring.md): proposed module wiring and unresolved electrical-safety checks.
- [`prds/PRD-001/PRD-001.md`](prds/PRD-001/PRD-001.md): draft product requirements for local monitoring and temperature control.
- [`protocol/api-v1-outline.md`](protocol/api-v1-outline.md): initial discovery, authentication, state, and temperature API contract.
- [`references/README.md`](references/README.md): authoritative versioned software, firmware, component, and safety references.
- [`side-notes.md`](side-notes.md): important unresolved items that do not stop software planning.

## Planning sequence

1. Define the v1 user workflows and safety boundaries.
2. Freeze a versioned ESP32 API and discovery contract.
3. Choose the iOS-compatible discovery mechanism and fallback setup flow.
4. Define token provisioning, storage, rotation, and reset behavior.
5. Draft and approve the first PRD.
6. Split the approved PRD into supervised implementation tasks.
7. Build a small discovery/authentication proof of concept before the full interface.

No implementation decisions in this file are final until they are captured in an approved PRD or architecture decision.
