# Codebase review report

Status: REQUEST CHANGES — not production-safe or unattended-use ready

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

PRD-018 adds a persisted, linearly decaying Steam heat-soak estimate for
control/readiness while keeping the calibrated lateral-sensor state and both
independent `135°C` checks unchanged. The estimate, simulator, history, and
mobile tuning surface do not establish the reported physical temperature gap,
equilibrium duration, top-of-boiler temperature, SSR current, or thermostat
interruption. Its defaults remain pending repeated supervised instrumented
acceptance.

The project remains a prototype. Do not infer production, unattended, or
energized authorization from passing software checks or earlier owner-reported
acceptance of a different tested configuration.
