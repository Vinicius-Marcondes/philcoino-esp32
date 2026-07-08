# @philcoino/protocol

The shared v1 HTTP contract for the Philcoino mobile app, device simulator, and
ESP-IDF firmware.

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
