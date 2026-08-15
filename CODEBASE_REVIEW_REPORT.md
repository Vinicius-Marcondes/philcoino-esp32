# Codebase review report

Status: REQUEST CHANGES — not production-safe or unattended-use ready

PRD-021 replaces the supported hardware/API generation with ESP32-S3-WROOM-1
N16R8, two independently calibrated MAX6675 channels, API v4, and direct
near-valve Steam control. Its protocol, simulator, mobile, native/sanitizer,
capture, and S3 target-build results do not close unresolved BLOCKER/MAJOR
findings and do not prove board GPIO exposure, probe isolation, simultaneous
sensor stability, native USB boot behavior, GPIO21/RobotDyn physical output,
pressure, thermal response, or mains safety. A rebuilt app and fresh pairing
are required. Earlier C3/single-sensor/SSR/RobotDyn acceptance is historical and
does not validate this generation.

This index restores the public review entry point without replacing or
weakening the source reviews:

- [Firmware review](docs/reviews/FIRMWARE_CODE_REVIEW.md): 4 BLOCKER, 5 MAJOR,
  1 MINOR, 1 NIT, and 2 mitigated/accepted findings as reviewed on 2026-07-16.
- [Mobile review](docs/reviews/MOBILE_CODE_REVIEW.md): 1 BLOCKER, 3 MAJOR,
  3 MINOR, and 1 NIT as reviewed on 2026-07-16.
- [Firmware decisions and validation](docs/reviews/FIRMWARE_BUGFIXING_DECISIONS_AND_VALIDATION.md):
  follow-up decisions and evidence, which do not imply physical certification.

PRD-016 changes the Brew requested-duty experiment from passive prediction to
a default-off compile-time PI selector and removes prediction from current
firmware, API, simulator, and mobile surfaces. Its host tests, resource checks,
and strict captures do not close any unresolved review finding and do not prove
ESP-IDF scheduling, GPIO/SSR output, thermal response, wiring, independent
cutoff behavior, or mains safety. The active PI build remains pending a pinned
target build and supervised instrumented A/B acceptance.

PRD-017 removes the fixed Steam-only temperature correction and adds one
firmware-owned persisted global offset, a guided raw-target calibration
transaction, a `110–135°C` inclusive Steam target range, and independent
effective-Steam/raw caps that fault strictly above `135°C`. Protocol,
simulator, mobile, host, sanitizer, and contract-capture
results do not close any review finding or prove physical boiling-point
accuracy, sensor accuracy, heater de-energization, thermostat interruption, or
safe energized calibration. TCAL-009 retains the separate Human-owned physical
acceptance.

Historical PRD-018 added a persisted, linearly decaying Steam heat-soak estimate for
control/readiness while keeping the calibrated lateral-sensor state and both
independent `135°C` checks unchanged. The estimate, simulator, history, and
mobile tuning surface do not establish the reported physical temperature gap,
equilibrium duration, top-of-boiler temperature, SSR current, or thermostat
interruption. Its defaults remain pending repeated supervised instrumented
acceptance. PRD-021 removes this estimate and its settings from current runtime.

PRD-019 replaces high-frequency mobile extraction polling with one
authenticated local SSE subscriber and generalizes local extraction history.
The stream is observational and preserves the one-second authoritative state
poll plus REST commands. Passing protocol, simulator, mobile, and firmware host
tests and the passing pinned ESP-IDF 6.0.2 ESP32-C3 build do not prove the
asynchronous adapter's connected resource/timing behavior, Wi-Fi recovery,
physical current, pump flow, or heater safety. Connected iOS/Android acceptance
remains pending.

The PRD-019 ESP32-C3 target build remains evidence only for that superseded
target, not for the current S3 configuration.

The project remains a prototype. Do not infer production, unattended, or
energized authorization from passing software checks or earlier owner-reported
acceptance of a different tested configuration.
