# THERM-002 — Approve the mobile thermal-workflow design

Status: Done — Human Accepted 2026-07-16
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

- [x] Steam-blocked extraction gives actionable Brew guidance without silently changing mode.
- [x] Confirmation explains the threshold, pump limit, water use, and missing physical flow feedback.
- [x] Stop is prominent during pumping; stabilization clearly shows pump off and heater inhibited.
- [x] Debug state cannot call a device and cannot be mistaken for acknowledged live state.
- [x] Mobile tests, lint, typecheck, Expo config inspection, and debug web export pass.
- [x] Vinicius explicitly approved hierarchy, copy, interactions, large-text behavior, and accessibility on 2026-07-16.

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

## Human-gate Evidence

### Changed behavior

- Explicit debug mode now places a `DEBUG THERMAL WORKFLOW` review surface on
  the Dashboard between the acknowledged machine snapshot and the existing
  extraction preview. Non-debug Dashboard behavior is unchanged.
- Deterministic local states cover inactive/Manual compensation,
  Steam-blocked extraction, confirmation, pumping, Stop, five-second
  stabilization, target-reached, 45-second cutoff, retained terminal outcome,
  ineligible rejection, firmware failure, and disconnected presentation.
- Confirmation shows the acknowledged `104.3°C` example, snapshotted `93°C`
  Brew threshold, water-path warning, 45-second pump-command limit, missing
  feedback, and command-only boundary before the local preview can enter
  pumping.
- Steam-blocked guidance requires an explicit trip to Machine controls; it does
  not change mode. Pumping makes Stop the primary destructive action, while
  stabilization shows pump command off and heating still inhibited.
- English and Brazilian Portuguese copy, live regions, alert/radio/button
  semantics, selectable values, wrapping layouts, and unconstrained text lines
  were added for the review states.

### Decisions

- The preview is a pure THERM-001-schema state machine with no API client,
  `fetch`, simulator endpoint, or mutation session. Its persistent banner says
  that no device, heater, or pump request is sent.
- Compensation is presented as active/inactive acknowledged state and never
  changes the displayed Brew target. The fixed bias value is not exposed as a
  setting or duplicated into profile data.
- GPIO `running`/`off`, heater inhibition, and workflow timing are labeled as
  command/control state only. No copy represents flow, cooling, current, SSR
  output, switch position, or physical de-energization as confirmed.
- Existing mobile-to-simulator extraction tests used a named test-only
  pre-THERM-003 state envelope sourced from the simulator's public model. This
  avoided implementing simulator behavior before the design gate; THERM-003
  removed the adapter after the simulator began serving the authoritative
  fields directly.

### Compatibility and safety impact

- API v1, production `DeviceApiClient`, polling/mutation sessions, simulator,
  firmware, GPIO, persistence, and physical behavior are unchanged.
- The debug client now supplies strict inactive compensation and idle cooldown
  fields so its API v2 snapshot remains compatible with the THERM-001 contract.
- The design preserves firmware authority, acknowledged-state language,
  heater-permission independence, Brew-only extraction guidance, workflow
  mutual exclusion, and the absence of physical output feedback.
- No finding in `CODEBASE_REVIEW_REPORT.md` is closed, and the preview is not
  physical heater/pump safety evidence.

### Verification evidence

- `bun test apps/mobile/test` — passed: 89 tests, 286 expectations, including
  all deterministic thermal scenarios, strict protocol parsing, localization
  parity, source-level local-only/accessibility guards, and prior mobile flows.
- `bun run --cwd apps/mobile typecheck` — passed with `tsc --noEmit`.
- `bun run --cwd apps/mobile lint` — passed with Expo lint.
- `bun run --cwd apps/mobile expo config --type public --json` — passed and
  reported Expo SDK `54.0.0`, the expected platforms, localizations, and
  project configuration.
- `EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run --cwd apps/mobile expo export
  --platform web --output-dir /private/tmp/philcoino-therm-002-web-20260714` —
  passed; three static routes and the web bundle exported outside the worktree.
- Interactive visual QA at a `390×844` viewport verified confirmation,
  pumping/Stop, stabilization, Steam-blocked navigation, failure presentation,
  radio/button/alert semantics, wrapping, and absence of horizontal overflow.

### Checks not run

- Native iOS/Android rendering, platform screen readers, and OS-level large
  dynamic-type settings were not run. Those are part of the pending Human
  acceptance and cannot be completed by the web/source checks alone.
- No real cooldown request, simulator thermal behavior, firmware behavior,
  host/target firmware build, GPIO check, low-voltage check, or physical or
  energized procedure was run because all are outside THERM-002.
- No package, program, CLI, SDK, or dependency was installed.

### Remaining blockers and human acceptance

- Final THERM-002 acceptance was completed by Vinicius on 2026-07-16 after he
  reported that all implemented features worked as expected; no in-scope
  revision was requested.
- On 2026-07-14, Vinicius explicitly authorized the supervised software
  workflow to continue while all Human-review items are collected in
  `docs/prds/PRD-004/HUMAN_REVIEW.md`. This authorization advances THERM-003
  without representing the design as Human-approved at that time. This was
  superseded by the explicit 2026-07-16 Human acceptance.

### 2026-07-15 requested hierarchy revision

- Vinicius requested an in-scope layout revision without approving the pending
  Human gate. The full-width online connection card was replaced by a compact,
  non-color-only connection status beside the page eyebrow.
- Dashboard now reads Machine status, Boiler temperature, Temperature graph,
  Extraction, Compensation, then Cooldown machine. Machine uptime and Steam
  timer moved to the Machine tab.
- Dashboard profile selection is collapsed into an accessible dropdown inside
  Extraction. Profiles now reads Profile sync, Profile configuration, then
  Local profile editor. Machine now reads Active mode, Temperature targets,
  Heater permission, Machine uptime, Steam timer, then Saved machine.
- Extraction keeps Phase, Elapsed, and Remaining in a balanced responsive row;
  the GPIO10 command metric is omitted while explicit copy still states that
  extraction state is not physical pump feedback.
- Dashboard, Profiles, and Machine now retain independent in-memory scroll
  offsets while the Dashboard screen remains mounted.
- The tab bar already occupies sibling layout space, so the former 210-point
  navigation allowance was removed from scroll content. Each tab now ends with
  only 24 points of normal spacing after its final component.
- Bottom navigation retains 44-point controls and the same total inset-aware
  height, but distributes vertical padding evenly above and below the row so
  tabs are visually centered.
- Combined revision verification passed: 98 mobile tests / 698 expectations,
  mobile typecheck, Expo lint, Expo SDK 54 public config resolution, `git diff
  --check`, and a debug web export with three static routes. Native visual,
  Dynamic Type, VoiceOver, and TalkBack acceptance remain deferred in the Human
  Review Ledger.
