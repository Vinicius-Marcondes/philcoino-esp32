# PRD-007 implementation evidence

Date: 2026-07-18

## Implemented behavior

- Firmware captures one compact full-context sample per actual second into a
  600-slot RAM-only ring. It uses a new ephemeral 128-bit boot ID after startup,
  increasing sequence values, and a zero-wait history-specific atomic guard.
- Authenticated `GET /api/v2/history` copies no more than 60 ascending samples
  before JSON serialization and reports `initial`, `continuous`, `truncated`,
  or `reset` continuity. Existing API v1 and API v2 response bodies did not
  change.
- The deterministic simulator implements the same capture interval, page size,
  overflow, reboot, cursor validation, and command/status/fault context.
- After fresh combined state, mobile starts an abortable history session without
  delaying live publication, polling, or control mutations. HTTP 404 silently
  retains foreground-only history. A transient device rejection is retried
  once; remaining network, device, protocol, or storage failures are identified
  separately and remain localized to the graph.
- The first page request/response midpoint anchors firmware uptime to phone UTC.
  Each SQLite page and cursor commit atomically. Nullable boot/sequence columns
  plus a partial unique index deduplicate device rows, and overlapping
  phone-origin rows are replaced.
- Live uses populated rolling 30-second windows, opens newest, remains
  horizontally pageable without a visible scrollbar, follows only at the
  latest offset, and preserves an inspected older window when earlier pages are
  inserted. Today downsampling and CSV columns remain unchanged.

## Automated verification

| Area | Result |
| --- | --- |
| OpenAPI | Syntax, paths, security, and local references valid |
| Protocol | Typecheck pass; 123 tests / 247 expectations pass |
| Simulator | Typecheck pass; 65 tests / 410 expectations pass |
| Mobile | Typecheck and lint pass; 133 tests / 863 expectations pass |
| Native firmware host | CTest 6/6 pass |
| ASan/UBSan firmware host | CTest 6/6 pass |
| Independent firmware captures | 30/30 validate |

Mobile/simulator integration explicitly covers paginated recovery, durable
resume after a failed later page, reboot reset, and gap-free two-, five-, and
ten-minute recovery. Native SQLite page commits use exclusive transactions and
idempotently replace a retried device sequence even if its phone-time anchor
changes. History cancellation checks use the React Native-compatible
`AbortSignal.aborted` property and do not require the optional browser
`throwIfAborted()` method. Simulator and firmware tests cover
overflow/truncation, strict malformed/duplicate/partial/future cursors, and
boot reset.

## Resource and safety boundary

`HistorySample` has a compile-time exact size of 16 bytes, making the retained
sample payload 9,600 bytes. `HistoryBuffer` is compile-time bounded to at most
12 KiB, and `HistoryPage` contains at most 60 copied samples. The control-loop
writer performs one atomic test and skips rather than waiting on a reader;
serialization happens after the bounded copy releases that guard.

These are source and host-test facts. They do not establish ESP-IDF scheduling,
target image/DRAM deltas, runtime heap/stack margins, network responsiveness, or
physical heater/pump behavior.

## Remaining completion gates

- `idf.py`/ESP-IDF 6.0.2 is unavailable in this workspace, so the pinned
  ESP32-C3 build and image/static-RAM comparison were not run.
- No connected ESP32-C3 is available for history-request peak heap, HTTP stack
  high-water, representative request latency, or control-loop timing evidence.
- Native iPhone minimize/restore, force-close/reopen, paging/follow behavior,
  localized states, reboot/overflow gaps, and CSV acceptance remain HIST-007.
- No automated or Human result here proves current, flow, cooling,
  de-energization, wiring correctness, mains safety, or certification.
