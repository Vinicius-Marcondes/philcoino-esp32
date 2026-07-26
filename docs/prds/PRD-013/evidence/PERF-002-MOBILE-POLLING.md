# PERF-002 mobile scale polling evidence

Date: 2026-07-26

## Behavior

The scale endpoint now has one completion-driven polling owner. It starts one
immediate request, schedules exactly one timer only after the request and
snapshot handling settle, and aborts without late publication or rescheduling
when stopped.

The next cadence uses current Scale-page visibility and the latest validated
`ScaleState.activeExtraction`:

- Scale page hidden and no weighted extraction: 1,000 ms.
- Scale page visible: 250 ms.
- Validated weighted extraction active: 250 ms.
- Weighted extraction becomes idle: 1,000 ms from that fresh response.
- Failed request while the Scale page is hidden: 1,000 ms; stale weighted state
  is not retained.

Manual and timed extraction no longer select fast scale polling. They are not an
input to the polling session.

## Before/after request-rate bounds

| State | Before | After |
| --- | ---: | ---: |
| Idle after stale weighted response | 250 ms / up to 4 steady-state requests/s | 1,000 ms / up to 1 steady-state request/s |
| Manual or timed extraction, Scale page hidden | 250 ms / up to 4 steady-state requests/s | 1,000 ms / up to 1 steady-state request/s |
| Scale page visible | 250 ms / up to 4 steady-state requests/s | 250 ms / up to 4 steady-state requests/s |
| Weighted extraction active | 250 ms intended but dependent on stale render/extraction state | 250 ms from the fresh scale acknowledgement |
| Maximum concurrent scale requests | 1 in the old completion loop, with effect restarts relying on abort | 1, including visibility changes and repeated Start |

These are deterministic scheduler bounds. Real request/processing duration can
only lower the steady-state rate because the delay starts after completion.
Start/resume adds one immediate request; over an inclusive ten-second window the
maximum is therefore 11 idle or 41 approved-fast requests, including time zero.

## Compatibility and safety

- No OpenAPI, protocol schema, route, request, response, authentication,
  simulator, or firmware behavior changed.
- Firmware scale/extraction state remains authoritative.
- The change affects only mobile API consumption and cannot participate in the
  heater or pump safety loop.
- No package, dependency, generated native project, or configuration system was
  added.

## Verification

- PASS — focused `ScalePollingSession` tests: 6 tests, 21 expectations.
- PASS — complete mobile Bun suite: 173 tests, 1,136 expectations.
- PASS — mobile TypeScript typecheck.
- PASS — Expo lint with no warnings.
- Native device timing was not manually exercised; the deterministic scheduler
  covers the request cadence/concurrency policy without claiming platform or
  physical validation.
