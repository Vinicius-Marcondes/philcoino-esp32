# HIST-006 — Complete cross-layer evidence and documentation

Status: Done
Review Mode: Agent
Review Reason: Cross-layer compatibility, configured checks, resource evidence, and documentation agreement are evidence-based.

## Goal

Verify the complete implementation and align all technical and public documentation.

## Scope

- Run affected protocol, simulator, mobile, firmware host/sanitizer/capture, and target checks.
- Record image/static RAM and available heap/stack/timing evidence.
- Update architecture, protocol outline, development, safety, side notes, and PRD evidence.
- Preserve unresolved physical/security findings and evidence boundaries.

## Non-Scope

- Human iPhone acceptance, energized testing, or unrelated remediation.

## Implementation Plan

1. Run the complete cross-layer verification matrix.
2. Resolve regressions within PRD-007 scope and record unavailable checks.
3. Align documentation and implementation evidence.

## Acceptance Criteria

- [x] All configured affected checks pass or have explicit documented blockers.
- [x] API compatibility, RAM/page budgets, and non-blocking safety boundaries are evidenced.
- [x] Documentation describes implemented behavior and remaining limitations accurately.
- [x] No software evidence is represented as physical validation.

## Completion Evidence

- OpenAPI validation, protocol/simulator/mobile typechecks, all affected Bun
  tests, and mobile lint pass.
- Native and ASan/UBSan firmware CTest pass 6/6; all 30 independent firmware
  response captures validate against the protocol package.
- `HistorySample` is statically fixed at 16 bytes, so 600 retained payloads use
  9,600 bytes; `HistoryBuffer` is compile-time bounded to at most 12 KiB and a
  copied page contains at most 60 samples.
- Existing API v1 and v2 response schemas remain unchanged; history is one
  additive protected endpoint with its own zero-wait firmware guard.
- Architecture, protocol, development, safety, public README, firmware README,
  tracker, and side-note evidence are aligned.
- `idf.py` is unavailable in this workspace. Pinned ESP32-C3 build/image data
  and connected-target heap, stack, network latency, and control-loop timing
  remain explicit HIST-007 gates; no host result is presented as target or
  physical validation.

## Verification Strategy

- Execute root/workspace verification plus independent firmware host and pinned target workflows.

## Dependencies

- HIST-005 complete.

## Files Expected To Change

- `docs/`
- `README.md`
- `firmware/espresso-machine/README.md`
- PRD-007 evidence and tracker state
