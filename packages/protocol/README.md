# @philcoino/protocol

The shared HTTP contract for the Philcoino mobile app, device simulator, and
ESP-IDF firmware. API v1 remains the compatible temperature-control surface;
API v2 extraction/profile shapes are implemented by mobile and the simulator
and staged for later firmware integration.

- `openapi.yaml` is the language-neutral source of truth. It uses JSON syntax,
  which is valid YAML 1.2, so validation does not require a YAML parser.
- `src/` exports strict Zod schemas and inferred TypeScript types for all request
  and response payloads.
- `fixtures/valid/` contains representative wire payloads.
- `fixtures/invalid/` contains payloads that must be rejected.

Run from the repository root:

```sh
bun run test:protocol
bun run typecheck:protocol
bun run validate:openapi
```

All authenticated operations use `Authorization: Bearer <token>`. The public
operations are `GET /healthz` and `GET /api/v1/device`.

API v1 authenticated operations are state read, temperature-target update, mode
selection, volatile heater permission, and cooled over-temperature dismissal.
API v2 additionally defines combined machine/extraction/compensation/cooldown
state, four-slot profile read/replace, idempotent extraction Start/Stop, and
idempotent cooldown Start/Stop. Cooldown and compensation fields describe
firmware acknowledgements and GPIO/control commands only; they are not evidence
of physical flow, current, cooling, SSR state, or de-energization. Layer support
is introduced by the supervised PRD tasks after the contract task.
Objects are strict: consumers must reject unknown fields rather than silently
accept protocol drift.

Change `openapi.yaml` first, then align schemas, fixtures, simulator, mobile,
firmware parsing/serialization, contract captures, tests, and public docs. The
firmware validates independently in C++; this package must not become a runtime
dependency of embedded code.

See [Architecture](../../docs/ARCHITECTURE.md) and the human-readable
[API v1 outline](../../docs/protocol/api-v1-outline.md).
