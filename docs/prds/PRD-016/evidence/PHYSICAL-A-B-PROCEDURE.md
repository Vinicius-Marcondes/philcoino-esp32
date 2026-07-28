# PRD-016 supervised physical A/B procedure

Status: PREPARED — NOT AUTHORIZED OR EXECUTED

This template does not authorize wiring, a connected heater, low-voltage target
work, or energized testing. A qualified Human must explicitly authorize and
supervise the exact setup after the pinned ESP-IDF target builds pass and all
relevant safety/review blockers are assessed.

## Preconditions

- [ ] Exact repository revision and cleanly attributable legacy/PI build
  artifacts are recorded.
- [ ] Both builds use ESP-IDF 6.0.2 / ESP32-C3 and differ only in
  `CONFIG_PHILCOINO_BREW_PI_CONTROL`.
- [ ] Firmware version, Kp, Ki, EMA alpha, integral bounds, 500 ms interval,
  ten-second SSR window, target, and extraction scenario are frozen.
- [ ] Independent boiler thermometer placement, calibration/uncertainty, sample
  rate, and synchronized clock are documented.
- [ ] SSR/current observation is independent of firmware command telemetry.
- [ ] Independent over-temperature cutoff and emergency disconnect are
  physically verified by the responsible Human before heating.
- [ ] Wiring, enclosure, grounding, isolation, protection, and stop controls are
  reviewed for this exact configuration.
- [ ] Explicit Human authorization, supervisor, date/time, and allowed test
  boundary are recorded.

Any unchecked precondition blocks the test.

## Stop conditions

Stop and de-energize through the independent path on any sensor disagreement,
unexpected SSR/current state, sustained oscillation, over-temperature approach,
heater fault, timeout, scheduler/deadline/lease anomaly, output-write failure,
unexpected switching rate, smoke/odor/leak, instrumentation loss, or supervisor
request. Do not weaken firmware safety behavior or raise thresholds to finish a
run. Preserve every stopped/failed run in the evidence set.

## Matched run record

Record for every run:

| Field | Required value |
| --- | --- |
| Controller | `legacy_curve` or `pi` |
| Revision/build artifact hash | |
| Firmware version and selector | |
| Kp / Ki / EMA alpha / integral bounds | |
| Controller interval / SSR window / minimum pulse | |
| Brew base target / private extraction target | |
| Scenario | cold warm-up, idle hold, Manual/main extraction, recovery |
| Ambient and initial boiler temperature | |
| Independent sensor/setup/calibration | |
| Independent cutoff verification | |
| Requested legacy/PI duty trace | |
| Firmware command/delivered-command trace | |
| Independent SSR/current trace | |
| Measured temperature trace | |
| Faults/timeouts/deadline/lease/switching events | |
| Exclusions and reason | |
| Supervisor | |

Use repeated matched initial conditions. Do not compare simulator or phone-only
rows with physical traces. Firmware `deliveredCommandDuty1s` remains a command
fraction, not measured power.

## Metrics and decision

For both warm-up and post-extraction recovery, calculate per run and controller:

- peak overshoot above the base target;
- recovery time using one predeclared target-band/hold definition;
- idle peak-to-peak variation, oscillation period, and sustained duty cycling;
- heater faults, heating/Steam timeouts, scheduler/deadline misses,
  safety-lease events, and observed SSR switching;
- mismatch between firmware command and independent SSR/current observation.

Active PI can be accepted only if the Human-reviewed evidence shows:

- at least 30% lower median warm-up/recovery overshoot;
- no more than 20% increased recovery time;
- stable idle without sustained oscillation;
- no new heater fault, timeout, switching, deadline, or safety-lease regression;
- no unresolved command-versus-physical-output discrepancy.

Decision:

```text
Human reviewer:
Date:
Exact accepted/rejected build:
Decision: ACCEPT / REJECT / MORE EVIDENCE REQUIRED
Rationale:
Remaining restrictions:
```

Until this section is completed by the responsible Human, the active PI build
is not physically accepted.
