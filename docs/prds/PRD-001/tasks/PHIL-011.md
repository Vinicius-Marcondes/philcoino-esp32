# PHIL-011 — Implement temperature settings and mode control

Status: Todo
Review Mode: Human

## Human Review Needs

Approve whole-degree controls, explicit confirmation, brew/steam switch clarity, pending/error feedback, and steam timeout communication.

## Goal

Allow safe, acknowledged changes to persisted targets and active mode.

## Scope

- Edit brew 85–95°C and steam 110–120°C in whole degrees.
- Require explicit confirmation before sending target changes.
- Switch mode through `PUT /api/v1/mode`.
- Show pending, acknowledged, rejected, and disconnected outcomes.
- Prevent optimistic mode display before firmware acknowledgement.

## Non-Scope

- Remote pump/power/brew actions, arbitrary temperatures, or control-loop tuning.

## Implementation Plan

1. Build validated settings state and controls.
2. Add explicit confirmation and mutation handling.
3. Add acknowledged mode switching and timeout context.
4. Test failure/race cases and complete human review.

## Acceptance Criteria

- [ ] UI cannot submit values outside approved ranges.
- [ ] Firmware rejection remains authoritative and visible.
- [ ] Targets update only after explicit confirmation and response.
- [ ] Mode display changes only after acknowledgement.
- [ ] Disconnection during mutation produces no false success.

## Verification Strategy

Run component/interaction tests against simulator errors and delays; conduct physical-iPhone product review.

## Dependencies

PHIL-010.

## Files Expected To Change

Mobile settings/mode components, mutation state, API integration, and tests.
