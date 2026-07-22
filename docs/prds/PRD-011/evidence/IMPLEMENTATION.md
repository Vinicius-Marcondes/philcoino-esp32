# PRD-011 implementation evidence

Date: 2026-07-21

## Implemented boundary

- Firmware version `0.3.2` calculates passive temperature predictions and
  hypothetical heater corrections without connecting them to SSR output.
- The existing nonlinear ten-second duty controller remains the sole heater
  policy. A host test compares complete heater command traces with prediction
  passive and disabled.
- The checked-in slope-extrapolation model is an unvalidated seed for passive
  collection only. It is not authorization for active correction.
- New firmware emits at most 8 history samples per page. The consumer schema
  accepts legacy pages containing up to 60 samples, and prediction diagnostics
  are optional for older firmware.
- Mobile requests live diagnostics through the opt-in
  `GET /api/v2/state?include=prediction` shape and stores them with each normal
  foreground row. Queryless API v2 state remains strict and unchanged. Retained
  history recovery now runs only after a detected discontinuity, and export
  waits only for recovery already in progress.

## Automated verification

- Native firmware host suite: 7/7 tests passed.
- Native firmware ASan/UBSan suite: 7/7 tests passed.
- Firmware API capture validation: 31 captures passed.
- Protocol: 128 tests passed; typecheck and OpenAPI validation passed.
- Device simulator: 67 tests passed; typecheck passed.
- Mobile: 163 tests passed; typecheck and Expo lint passed.
- Source-format whitespace validation passed.

The exact final commands are rerun before handoff; counts above reflect the
implementation pass and are updated if that run changes them.

## Resource evidence

- `HistorySample`: 64 bytes.
- `HistoryPage` remains below its 2 KiB compile-time limit.
- `HistoryBuffer`: 38,472 bytes, below the 40 KiB compile-time limit.
- Serialized full current history page is asserted not to exceed 8 KiB in the
  firmware API host test.

## Deferred gates

- ESP-IDF 6.0.2 target compilation was not run because `idf.py` is unavailable
  in this workspace. No tools or dependencies were installed.
- Connected ESP32-C3 heap, stack, CPU timing, sensor-noise, prediction-accuracy,
  restart, and long-run passive checks remain Human acceptance work.
- No flashing, energized heater operation, active prediction correction, model
  fitting, coefficient tuning, or safety-authorization work was performed.

## Target transport observation

The owner measured firmware `0.3.0` advertising a 17,093-byte history response
but closing after 15,838 bytes and 4.93 seconds. Version `0.3.1` reduces producer
pages to eight samples, enforces an 8 KiB host-side response budget, yields
between mobile backfill pages, and logs failed ESP-IDF response sends. The
owner subsequently reported complete bounded responses on `0.3.1`, the
same boot ID across repeated 50-request stress runs, and gap-free one-minute
close/reopen recovery when using the stable 5 V supply. USB-powered graph gaps
did not reproduce on that supply and were treated as a power/setup observation.

Firmware `0.3.2` adds opt-in live prediction diagnostics so ordinary live rows
no longer depend on history backfill, plus gap-only recovery and stable graph
page identities. A fresh target/app check after flashing `0.3.2` remains
required; the earlier owner observations do not validate this new build.
