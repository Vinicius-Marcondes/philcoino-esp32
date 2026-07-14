# PHIL-005 — Implement firmware peripheral boundaries

Status: Done
Review Mode: Agent
Review Reason: Drivers can be verified with fakes, low-voltage bench tests, and deterministic persistence tests without energizing the heater.

> Superseded hardware note: the completed dual-thermocouple scope records the original implementation. The owner later approved one permanent boiler-base sensor; current architecture and PHIL-013 acceptance use that single sensor.

## Goal

Implement dual thermocouple, OLED, NVS settings, and fail-off SSR output abstractions.

## Scope

- Read two MAX6675 devices on the shared SPI bus with separate CS lines.
- Detect open/invalid thermocouples.
- Drive the SSD1306 status display.
- Persist validated targets in NVS.
- Implement an SSR abstraction that initializes and fails low.

## Non-Scope

- PID/control policy, HTTP, mDNS, or mains-powered heater operation.

## Implementation Plan

1. Define testable peripheral interfaces.
2. Implement MAX6675 scheduling and validation.
3. Implement SSD1306 and NVS adapters.
4. Implement SSR fail-off initialization and test doubles.

## Acceptance Criteria

- [ ] Both sensors are read without simultaneous CS assertion.
- [ ] Open/invalid data is surfaced explicitly.
- [ ] Targets survive firmware restart simulation.
- [ ] SSR command remains off during initialization and errors.
- [ ] OLED renders essential local state.

## Verification Strategy

Run host tests, firmware build, and low-voltage bench verification with the heater disconnected.

## Dependencies

PHIL-004.

## Files Expected To Change

Firmware driver, storage, display, GPIO, component test, and configuration files.
