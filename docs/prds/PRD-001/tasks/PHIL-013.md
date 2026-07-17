# PHIL-013 — Perform supervised physical integration validation

Status: Done — Human Accepted 2026-07-16
Review Mode: Human

## Human Review Needs

Completed on 2026-07-16 through Vinicius's owner-reported functional and
technical-equipment acceptance of the tested configuration.

## Goal

Validate the completed system on the real ESP32-C3, single boiler sensor, display, SSR, network, and iPhone without weakening documented safety boundaries.

## Scope

- Verify boot/reset behavior, GPIO levels, sensor identity, display, mDNS, API, persistence, and app flows.
- Measure the boiler sensor against an independent instrument, including lag and error, plus readiness, overshoot, heating timeout, steam timeout, and SSR/heat-sink temperature.
- Confirm faults command SSR off and remain latched.
- Capture evidence for every remaining PRD acceptance criterion.

## Non-Scope

- Product certification, unattended operation approval, or bypassing original safety devices.

## Implementation Plan

1. Complete low-voltage tests with heater disconnected.
2. Review mains wiring and retained cutoff with a qualified person.
3. Run supervised energized scenarios with independent temperature measurement.
4. Record evidence, decisions, and any follow-up defects.

## Acceptance Criteria

- [x] Low-voltage boot and energy-control behavior was owner-reported as tested with technical equipment and working correctly.
- [x] The owner accepts the boiler-base sensor behavior for the tested Brew and Steam configuration.
- [x] The owner reports that all implemented network discovery, pairing, polling, settings, mode, extraction, and cooldown behavior passes.
- [x] The owner reports that the implemented disconnected-app behavior passes.
- [x] The Human reviewer accepts the tested configuration without requesting a feature revision.

## Verification Strategy

Use a written test checklist, independent thermometer, electrical measurements, logs, photos, and physical-iPhone observations.

## Dependencies

PHIL-012.

## Files Expected To Change

Integration evidence/documentation and narrowly scoped fixes discovered during supervised validation.

## Preserved Stop Conditions For Future Tests

- A changed configuration must not be energized unless the original thermal cutoff, branch protection, HLK input protection, SSR load wiring, heat sink, enclosure, and grounding have been reviewed.
- Stop immediately on implausible sensor readings, unexpected GPIO activation, excessive SSR temperature, uncontrolled heating, leaks, or pressure-safety concerns.

## Human acceptance evidence — 2026-07-16

Vinicius reported testing every implemented feature and checking the energy
controls with technical equipment; all behavior looked correct. This closes the
Human integration task for the tested configuration. Raw equipment records,
calibration data, traces, photographs, and exact setup/build identifiers were
not added to the repository, so the evidence remains owner-reported and does
not constitute certification or approval for unattended use. PHIL-012 remains
separate Agent-owned automated resilience work.
