# FWAPI-007 — Complete target/resource evidence and documentation

Status: Blocked — connected-target and per-stage resource evidence pending
Review Mode: Agent
Review Reason: Final compatibility, resource budgets, build output, documentation alignment, and review closure are evidence-based and deterministic.

## Goal

Prove final PRD-005 compatibility within approved resource budgets and align all owner/evidence documentation.

## Scope

- Run final strict host, sanitizer/mutation, capture, protocol, and pinned ESP32-C3 checks.
- Compare every recorded extraction stage with the approved image/RAM/heap/stack budgets.
- Document any target runtime heap/stack evidence that cannot be produced without connected hardware as a remaining Human/target check.
- Update architecture, firmware/development guidance, protocol outlines, FW-013 review status, PRD acceptance, and tracker evidence.
- Preserve FW-005 and physical safety blockers.

## Non-Scope

- FW-005 implementation, physical heater/pump validation, wiring changes, energized testing, or unrelated review remediation.

## Implementation Plan

1. Execute the complete verification matrix from a clean build location.
2. Consolidate per-stage target resource comparisons and enforce budgets.
3. Align documentation with final module ownership and commands.
4. Record exact checks, unavailable evidence, remaining blockers, and FW-013 closure status.

## Acceptance Criteria

- [x] All configured host, contract, sanitizer/mutation, and pinned target-build checks pass.
- [ ] Image, static RAM, and available heap/stack evidence satisfy approved budgets or an explicit reviewed exception exists.
- [x] API v1/v2 behavior and firmware safety/authority boundaries remain unchanged.
- [x] Architecture, development, protocol, review, PRD, and tracker documents agree on final ownership and evidence limits.
- [x] FW-005 and unavailable physical/target-runtime checks remain visible and are not represented as complete.

Blocked Reason: No connected ESP32-C3 is available for request heap and HTTP
stack high-water measurements, and per-extraction target snapshots were not
preserved. See `../evidence/IMPLEMENTATION.md`.

## Verification Strategy

- Run the full repository checks relevant to firmware/protocol plus clean ESP-IDF build/size reports and documentation consistency review.

## Dependencies

- FWAPI-006 complete.

## Files Expected To Change

- `docs/ARCHITECTURE.md`
- `docs/DEVELOPMENT.md`
- `docs/protocol/`
- `docs/reviews/FIRMWARE_CODE_REVIEW.md`
- `docs/prds/PRD-005/`
- `docs/TRACKER.md`
- `firmware/espresso-machine/README.md`
