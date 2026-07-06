# PHIL-004 — Establish the ESP-IDF firmware foundation

Status: Done
Review Mode: Human

## Human Review Needs

Confirm the pinned ESP-IDF release, device identity strategy, safety constants, final OLED configuration, GPIO assignment, and SSR drive circuit before dependent firmware work.

## Goal

Create a buildable ESP-IDF C++ project with explicit configuration and approved firmware-level decisions.

## Scope

- Pin ESP-IDF and required managed components.
- Establish component boundaries, configuration, secrets handling, logging, and host-test support.
- Resolve stable device ID/name, temperature thresholds, heating timeout, sensor disagreement, OLED address/pins, and SSR drive method.
- Document decisions that affect later tasks.

## Non-Scope

- Peripheral implementations, control logic, HTTP handlers, or energized heater tests.

## Implementation Plan

1. Record and approve unresolved firmware decisions.
2. Scaffold CMake, sdkconfig defaults, partitions, and component structure.
3. Add a minimal boot path and host-test target.
4. Document local configuration and secret exclusions.

## Acceptance Criteria

- [ ] Firmware builds for ESP32-C3 with a pinned ESP-IDF release.
- [ ] All listed decisions are recorded and human-approved.
- [ ] Bearer token and Wi-Fi secrets are excluded from source control.
- [ ] Component boundaries support host testing.

## Verification Strategy

Build firmware and host-test targets; human reviews the decision record against the physical modules.

## Dependencies

PHIL-002.

## Files Expected To Change

`firmware/espresso-machine/**`, configuration examples, decision documentation, and reference version notes.
