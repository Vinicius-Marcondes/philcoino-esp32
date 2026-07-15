# PRD-004 Human Review Ledger

Status: Review Deferred

This document collects every PRD-004 item that still requires Vinicius's
review. On 2026-07-14, Vinicius explicitly authorized the supervised software
workflow to continue while these reviews are deferred. Deferred review is not
approval, physical evidence, or authorization for disconnected or energized
work.

## Software handoff summary

THERM-001 and THERM-003 through THERM-009 are complete at Agent review level;
THERM-002 software is complete but its Human design acceptance is deferred. The
final software matrix passed OpenAPI validation, protocol 111/224, simulator
59/359, mobile 96/326 plus typechecks/lint/Expo config/web export, strict C++17
4/4 host tests, and 26 strict firmware captures. The ESP-IDF target build was
unavailable because `idf.py`/`IDF_PATH` were absent. These results are software
evidence only.

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

Status: Ready for Human review; unperformed.

This checklist is limited to the exact target build, USB/SELV logic-level
observation with both mains loads confirmed disconnected, and final mobile
review. It is not permission to connect/disconnect mains wiring. A qualified
person must establish and attest the disconnected setup; otherwise defer the
entire target matrix.

### Setup record required before observations

- [ ] Reviewer name/date and whether each item is directly observed,
  owner-reported, inferred, or deferred.
- [ ] Exact Git commit, firmware version, ESP-IDF `6.0.2` environment record,
  build command/result, binary hash where available, flash command/result, and
  clean boot log with secrets/private addresses removed.
- [ ] Exact ESP32-C3 board/revision, pump/heater SSR identifiers, GPIO10/GPIO20
  connection context, OLED/sensor identifiers, and USB/SELV power source.
- [ ] Qualified-person attestation that heater and pump mains loads are
  disconnected and cannot become energized during this matrix; no mains wiring
  is to be changed as part of the review.
- [ ] Logic analyzer/oscilloscope/DMM model, asset/serial identifier,
  calibration/status, probe reference, sample rate, channel-to-GPIO mapping,
  and timestamp synchronization where logic-level evidence is supplied.
- [ ] Physical phone model/OS/app build for mobile review, or explicit deferral
  if unavailable.

### Exact disconnected target checklist

- [ ] Boot: before network/display startup, record GPIO10 and GPIO20 commanded
  inactive; API v2 reports extraction/cooldown initial idle and compensation
  inactive. Label this logic/command evidence, not physical de-energization.
- [ ] Reset and power-cycle: record that neither extraction nor cooldown
  identity/phase resumes and both command states return `off`.
- [ ] API v1 regression: record health, identity, authenticated state, target,
  mode, heater-permission, and guarded fault responses without shape drift.
- [ ] Brew/Steam exclusion: while Steam is acknowledged, extraction Start must
  return `brew_mode_required` with GPIO10 command unchanged; while extraction
  or cooldown is active, a Steam request must be rejected without changing the
  workflow.
- [ ] Extraction phases: record Manual and one profile across pre-infusion,
  soak, main, Stop/completion, same-key replay, and competing-key conflict.
  Compare API/OLED phase and `PUMP CMD` wording with GPIO10 command-level traces.
- [ ] Compensation state: record inactive at idle/pre-infusion/soak and active
  only at Manual/main. Confirm displayed/persisted Brew target remains unchanged;
  do not infer a physical `2°C` effect from duty-command observation.
- [ ] Cooldown eligibility: record `sensor_unavailable`, `machine_faulted`,
  `cooldown_not_required`, extraction-active, and competing-cooldown responses
  where the exact target setup can safely produce them.
- [ ] Cooldown Start ordering, only if an eligible above-target sample can be
  established without energizing a mains load or changing wiring: record Brew
  acknowledgement and heater-inhibit/off command before GPIO10 running command,
  plus the snapshotted Brew target and retained idempotency key.
- [ ] Cooldown Stop: record GPIO10 off command, five-second stabilization with
  both command states off, retained `stopped` outcome, and idempotent repeated
  Stop without a restarted deadline.
- [ ] Cooldown cutoff: record adjacent `44,999/45,000 ms` command-state evidence
  and the following `4,999/5,000 ms` stabilization boundary if the disconnected
  setup can safely hold eligibility. Otherwise mark this exact target scenario
  deferred; host/simulator timing is not a substitute.
