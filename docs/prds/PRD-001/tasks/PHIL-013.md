# PHIL-013 — Perform supervised physical integration validation

Status: Todo
Review Mode: Human

## Human Review Needs

Supervise low-voltage and energized tests, verify the retained thermal cutoff and SSR installation, review temperatures against independent instruments, and approve final iPhone behavior on the actual machine.

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

- [ ] Low-voltage boot and fault behavior is repeatable.
- [ ] The boiler-base thermocouple is mapped and validated against an independent reference in both brew and steam ranges.
- [ ] Actual network discovery, pairing, polling, settings, and mode behavior pass.
- [ ] Steam timeout returns to brew without the app connected.
- [ ] Human reviewer signs off the evidence or records blocking defects.

## Verification Strategy

Use a written test checklist, independent thermometer, electrical measurements, logs, photos, and physical-iPhone observations.

## Dependencies

PHIL-012.

## Files Expected To Change

Integration evidence/documentation and narrowly scoped fixes discovered during supervised validation.

## Stop Conditions

- Stop before mains energization unless the original thermal cutoff, branch protection, HLK input protection, SSR load wiring, heat sink, enclosure, and grounding have been reviewed.
- Stop immediately on implausible sensor readings, unexpected GPIO activation, excessive SSR temperature, uncontrolled heating, leaks, or pressure-safety concerns.
