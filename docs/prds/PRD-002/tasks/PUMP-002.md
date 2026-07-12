# PUMP-002 — Build the mobile extraction design preview

Status: Done
Review Mode: Human

## Goal

Build the extraction and profile-editing experience first in mobile debug mode so the owner can approve its design before backend and firmware integration.

## Scope

- Preserve the dashboard's current visual language, navigation, typography, spacing, feedback, accessibility, and responsive behavior.
- Present Manual plus four slots, seed `Classic30` and `Pre5Soak5`, and provide profile editing with inline validation.
- Present sync status, export affordance, selection, Start/Stop controls, phase/timing, and `running`/`off` command state.
- Use injected deterministic debug state and actions conforming to the API v2 types without issuing real pump requests.
- Make debug-preview labeling explicit so mock state cannot be mistaken for acknowledged device state.

## Non-Scope

- Network calls, durable profile storage, simulator behavior, firmware, or mains/pump activation.

## Implementation Plan

1. Add pure extraction view models and deterministic debug scenarios.
2. Add profile selection/editor and sync/export presentation.
3. Add extraction controls and active-phase presentation to the existing dashboard composition.
4. Add accessibility, layout, and interaction tests, then prepare the debug build for owner review.

## Acceptance Criteria

- [x] The preview shows all required profile, sync, Start/Stop, phase, timing, and command states.
- [x] Names and timing inputs provide clear bounded feedback without showing drafts as machine state.
- [x] Manual and custom selection include responsive wrapping and explicit screen-reader roles/labels; Human large-text/VoiceOver review remains required below.
- [x] Mock/debug state is unmistakably labeled and cannot call the device API.
- [x] Mobile tests, lint, typecheck, Expo config inspection, and web export pass.
- [x] Vinicius explicitly approved the refined visual design and interaction flow on 2026-07-12 before PUMP-003 started.

## Verification Strategy

- Automated component/view-model tests plus debug-mode manual navigation at standard and large text sizes.
- Human review of hierarchy, copy, editing, synchronization feedback, and active extraction controls.

## Dependencies

- PUMP-001.

## Files Expected To Change

- `apps/mobile/components/`
- `apps/mobile/src/dashboard/`
- `apps/mobile/src/debug/`
- `apps/mobile/test/`

## Human Review Needs

- Approve the profile editor, selection hierarchy, sync warning/export flow, Start/Stop prominence, phase/timer presentation, and accessibility using a debug build.

## Stop Conditions

- Stop after presenting the debug-mode design; do not begin simulator, networking, or firmware integration without explicit owner approval.

## Implementation Record

### Changed behavior

- Debug mode now renders a three-page bottom-navigation preview; non-debug dashboards are unchanged.
- **Dashboard** keeps current machine/temperature state and compact extraction selection, Start/Stop, phase, timer, and GPIO10 command controls together.
- **Profiles** contains the four custom slot selectors, local editor, synchronization status, and whole-set mock export.
- **Machine** contains temperature targets, Brew/Steam mode, heater permission, saved-device details, and Forget machine.
- A persistent active-extraction bar appears above bottom navigation on every page and links back to Dashboard controls.
- The preview presents Manual plus four stable custom slots, seeded `Classic30` and `Pre5Soak5`, two empty slots, local editing with inline validation, mobile/machine mock sync, whole-set mock export, and custom Start blocking while unsynchronized.
- Distinct Start and Stop controls drive deterministic API-v2-valid Manual, pre-infusion, soak, main-extraction, completion, and cutoff preview states.
- The UI displays phase, elapsed/remaining time, and `running`/`off` as the GPIO10 command only, with explicit copy excluding confirmed pump operation or physical de-energization.

### Decisions made

- The preview is a standalone component with an injected initial state and pure transition model under `src/debug`; neither real nor debug device API clients gained extraction methods.
- Local editor drafts are validated before they replace the mobile preview profile. The machine preview set changes only after mock whole-set export.
- Profile selection/editing/export are disabled while the preview extraction is active; Manual remains startable when custom profiles are unsynchronized.
- Deterministic **Advance preview phase** exposes every active phase for review without clocks, background work, simulator routes, or firmware behavior.
- Configuration is moved to a dedicated Profiles page instead of hiding Start/Stop or active extraction state in a dropdown.
- English and Brazilian Portuguese preview copy is centralized with the existing localization source.

### Safety and compatibility impact

- No HTTP pump requests, simulator behavior, firmware code, GPIO, persistence, or mains behavior was added.
- Mock state is headed `DEBUG DESIGN PREVIEW` and states that no pump/device requests are sent.
- API v1 runtime behavior and the existing dashboard acknowledgement flow are unchanged.
- `running`/`off` wording remains limited to the firmware GPIO10 command contract and is never presented as physical feedback.

### Verification evidence

- PASS — `bun run --cwd apps/mobile test` (69 tests, 217 expectations).
- PASS — `bun run typecheck`.
- PASS — `bun run lint` (zero warnings/errors).
- PASS — `bun run --cwd apps/mobile expo config --type public` (SDK 54.0.0 config resolved).
- PASS — `EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run --cwd apps/mobile expo export --platform web --output-dir /tmp/philcoino-pump002-refined-web` (refined web bundle and three static routes exported).
- PASS — `bun run validate:openapi`.
- PASS — `bun run test:protocol` (69 tests, 143 expectations).
- PASS — `bun run typecheck:protocol`.
- PASS — `bun run typecheck:simulator` and `bun run test:simulator` (25 tests, 115 expectations).

### Checks not run

- No physical iPhone/Android, VoiceOver/TalkBack, or OS Dynamic Type review was run. These are part of the pending Human design gate.
- No simulator/firmware API v2, firmware target build, GPIO, low-voltage, or energized check applies to this UI-only preview task.

### Remaining blockers or human acceptance

- Vinicius requested and received a three-page refinement after the initial review, then explicitly approved the revised Dashboard/Profiles/Machine hierarchy on 2026-07-12.
- Review command: `EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run start`; select `Philcoino debug`, enter `debug-token`, and inspect the extraction preview on the dashboard.
