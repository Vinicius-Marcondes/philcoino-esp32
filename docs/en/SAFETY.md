# Safety and project status

Status: PROTOTYPE — NOT APPROVED FOR PRODUCTION, UNATTENDED USE, OR MAINS

The current generation uses an ESP32-S3-WROOM-1 N16R8, two MAX6675 channels,
heater SSR command GPIO21, and RobotDyn ZC6/DIM10. No software result proves
physical de-energization, probe isolation, pressure, temperature, or electrical
safety.

## Software boundary

Firmware remains authoritative. Startup and faults attempt heater/pump OFF;
that cannot confirm an SSR, TRIAC, wiring path, heater, or pump is physically
off. An SSR may fail shorted. Independent thermal interruption, suitable
protection/fusing, enclosure, grounding, and component sizing remain mandatory.

Brew uses only Boiler and Steam uses only Steam, with no fallback or blending.
One invalid active sample commands heater OFF; three consecutive failures latch
`sensor_failure`. An invalid inactive sensor blocks its mode without interrupting
the healthy active mode. Any raw reading above 135°C immediately latches a
fault attributed to its source sensor.

Boiler/Steam calibration records are independent and only one session exists.
During calibration, the other sensor continues validation and raw
over-temperature protection. Calibration and targets are software transforms;
they do not prove boiling point, accuracy, placement, or thermal lag.

The dimmer initializes at 0% and running uses one 90% cap. This is not measured
voltage, power, pressure, flow, or over-pressure protection. There is no
closed-loop pressure control.

## Previous acceptance is superseded

Prior ESP32-C3, single-MAX6675, pump-SSR, heater GPIO20, and RobotDyn evidence
does not validate the S3 map, simultaneous probes, GPIO21, native USB boot/reset,
near-valve Steam placement, or this firmware. It remains historical evidence only.

## Allowed work

Protocol, simulator, mobile, native/sanitizer, capture, and ESP-IDF target-build
checks are allowed. A qualified human may perform supervised low-voltage checks
with heater and pump loads disconnected. Control-capable flashing and every
energized acceptance are separate human actions and are not authorized here.

Before flashing, confirm the exact 44-pin board exposes every selected GPIO,
both thermocouples are electrically ungrounded, reserved pins do not conflict,
and independent over-temperature interruption exists.

With loads disconnected, verify simultaneous stability/isolation, both bus
waveforms, boot/reset output levels, native USB recovery, isolated zero-cross,
dimmer 0% cessation and 90% timing, and HX711/watchdog behavior. Any dual-probe
interference blocks Steam control until physically corrected.

## Evidence and information security

Protocol/simulator/mobile/host/sanitizer/capture/target-build results are
separate evidence levels. None replaces physical instrumentation or mains
review. Simulator is UI/contract evidence; a target build is compile/link only.

API v4 uses SRP pairing, certificate binding, pinned HTTPS, SecureStore tokens,
and strict parsing. S3/v4 requires a rebuilt app and fresh pairing. Never
disable TLS or pinning to work around a handshake. Treat mDNS/TXT, addresses,
storage, and HTTP as untrusted input.

## Before any future energized use

At minimum: final documented hardware, independent electrical review, validated
independent thermal cutoff, pressure protection, suitable fusing/grounding/
enclosure, instrumented fault/boot tests, dual-probe stability, dimmer/SSR
validation, a supervised procedure, and closure of applicable BLOCKER/MAJOR
findings.

Report security issues without credentials, pairing secrets, Wi-Fi passwords,
tokens, or private certificates.
