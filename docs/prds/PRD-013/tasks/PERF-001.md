# PERF-001 — Capture unchanged-code baseline and add bounded diagnostics

Status: Software Complete — Target/Human Pending
Implementation Commit: `8fee5ab`
Review Mode: Human
Human Review Needs: Provide connected ESP32-C3 runtime and logic-analyzer
measurements that cannot be produced by host tests or a target build.

## Goal

Record every available unchanged-code performance baseline and add default-off,
fixed-allocation diagnostics that can repeat the same target scenarios after
the approved optimizations.

## Scope

- Capture current host behavior, tests, source configuration, and available
  build/toolchain evidence before production code changes.
- Define the exact repeatable idle, workflow, API/history, persistence, network,
  reset, and lease scenarios for PERF-012.
- Add bounded, compile-time/default-off counters for loop timing, workflow-mutex
  exposure, heap/stack, request latency, reset causes, and safety-lease trips.
- Keep reporting off hot paths and expose no public API.
- Separate host, target-build, connected-target, logic-analyzer, and Human
  evidence, leaving unavailable measurements explicitly pending.

## Non-Scope

- Optimizing runtime behavior, changing task priorities, changing the heater
  lease, adding public diagnostics, installing a toolchain, flashing hardware,
  energized testing, or claiming physical-safety validation.

## Implementation Plan

1. Archive every locally available unchanged-code baseline and toolchain gap.
2. Add a fixed-storage diagnostic owner with deterministic host coverage.
3. Wire only bounded observations into existing task, mutex, HTTP, boot, and
   task-side lease seams, guarded by a default-off build setting.
4. Document the exact target procedure and pending Human/connected gates.

## Acceptance Criteria

- [x] Every locally available unchanged-code baseline is recorded before later
  PERF implementation changes.
- [x] Diagnostics use bounded storage, allocate no hot-path memory, add no
  public endpoint, and default off.
- [x] The scenario matrix records exact build/config/run context and is
  repeatable in PERF-012.
- [x] Host software evidence passes; unavailable target and Human evidence is
  explicitly pending and is not inferred.
- [x] The 1,500 ms cache-safe heater lease and fail-off behavior are unchanged.

## Completion Evidence

- Captured every locally available unchanged-code baseline before firmware or
  mobile production edits in
  `docs/prds/PRD-013/evidence/PERF-001-BASELINE.md`.
- Added a default-off Kconfig diagnostic mode with a fixed atomic owner capped
  at 512 bytes, bounded histograms/counters, no persistence, no public API, no
  hot-path logging, and no ISR changes.
- Added task-side observations for loop timing, workflow-mutex wait/hold,
  scale outcomes, API latency/heap/HTTP stack, reset cause, resources, task
  stack high-water, and heater-lease trips.
- PASS — post-change strict native CMake build and CTest 7/7.
- PASS — post-change sanitizer-configured CTest 7/7.
- PASS — 32 firmware response captures validate against the strict protocol.
- The pinned ESP-IDF 6.0.2 toolchain is unavailable (`idf.py` absent and
  `IDF_PATH` unset), so target compilation, image/map/config evidence, and
  connected runtime evidence remain pending.
- Connected-target and logic-analyzer acceptance remains Human-gated. No
  energized work or physical-safety validation was performed or inferred.

## Verification Strategy

- Strict native and sanitizer firmware host suites.
- Firmware contract capture validation.
- Pinned ESP-IDF build/size/map checks only when the existing toolchain is
  available.
- Connected low-voltage runtime and logic-analyzer checks remain Human-gated.

## Dependencies

- PRD-013 approved and split.

## Files Expected To Change

- `firmware/espresso-machine/components/firmware_config/`
- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`
- `docs/prds/PRD-013/evidence/`
- `docs/TRACKER.md`
