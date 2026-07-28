# PRD-016 software verification

Date: 2026-07-28

Status: PASS for every configured software check; ESP-IDF target evidence
unavailable; physical A/B not performed.

## Contract and TypeScript workspaces

From the repository root:

```text
bun run validate:openapi
bun run test:protocol
bun run typecheck:protocol
```

PASS — OpenAPI valid; protocol 138 tests / 280 expectations; typecheck.

```text
bun run test:simulator
bun run typecheck:simulator
```

PASS — simulator 77 tests / 556 expectations; typecheck.

From `apps/mobile`:

```text
bun run test
bun run typecheck
bun run lint
```

PASS — mobile 180 tests / 1,188 expectations; typecheck; Expo lint. The
configured suite includes a Bun in-memory SQLite v4-to-v5 migration that
preserves ordinary history/provenance and removes prediction storage.

## Offline desktop research

```text
pytest tools/thermal-modeling/tests
```

PASS — 32 tests, including minimum non-predictive CSV ingestion, ignored-by-
default legacy prediction columns, normal CLI workflows, and independent C++
coefficient parity for the standalone historical artifact.

## Firmware native, build-mode, sanitizer, and captures

Native build:

```text
cmake -S firmware/espresso-machine/host-tests -B <temporary-native>
cmake --build <temporary-native>
ctest --test-dir <temporary-native> --output-on-failure
<temporary-native>/resource_budget_test
<temporary-native>/firmware_api_test <temporary-captures>
bun run firmware/espresso-machine/host-tests/validate_contract.ts <temporary-captures>
```

PASS — 10/10. The matrix contains separate
`controller_authority_legacy_test` and `controller_authority_pi_test`
executables, so both compile-time authority modes run in the same configured
matrix. PASS — 32 strict response captures.

Sanitizer build:

```text
cmake -S firmware/espresso-machine/host-tests -B <temporary-sanitizer> \
  -DPHILCOINO_ENABLE_SANITIZERS=ON
cmake --build <temporary-sanitizer>
ctest --test-dir <temporary-sanitizer> --output-on-failure
```

PASS — 10/10 under the configured ASan/UBSan targets.

## Resource and timing evidence

Exact host layouts:

```text
HistorySample=40
HistoryBuffer=24072
HistoryPage=416
ControlSnapshot=128
BrewPiController=76
```

Enforced host ceilings are 48 bytes per history sample, 40 KiB for the
600-sample ring, 2 KiB for a copied page, eight samples per wire page, and 8 KiB
for serialized history. PI uses the existing exact 500 ms controller interval;
the source statically binds it to the MAX6675 interval. Pure tests cover invalid
or irregular timing, deadline-preserving phase/target transitions, legacy/PI
authority, and existing 1,500 ms safety-lease renewal/trip/failure behavior.

This is host evidence only. Target stack, heap, flash/map deltas, FreeRTOS
scheduling, watchdog behavior, cache suspension, GPIO timing, and real lease
latency remain unmeasured.

## Unavailable target evidence

`idf.py` is not available in the configured shell (`command -v idf.py`
returned no path). No package, CLI, SDK, or dependency was installed.
Consequently these required pinned ESP-IDF 6.0.2 commands were not run:

```text
cd firmware/espresso-machine
idf.py set-target esp32c3
idf.py build
```

The active-PI target build, map/size comparison, task stack, heap/flash delta,
and connected-target timing remain explicit blockers. Host and simulator
results do not substitute for them.

## Compatibility and safety result

- API v1 and queryless API v2 ordinary state are unchanged.
- Prediction query/types/payloads are intentionally removed as a matched
  firmware/mobile API v2 break.
- History is strict at eight samples and carries controller configuration plus
  command/request diagnostics.
- Default builds keep the legacy Brew curve authoritative; an active selector
  changes only Brew requested-duty authority. Steam and all existing
  permission, inhibit, timeout, fault, lease, minimum-pulse, and fail-off
  boundaries remain covered.
- No physical, connected-target, low-voltage, or energized test was performed.
  No result proves SSR current, heater power, de-energization, thermal
  improvement, wiring, cutoff behavior, or mains safety.
