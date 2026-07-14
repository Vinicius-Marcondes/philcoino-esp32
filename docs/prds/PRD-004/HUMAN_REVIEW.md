# PRD-004 Human Review Ledger

Status: Review Deferred

This document collects every PRD-004 item that still requires Vinicius's
review. On 2026-07-14, Vinicius explicitly authorized the supervised software
workflow to continue while these reviews are deferred. Deferred review is not
approval, physical evidence, or authorization for disconnected or energized
work.

## THERM-002 — Mobile thermal-workflow design

Software implementation and automated/web review are complete in commit
`9933bd0`. Review the debug-only Dashboard surface and record approval or
requested in-scope revisions for all of the following:

- [ ] Dashboard placement between the acknowledged machine snapshot and the
  extraction preview.
- [ ] Confirmation hierarchy and wording: current acknowledged temperature,
  snapshotted Brew target, possible water use, 45-second pump-command limit,
  missing physical feedback, and command-only boundary.
- [ ] Prominence and wording of Stop while pumping.
- [ ] Pump-off/heater-inhibited stabilization wording and the target-reached,
  cutoff, stopped, rejection, failure, and disconnected outcomes.
- [ ] Steam-blocked guidance, including the explicit navigation to Machine
  controls and absence of a silent mode change.
- [ ] Non-color-only status communication and English/Brazilian Portuguese
  copy.
- [ ] Large Dynamic Type behavior on native iOS and Android.
- [ ] VoiceOver/TalkBack reading order, roles, checked state, live regions, and
  action labels.

Evidence already available:

- 89 mobile tests / 286 expectations, typecheck, Expo lint, Expo SDK 54 config,
  and debug web export passed.
- Interactive `390×844` web QA covered confirmation, pumping/Stop,
  stabilization, Steam navigation, failure presentation, semantic roles,
  wrapping, and horizontal overflow.
- Native screen readers and OS-level Dynamic Type were not run and remain part
  of this review.

Decision: Pending.

## THERM-010 — Disconnected low-voltage and visual acceptance

The exact checklist will be added here after THERM-009 software evidence is
complete. It will remain unperformed until Vinicius supplies Human evidence.
No GPIO command will be represented as confirmed pump operation, water flow,
cooling, current, SSR state, switch state, or physical de-energization.

Decision and evidence: Pending.

## THERM-011 — Energized and instrumented validation

No procedure is authorized. No energized instruction or work may begin from
this document. After the software and THERM-010 evidence are reviewed, a
separate explicit authorization must identify the exact procedure, build,
hardware setup, instruments/calibration records, supervision, and stop
conditions before any energized work can be considered.

Authorization and evidence: Pending.
