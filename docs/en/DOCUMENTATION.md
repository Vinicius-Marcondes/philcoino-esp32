# Philcoino documentation

[Português do Brasil](../README.md)

This directory explains the implemented Philcoino system, the approved product scope, and the safety work that is still incomplete. Read documents by authority rather than assuming every historical plan describes current code.

## Languages

- Brazilian Portuguese is the default for general reader-facing documents: project overview, contributing, documentation index, and safety.
- Equivalent English versions live under [`docs/en`](.).
- Technical documents for software engineers and AI agents remain in English at their existing paths, including architecture, development, protocol, hardware, PRDs, tracker, references, and Git rules.
- When public behavior changes, update the Portuguese and English versions in the same change.

## Start here

| Document | Use it for |
| --- | --- |
| [Project README](README.md) | Public overview, current capabilities, and quickest simulator/debug start |
| [Architecture](../ARCHITECTURE.md) | Runtime components, ownership, data flows, state transitions, and failure behavior |
| [Development](../DEVELOPMENT.md) | Prerequisites, package workflows, simulator controls, firmware setup, and verification |
| [Safety](SAFETY.md) | Prototype restrictions, known software/hardware risks, and the physical-acceptance boundary |
| [Contributing](CONTRIBUTING.md) | Change process, contract workflow, validation expectations, and pull-request checklist |
| [PRD-001 tracker](../TRACKER.md) | Supervised task state, recorded evidence, approvals, and work still awaiting acceptance |
| [Codebase review](../../CODEBASE_REVIEW_REPORT.md) | Detailed current BLOCKER/MAJOR/MINOR findings and quality-gate results |

## Sources of truth

When documents disagree, use this order:

1. `packages/protocol/openapi.yaml` for the HTTP wire contract.
2. Current source and tests for implemented runtime behavior.
3. Approved decisions under `docs/decisions` and the active PRD for intended boundaries.
4. `docs/TRACKER.md` for supervised task acceptance—not merely whether code exists.
5. Hardware and side-note documents for physical constraints and deferred checks.

Do not silently resolve a safety, hardware, security, or scope conflict. Record it and request a human decision.

## Architecture and protocol

- [`ARCHITECTURE.md`](../ARCHITECTURE.md): current mobile, protocol, simulator, and firmware architecture.
- [`architecture/repository-layout.md`](../architecture/repository-layout.md): durable repository boundaries and placement guidance.
- [`protocol/api-v1-outline.md`](../protocol/api-v1-outline.md): human-readable API rationale and examples; OpenAPI remains authoritative.
- [`protocol/api-v2-outline.md`](../protocol/api-v2-outline.md): firmware-acknowledged profiles and extraction while v1 remains compatible.
- [`decisions/firmware-foundation.md`](../decisions/firmware-foundation.md): approved firmware/toolchain/foundation decisions.

## Product and delivery

- [`prds/PRD-001/PRD-001.md`](../prds/PRD-001/PRD-001.md): approved local monitoring and temperature-control requirements.
- [`prds/PRD-001/tasks`](../prds/PRD-001/tasks): supervised task definitions and acceptance criteria.
- [`TRACKER.md`](../TRACKER.md): current execution state and evidence.

The PRD and task files are historical/approval records. If implementation has moved ahead of the tracker, do not mark acceptance complete without the required reviewer.

## Hardware and safety

- [`SAFETY.md`](SAFETY.md): public safety status and contribution rules.
- [`hardware/esp32-c3-wiring.md`](../hardware/esp32-c3-wiring.md): GPIO assignments, module wiring, and unresolved electrical checks.
- [`hardware/temperature-control-tuning.md`](../hardware/temperature-control-tuning.md): implemented duty curve and tuning considerations.
- [`side-notes.md`](../side-notes.md): deferred physical iPhone, hardware, relay, cutoff, and mains checks.
- [`references/README.md`](../references/README.md): exact-version framework, firmware, component, and safety references.

No repository document constitutes electrical, thermal, regulatory, or unattended-operation approval.

## Keeping documentation current

Update public docs in the same change when any of these move:

- setup prerequisites, commands, platforms, or package layout;
- API paths, schemas, authentication, limits, or error mapping;
- discovery, pairing, persistence, polling, or mutation behavior;
- firmware state transitions, target ranges, timeouts, fault behavior, or hardware configuration;
- safety status, known review findings, or deferred physical checks.

Use present tense only for behavior observable in current source. Label proposed, pending, diagnostic, simulated, and human-approved behavior explicitly.
