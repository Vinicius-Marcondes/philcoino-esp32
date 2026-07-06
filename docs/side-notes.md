# Side notes

This file tracks important unresolved topics that should remain visible without blocking software and protocol planning.

## Independent heater cutoff

Status: DEFERRED — ACKNOWLEDGED 2026-07-03

The current heater design relies on the ESP32-C3 and a single FOTEK SSR-40 DA to interrupt power to the 800 W, 127 VAC boiler heater. This is not fail-safe because an SSR can fail with its output shorted; software cannot turn off a shorted output.

The plan is to retain the espresso machine's original over-temperature fuse or thermostat, described as interrupting heater power above approximately 120°C, while replacing only the original brew-temperature control. This can provide the required independent cutoff only if it is physically wired in series with the heater and opens the load even when the SSR output is shorted.

Before treating this item as resolved, identify the exact component and verify its marked trip temperature, tolerance, reset behavior, current/voltage rating, physical placement, and series wiring. The maximum software steam target must include enough margin below the verified hardware trip point to account for control overshoot, sensor error, thermal lag, and cutoff tolerance.

This concern is retained for later hardware validation and does not block the approved software/API scope in PRD-001.

## FOTEK SSR-40 DA verification

Status: HUMAN-APPROVED FOR FIRMWARE CONFIGURATION — PHYSICAL RISK RETAINED

The installed relay is confirmed as a `FOTEK SSR-40 DA`. The manufacturer specification identifies the standard SSR-40DA as a 3–32 VDC control-input and 24–380 VAC load-output relay. Its output type and voltage range are therefore nominally compatible with a 127 VAC resistive heater.

Before final wiring approval, verify that the physical unit and terminal markings match the manufacturer specification, confirm reliable activation from the 3.3 V control circuit, and determine the required heat sink and current derating at approximately 6.3 A heater load.

On 2026-07-04, the project owner approved an active-high direct connection from
GPIO20 to the SSR control input. No external pull-down resistor is available or
planned. Firmware will command GPIO20 low as early as its driver can initialize,
but cannot guarantee that the SSR input remains off while GPIO20 is uncontrolled
during reset, boot ROM execution, or loss of ESP32 power. This is an accepted
residual hardware risk for the firmware configuration only, not approval to
energize the heater. Reliable activation from 3.3 V and reset/boot behavior must
still be measured on the physical unit.

## Mechanical thermostat assertion

Status: HUMAN-CONFIRMED — NOT INDEPENDENTLY VERIFIED

On 2026-07-04, the project owner confirmed that the existing mechanical thermostat
remains in place, interrupts overheating, has a nominal 120°C point with stated
5°C variance, and will not shut down below 120°C. The last two claims cannot both
be derived from a symmetric ±5°C tolerance, so firmware records the owner's
assertion without treating it as independent electrical validation. The software
steam over-temperature threshold is 130°C. Energized testing still requires
observing the actual thermostat trip behavior and safe heater interruption.

## PHIL-009 physical iPhone review

Status: DEFERRED — SOFTWARE APPROVED 2026-07-05

The project owner approved PHIL-009 without the physical-iPhone review because
the device is not currently available. The automated discovery parsing,
authentication, secure persistence, cached-address, stable-ID recovery,
simulator integration, type, lint, protocol, configuration, and export checks
passed. This approval closes the software task but does not claim that Bonjour
or iOS local-network behavior has been observed on hardware.

When an iPhone and local device are available, complete these deferred checks
with an iOS development build:

- verify that the local-network permission appears only when discovery is
  needed, and that denial produces actionable Settings guidance;
- verify `_philcoino._tcp.local` discovery and presentation of name, stable
  device ID, model, API version, firmware version, and resolved address before
  token entry;
- verify an invalid token is not persisted, manual IPv4 entry completes the
  same pairing flow, and valid credentials survive an app restart;
- verify startup tries the cached address first and recovers a changed DHCP
  address by rediscovering and re-verifying the stable device ID; and
- verify no-device messaging and retry behavior on the physical local network.
