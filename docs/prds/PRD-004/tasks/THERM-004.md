# THERM-004 — Integrate mobile cooldown and compensation state

Status: Done
Review Mode: Agent
Review Reason: Strict parsing, acknowledged mutations, retry identity, polling races, and simulator integration are deterministic and testable after visual approval.

## Goal

Connect the approved mobile experience to API v2 while preserving acknowledged-state and cancellation guarantees.

## Scope

- Add strict cooldown API client operations and combined-state parsing.
- Extend serialized dashboard mutations for cooldown Start/Stop and workflow conflicts.
- Reuse a Start idempotency key after an unacknowledged transport outcome.
- Show compensation and cooldown only from validated acknowledgements.
- Disable conflicting extraction/profile/Steam actions with approved guidance.
- Integrate against deterministic simulator scenarios, localization, and accessibility behavior.

## Non-Scope

- Firmware implementation, changing the approved design without review, or physical-state claims.

## Implementation Plan

1. Extend the injected API client and strict error taxonomy.
2. Add cooldown mutations to the existing serialized polling/mutation session.
3. Connect acknowledged state to the THERM-002 presentation.
4. Add race, retry, rejection, disconnect, and simulator integration tests.

## Acceptance Criteria

- [x] Requested cooldown/compensation values never appear as live state before acknowledgement.
- [x] Start retry preserves its key and firmware deadline; Stop is idempotent.
- [x] Polling never overlaps or overwrites acknowledgements, and disconnect clears unavailable live state.
- [x] Steam/conflict/fault/cutoff outcomes remain distinguishable and actionable.
- [x] Mobile tests, lint, typecheck, Expo config, web export, and simulator integration pass.

## Verification Strategy

- Unit-test the client and mutation session; run mobile-to-simulator scenarios for Start, replay, Stop, threshold, cutoff, stabilization, failure, and reconnect.

## Dependencies

- THERM-003.

## Files Expected To Change

- `apps/mobile/src/networking/`
- `apps/mobile/src/dashboard/`
- `apps/mobile/hooks/`
- `apps/mobile/components/`
- `apps/mobile/src/localization/`
- `apps/mobile/test/`

## Completion Evidence

### Changed behavior

- The production client now validates cooldown Start requests, strict Start/Stop
  acknowledgements, combined API v2 state, and active-cooldown conflict bodies.
  Unknown response fields remain protocol errors.
- Cooldown Start/Stop share the existing serialized mutation owner with profile,
  extraction, target, mode, heater, and fault mutations. Polling pauses while a
  mutation is in flight and resumes only after its outcome; a disconnect clears
  machine, extraction, compensation, and cooldown live state.
- Cooldown Start retains one idempotency key across timeout/offline/protocol
  outcomes where acknowledgement is unknown. A validated firmware rejection
  clears that key for the next intentional attempt; acknowledgement and Stop
  clear it after the device outcome is known.
- The non-debug Dashboard now renders compensation, cooldown confirmation,
  command-state timing, Stop, stabilization, terminal outcome, rejection, and
  fault guidance from validated acknowledgements. The existing debug scenario
  controls remain local-only and do not drive the production state.
- Active cooldown/stabilization disables extraction Start and profile export;
  Steam is disabled during extraction/cooldown or their pending Start. Steam
  blocks extraction Start with explicit guidance. Local profile editing remains
  local and available because it does not mutate firmware state.
- English and Brazilian Portuguese copy distinguishes pending,
  acknowledged, rejected, disconnected, target-reached, cutoff, stopped, and
  failed outcomes. Buttons expose disabled accessibility state, live regions
  remain non-color-only, and flexible wrapping is preserved.

### Decisions

- A valid active cooldown acknowledgement also applies the contract-mandated
  Brew mode, heater-off command, and inactive compensation to the current
  acknowledged mobile snapshot before polling resumes. This avoids presenting
  an impossible cross-field combination while still waiting for device
  acknowledgement before any change is shown.
- Start identity is retained only when the outcome may have reached firmware.
  Strict HTTP/invalid-request rejections are definitive and therefore receive a
  new key on a later attempt; transport, timeout, cancellation, authorization,
  and protocol outcomes retain the original key for safe replay.
- Production rendering consumes the same THERM-002 presentation components,
  but preview-only phase/cutoff controls and the debug warning banner remain
  unavailable outside explicit debug mode.
- UI conflict disabling is convenience and guidance only. Firmware remains
  authoritative for Brew eligibility, target/sensor/fault checks, mutual
  exclusion, timing, commands, and reset behavior.

### Compatibility and safety impact

- API v1 is unchanged. The mobile additions consume only the additive strict
  API v2 contract and preserve existing request timeout, cancellation,
  normalization, pairing, storage, polling, and acknowledgement boundaries.
- Persisted/displayed targets and profile data are not changed by compensation.
  Cooldown state does not overwrite the user's heater permission.
- `running`, `off`, and `inhibited` remain acknowledged command/policy state;
  the UI does not claim pump flow, water movement, cooling, current, SSR state,
  switch position, or physical de-energization.
- No firmware, GPIO, physical setup, energized procedure, dependency, or
  generated native project changed. Simulator and web evidence is not physical
  heater/pump safety evidence and closes no review finding.

### Verification evidence

- `npm run typecheck --workspace @philcoino/mobile` — passed.
- `npm test --workspace @philcoino/mobile` — passed: 96 tests / 326
  expectations. Coverage includes strict cooldown responses/conflicts,
  acknowledgement-only publication, serialized polling, retry identity,
  rejection key replacement, idempotent Stop, debug client behavior,
  localization parity, accessibility source boundaries, and disconnect
  clearing.
- The mobile-to-simulator test passed Start, same-key replay without deadline
  restart, a new client reading active state after reconnect, Stop, target
  threshold, exact 45-second cutoff, exact five-second stabilization, retained
  terminal outcomes, and sensor-failure state.
- `npm run lint --workspace @philcoino/mobile` — passed.
- `bun run --cwd apps/mobile expo config --type public` — passed and reported
  Expo SDK `54.0.0` with iOS, Android, and web platforms.
- `bun run --cwd apps/mobile expo export --platform web --output-dir
  /private/tmp/philcoino-prd004-therm004-web` — passed; three static routes and
  one web bundle were exported outside the repository.

### Checks not run

- Native iOS/Android rendering, Dynamic Type, VoiceOver, and TalkBack were not
  run during this Agent task. Their Human scope was later accepted by the owner
  on 2026-07-16 in `docs/prds/PRD-004/HUMAN_REVIEW.md`.
- Firmware host tests, captures, and target build were not run because
  THERM-004 changes only mobile code and consumes the already-verified
  simulator contract. They begin in THERM-005 and later tasks.
- No disconnected low-voltage or energized work was performed. No package,
  program, CLI, SDK, or dependency was installed.

### Remaining blockers and human acceptance

- No Agent blocker remains for THERM-004.
- At this task's completion, THERM-002/010/011 were still separate Human gates.
  The owner later accepted all three on 2026-07-16 for the tested configuration.
