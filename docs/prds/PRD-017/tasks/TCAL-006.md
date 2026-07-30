# TCAL-006 — Build the guided calibration screen

Status: Done
Review Mode: Human
Human Review Needs: The owner approved the revised responsive UI. Dedicated
native iOS/Android, maximum-text-size, and assistive-technology passes remain
unexecuted and are not inferred from that visual approval.

## Goal

Add the focused Machine-page calibration experience using the acknowledged
mobile session bridge without implying automatic steam detection or physical
temperature certainty.

## Scope

- Add a Temperature Calibration entry on Machine and open a focused full-screen
  calibration surface consistent with the extraction-console navigation pattern.
- Show candidate raw target, raw temperature, effective preview, offset preview,
  heater command, readiness, advisory stable time, safe bounds, and connection/
  mutation state.
- Provide accessible `−`/`+` whole-degree controls within acknowledged
  `90–120°C` bounds.
- Explain that the user decides stability, opens the steam wand manually, and
  adjusts until satisfied.
- Require explicit review/confirmation before Save and provide clear Cancel,
  expiry, conflict, unsafe-target, persistence, sensor, and disconnection states.
- Localize English and Portuguese copy and support larger text, portrait, and
  mounted-landscape layouts.
- Use only the calibration session bridge; do not command the pump or valve and
  do not add direct API calls.

## Non-Scope

- Firmware, protocol, simulator, automatic steam detection, pump/valve control,
  UI redesign outside Machine/calibration, or energized testing.

## Implementation Plan

1. Add the Machine entry and focused-screen navigation state.
2. Build pure presentation helpers and the calibration surface.
3. Connect acknowledged session actions and lifecycle cancellation.
4. Add localization, accessibility, and responsive-layout behavior.
5. Add component/model tests, then complete native Human review.

## Acceptance Criteria

- [x] Machine opens the focused calibration screen without changing the primary
  dashboard navigation order.
- [x] The screen presents all required raw/effective, candidate, offset,
  readiness, stability, safe-bound, and mutation states.
- [x] Controls stay within acknowledged bounds and Save requires explicit
  confirmation.
- [x] Copy clearly requires manual steam-wand operation and makes no automatic
  steam, calibrated-accuracy, or heater-de-energization claim.
- [x] Navigation/background cancellation and all failure states are visible and
  cannot appear as saved success.
- [x] Automated mobile checks pass and the owner accepts the revised portrait/
  landscape UI, instructions, and Save-confirmation flow.

## Verification Strategy

- Add pure view-model/component tests for every session and error state.
- Run mobile tests, typecheck, and lint.
- Perform Human native navigation, layout, accessibility, and safety-copy review.

## Software Evidence

- `bun test apps/mobile/test` — 252 tests, 2,438 expectations passed.
- `bun run --filter @philcoino/mobile typecheck` — passed.
- `bun run --filter @philcoino/mobile lint` — passed.
- Focused calibration screen/session/debug-client checks — 24 tests, 107
  expectations passed.
- Native preflight environment audit — an existing iOS 26.4 simulator boots,
  but Expo Go is not installed; Android `adb` is unavailable. No package, app,
  SDK, generated native project, or dependency was installed or created, so
  native visual acceptance remains Human-owned and pending.
- Initial Human review accepted the general UI but found that the full-screen
  calibration modal stayed portrait-only and that its narrow landscape columns
  overflowed. The revision explicitly permits both landscape directions,
  derives layout from the modal's own live window dimensions, removes landscape
  column minimum-width overflow, and uses compact candidate, instruction,
  metric, bounds, and action styles.
- A completion audit found and fixed retained local confirmation state: hiding
  the mounted modal now clears both Save review and deferred-close state, so a
  reopened session must enter a fresh confirmation flow.
- A later Machine-page refinement moves the heater-permission switch above all
  Machine controls. In landscape, the control area now uses the full viewport:
  Mode and Targets wrap on the first row and Calibration uses a full-width
  second row instead of extending beyond the right edge.

## Human Review Checklist

- [ ] On native iOS, open Machine → Temperature Calibration and confirm the
  full-screen presentation, hardware-back/close behavior, and return to Machine.
- [ ] Repeat the same navigation and close behavior on native Android.
- [ ] Review English and Brazilian Portuguese safety copy, especially manual
  steam-wand operation, advisory-only stability, no automatic steam detection,
  and the explicit Save confirmation.
- [ ] Verify ordinary and maximum supported text sizes without clipped controls
  or hidden raw/effective, heater, readiness, safe-bound, lease, and error state.
- [x] Recheck portrait and both mounted-landscape orientations after the
  landscape revision, including
  scrolling, safe areas, `−`/`+` hit targets, and screen-reader labels/order.
- [ ] Confirm that Cancel, navigation away, backgrounding, disconnection,
  expiry, conflict, unsafe-target, sensor, and persistence errors never look
  saved.

Software evidence does not satisfy this Human review and does not authorize
energized calibration.

Human approval: 2026-07-30. The owner approved the revised UI after the modal
orientation and compact landscape changes. This approval is visual/navigation
acceptance only and does not authorize energized calibration.

## Dependencies

- TCAL-005 complete.

## Files Expected To Change

- `apps/mobile/components/`
- `apps/mobile/components/dashboard-screen.tsx`
- `apps/mobile/components/machine-controls.tsx`
- `apps/mobile/src/localization/`
- `apps/mobile/src/layout/`
- `apps/mobile/test/`
- `docs/TRACKER.md`
