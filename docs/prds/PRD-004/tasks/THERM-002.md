# THERM-002 — Approve the mobile thermal-workflow design

Status: Todo
Review Mode: Human

## Goal

Build and approve the Dashboard experience for Steam-blocked extraction, acknowledged compensation, and confirmed cooldown before production integration.

## Scope

- Add deterministic debug states for inactive/active compensation and Steam-blocked Start.
- Add the `Cooldown machine` confirmation with temperature, Brew target, water-use warning, 45-second limit, and command-state boundary.
- Present pumping, prominent Stop, stabilization, target-reached, cutoff, rejection, failure, and disconnected states.
- Preserve the app's current visual language, localization, accessibility, responsive layout, and debug labeling.

## Non-Scope

- Real network requests, simulator behavior, firmware, GPIO, or physical cooling.

## Implementation Plan

1. Extend pure debug/view-model states using THERM-001 types.
2. Add the confirmation, active workflow, Stop, stabilization, and conflict presentation.
3. Add interaction/accessibility tests and prepare the debug build.
4. Iterate only within PRD-004 until Vinicius explicitly approves the design.

## Acceptance Criteria

- [ ] Steam-blocked extraction gives actionable Brew guidance without silently changing mode.
- [ ] Confirmation explains the threshold, pump limit, water use, and missing physical flow feedback.
- [ ] Stop is prominent during pumping; stabilization clearly shows pump off and heater inhibited.
- [ ] Debug state cannot call a device and cannot be mistaken for acknowledged live state.
- [ ] Mobile tests, lint, typecheck, Expo config inspection, and debug web export pass.
- [ ] Vinicius explicitly approves hierarchy, copy, interactions, large-text behavior, and accessibility before THERM-003 begins.

## Verification Strategy

- Automated view-model/component tests plus human review at standard and large text sizes with screen-reader semantics inspected.

## Dependencies

- THERM-001.

## Files Expected To Change

- `apps/mobile/components/`
- `apps/mobile/src/debug/`
- `apps/mobile/src/dashboard/`
- `apps/mobile/src/localization/`
- `apps/mobile/test/`

## Human Review Needs

- Approve Dashboard placement, confirmation clarity, Stop prominence, phase/outcome wording, and non-color-only feedback.

## Stop Conditions

- Stop after presenting the debug design; do not begin production integration without explicit approval.