- [ ] Cooldown target crossing: if a safe disconnected setup naturally provides
  validated samples above and then at/below the snapshot, record the first
  acknowledged transition. Do not introduce a heat source or energized load
  under this checklist; otherwise defer.
- [ ] Disconnect: after an acknowledged workflow Start, disconnect/stop the app
  and record that firmware command timing continues; reconnect and verify the
  acknowledged identity/elapsed/outcome without a restarted deadline.
- [ ] Power loss during extraction/cooldown: with mains loads still disconnected,
  record boot returning both workflows idle/off rather than resuming.
- [ ] Safely injectable failure paths: record only failures supported by the
  exact approved low-voltage setup. Do not short pins or defeat protections;
  mark GPIO-write, stuck-output, sensor, or lock failures deferred when no safe
  injection seam exists.
- [ ] OLED: record `PUMP CMD RUN/OFF`, `+2C` eligibility, `COOL CMD PUMP RUN`,
  and `STAB CMD PUMP OFF` agreement with acknowledged API/command state. These
  labels do not confirm physical output.

### Final mobile checklist

- [ ] Re-review every THERM-002 item above against the final production flow,
  including confirmation, prominent Stop, stabilization/terminal/failure and
  disconnected states, and Steam navigation guidance.
- [ ] On physical iOS and Android where available, record large Dynamic Type,
  wrapping/no horizontal clipping, non-color status cues, touch targets,
  VoiceOver/TalkBack order/roles/checked/live-region/action labels, and English/
  Brazilian Portuguese copy. Explicitly defer each unavailable platform.
- [ ] Confirm requested values never replace live values before strict device
  acknowledgement and unknown-outcome cooldown retry retains one key.

### Human disposition

- [ ] Attach or reference sanitized logs, screenshots, video, and logic traces.
- [ ] For every row, record Pass / In-scope revision requested / Deferred and
  the evidence level. Do not collapse owner report and direct observation.
- [ ] State explicitly whether THERM-002 visual acceptance and THERM-010 limited
  target/low-voltage acceptance are approved. Approval is limited to produced
  evidence and does not authorize energized work.

Decision and evidence: Pending.

## THERM-011 — Energized and instrumented validation

Status: Blocked on separate exact authorization; no procedure is provided.

No energized instruction or work may begin from this document. After THERM-010
is accepted for its limited evidence, Vinicius must separately approve a written
procedure and exact setup. The authorization request must include all of the
following before any procedural steps are drafted or performed:

- [ ] Named responsible reviewer and qualified supervision present for the
  entire activity, with date/location and emergency authority.
- [ ] Exact Git commit, firmware/binary hash, board, machine, heater/pump SSRs,
  sensor mounting, and all wiring/enclosure/protective-earth identifiers.
- [ ] Independent thermal cutoff identity, rating, tolerance, placement, series
  interruption role, and qualified verification record; software thresholds do
  not substitute for it.
- [ ] Qualified electrical disposition of fuse/breaker, conductor/terminal,
  insulation, creepage/clearance, strain relief, enclosure, grounding, SSR input
  margin/load rating/heat sinking/derating, and shorted-SSR failure risk.
- [ ] Independent reference thermometer/data logger and any electrical/flow
  instruments with serial/asset IDs, calibration certificates/status,
  uncertainty, sample rates, probe placement, and synchronized timestamps.
- [ ] Boiler/water state, safe water availability, ambient/heat-soak conditions,
  pressure/leak/dry-boil controls, dose/flow context, and a plan for comparable
  repeated runs.
- [ ] Exact proposed comparison matrix for pre-infusion `0°C`, Manual/main
  `+2°C`, no-bias comparison, target/cutoff/Stop cooldown, five-second
  stabilization, recovery, overshoot, variability, and water use.
- [ ] Numeric stop conditions and immediate safe-shutdown responsibility for
  implausible/divergent readings, uncontrolled rise, unexpected SSR/current,
  cutoff concern, inadequate water, leaks, pressure, wiring/enclosure change,
  instrument loss, or loss of supervision.
- [ ] Explicit disposition of every applicable unresolved BLOCKER/MAJOR finding
  for the exact setup; absence of a disposition blocks authorization.
- [ ] Evidence handling and final decision form: retain constants, defer
  judgment, or request a separately scoped PRD. No automatic tuning or scope
  expansion is authorized.

Even when every field is supplied, Vinicius must send a separate explicit
authorization naming that exact procedure and setup. Until then, THERM-011
remains unperformed and no energized steps should be inferred.

Authorization and evidence: Pending.
