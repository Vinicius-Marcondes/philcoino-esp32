# PERF-004 API lock and allocation evidence

Date: 2026-07-26

## Behavior

API v1/v2 state, scale, profile, extraction, and cooldown handlers now copy
plain snapshots and transition results while holding the appropriate workflow
mutex, then release it before JSON serialization, conflict/error construction,
or HTTP response assembly. Temperature-target, mode, heater, and fault-dismiss
responses follow the same response-after-unlock rule.

The host synchronization fake now rejects nested acquisition, tracks unlocks,
and asserts that every request returns with the mutex released.

## Bounded duplicate-work changes

| Operation | Before | After |
| --- | ---: | ---: |
| Route path extraction per lookup | One allocating `std::string::substr` | Non-owning `std::string_view` |
| Successful Authorization header read | Allocating byte vector plus copied string | Fixed 513-byte stack buffer |
| Authorized target request route resolution | Transport lookup plus API lookup | One transport lookup passed to the API |
| API v2 state response assembly | Chained concatenations with implementation-defined growth | Exact component sizes summed, one bounded `reserve`, then append |

All response components remain bounded by the existing strict protocol limits.
No new heap, codec, JSON, dependency, or configuration system was introduced.

## Compatibility and safety

- The 32 captured response bodies remain valid against the unchanged protocol
  contract; routes, authentication challenges, status codes, and public schemas
  are unchanged.
- Pre-body authentication remains in the HTTP transport. Unauthorized request
  bodies are not read.
- Snapshot coherence improves without changing firmware authority, heater/pump
  behavior, timeouts, faults, fail-off behavior, history, profiles, prediction,
  or persistence ordering.
- No physical or energized safety validation is inferred.

## Verification

- PASS — complete native firmware host suite: 7/7.
- PASS — complete ASan/UBSan firmware host suite: 7/7.
- PASS — 32 generated firmware response captures validated.
- PASS — route query equivalence and lock-depth/unlock regression coverage.
- NOT RUN — ESP-IDF 6.0.2 target build, image/IRAM/DRAM delta, and on-target
  latency/heap comparison; the pinned toolchain remains unavailable
  (`idf.py` absent and `IDF_PATH` unset).
