# PERF-009 — Validate interrupt safety and GPIO timing

Status: Software Complete — Target/Human Pending
Implementation Commit: `c7f5791`
Review Mode: Human
Human Review Needs: Inspect target map/placement and capture HX711 and heater
GPIO timing with a logic analyzer on a disconnected low-voltage setup.

## Goal

Validate the HX711 data-ready notifier, heater safety lease, and HX711 clock
pulses under representative target load without weakening either ISR.

## Scope

- Audit ISR call graphs, cache placement, allocation, logging, and critical
  sections.
- Run target build/map checks when the pinned toolchain is available.
- Record low-voltage logic-analyzer timing for GPIO0/GPIO1/GPIO20.
- Verify lease trips at or before 1,500 ms under flash/API load.

## Non-Scope

- Energized mains work, changing the lease, controller work in ISR, priority
  tuning, or physical-safety certification.

## Implementation Plan

1. Complete source/map audit for both application ISRs.
2. Exercise notifier and lease paths under representative target load.
3. Capture and review logic-analyzer evidence.
4. Record unavailable target/Human gates without inference.

## Acceptance Criteria

- [ ] Both ISRs remain minimal, allocation-free, logging-free, and cache-safe.
  Source/configuration audit passes; target map and cache-suspension evidence
  remain pending.
- [x] No broad interrupt-disabled region is introduced.
- [ ] HX711 clock and ready timing meet the device policy on target.
- [ ] Heater lease commands GPIO low at or before 1,500 ms in the tested build.
- [x] Human acceptance remains separate from energized or mains-safety claims.

## Evidence

- `../evidence/PERF-009-INTERRUPT-AUDIT.md`

## Verification Strategy

- Source/map audit, target build, connected low-voltage stress, and Human
  logic-analyzer review.

## Dependencies

- PERF-005 and PERF-008 complete.

## Files Expected To Change

- `docs/prds/PRD-013/evidence/`
- `docs/TRACKER.md`
- focused firmware tests or diagnostics only if a validation gap is found
