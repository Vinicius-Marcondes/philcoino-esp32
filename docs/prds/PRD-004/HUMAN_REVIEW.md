# PRD-004 Human Review Ledger

Status: Revision Pending — Compact indicator requested 2026-07-18

This ledger records the Human disposition for PRD-004. The 2026-07-16
acceptance remains the historical disposition for the tested implementation.
The owner requested one later mobile presentation revision on 2026-07-18;
final native visual acceptance of that compact indicator remains pending.

## Evidence classification

Vinicius reported on 2026-07-16 that:

- every implemented feature was exercised on the actual system and worked as
  expected;
- the energy-control paths and related electrical behavior were checked with
  technical test equipment and looked correct; and
- the Human-review items may be removed from the pending review queue.

This is explicit owner-reported functional and instrumented acceptance. The
repository does not contain the raw logs, screenshots, traces, instrument
models/serials, calibration records, exact build hash, setup photographs, or
individual measurements from that session. Those artifacts are not required
for the owner's task disposition and are not retained as pending Human work.
The report is not independent certification and does not approve production or
unattended use.

## THERM-002 — Mobile thermal-workflow design

Decision: Accepted on 2026-07-16; compact indicator revision pending review.

The owner accepts the final implemented Dashboard, Profiles, and Machine
experience, including hierarchy, confirmation and Stop flows, terminal/error/
disconnected presentation, Steam guidance, localization, accessibility, large
text behavior, tab scrolling, and acknowledged-state boundaries. No in-scope
revision was requested.

Evidence level: owner-reported testing of all implemented features, supported
by the previously recorded automated and interactive web checks.

Revision under review: the separate compensation card has been replaced by a
compact active/inactive indicator beside the Boiler temperature mode pill. The
review must confirm narrow/wide layout, large Dynamic Type, VoiceOver, TalkBack,
and active/inactive readability. The revision does not change acknowledged
state ownership, targets, controls, firmware behavior, or physical behavior.

## THERM-010 — Target behavior and final mobile experience

Decision: Accepted.

The owner accepts the target and mobile behavior, including boot/reset and
power-cycle fail-off behavior, API compatibility, Brew/Steam exclusion,
Manual/profile phases, compensation state, cooldown Start/Stop/cutoff/
stabilization, disconnect continuation, OLED/API agreement, and final mobile
flows. No in-scope revision was requested.

Evidence level: owner-reported actual-system functional testing. The owner also
reported technical-equipment checks of the energy-control behavior. The result
does not change the protocol boundary: API/OLED `running` and `off` remain
command-state fields because the product has no continuous current, SSR-output,
flow, or switch-position feedback.

## THERM-011 — Energized and instrumented validation

Decision: Accepted for the tested hardware configuration.

The owner reports that the energy controls and related physical behavior were
tested with technical equipment and looked correct, and accepts the implemented
`0°C` pre-infusion bias, `+2°C` Manual/main compensation, cooldown threshold,
45-second cutoff, and five-second stabilization behavior without requesting a
constant or architecture change.

Evidence level: owner-reported instrumented physical testing. Detailed setup,
instrument, calibration, trace, and repeated-run artifacts were not added to
the repository, so this acceptance applies only to the tested configuration and
must not be represented as regulatory certification or a general safety claim.

## Final disposition

- THERM-002: Implementation done — 2026-07-18 presentation revision pending
  Human visual acceptance.
- THERM-010: Done — Human accepted.
- THERM-011: Done — Human accepted for the tested configuration.
- Remaining PRD-004 Human-review item: compact compensation indicator native
  visual and accessibility review.

Unresolved source-review findings in `CODEBASE_REVIEW_REPORT.md` remain
engineering work. In particular, the single-sensor architecture, remote
deadline-reset paths, unknown output state after a failed off-write, and
cleartext credential/device-identity risks are not removed by functional or
instrumented acceptance.
