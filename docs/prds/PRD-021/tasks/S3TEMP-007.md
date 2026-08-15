# S3TEMP-007 — Verify and document the S3 dual-sensor system

Status: Awaiting Human Review
Review Mode: Human

## Goal
Align durable documentation, complete automated verification, and define the disconnected physical acceptance boundary.

## Scope
- Update architecture, development, safety, protocol, wiring, tuning, side notes, public docs, and review claims.
- Run the full affected verification matrix and audit every PRD criterion.
- Prepare disconnected low-voltage Human checks.

## Non-Scope
- Flashing approval, energized mains testing, thermal tuning, or certification.

## Implementation Plan
1. Align all current-behavior and safety documentation.
2. Run protocol, workspace, host, sanitizer, and pinned S3 checks.
3. Record software evidence and deferred Human gates without extending historical acceptance.

## Acceptance Criteria
- [x] Documentation and source agree on target, pins, API, sensor ownership, histories, and compatibility.
- [x] All configured automated checks for affected areas pass or have a concrete recorded blocker.
- [x] Historical C3/single-sensor evidence is explicitly excluded from the new hardware configuration.
- [ ] Human review remains pending for exact board exposure, probe isolation/stability, boot behavior, USB recovery, waveforms, and dimmer timing.

## Verification Strategy
- Execute the repository verification matrix and inspect the final requirement-by-requirement diff.

## Dependencies
- S3TEMP-001 through S3TEMP-006.

## Files Expected To Change
- `docs/`
- `README.md`
- `CONTRIBUTING.md`
- `CODEBASE_REVIEW_REPORT.md`

## Human Review Needs
- With mains loads disconnected, confirm exact header pins, ungrounded probes,
  simultaneous stable readings, reset/boot levels, native USB recovery,
  MAX6675 waveforms, zero-cross input, and dimmer 0%/90% timing.
