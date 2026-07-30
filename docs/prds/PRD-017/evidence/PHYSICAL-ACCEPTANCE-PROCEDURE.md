# PRD-017 supervised physical acceptance procedure

Status: PREPARED — NOT AUTHORIZED OR EXECUTED

This worksheet does not authorize connecting, modifying, or energizing mains
wiring. A qualified Human must explicitly authorize and supervise the exact
setup after reviewing the software evidence, unresolved codebase findings,
instrumentation, independent protection, and stop controls.

## Evidence boundary

The completed software evidence proves contract agreement, host policy,
simulator behavior, mobile presentation, and a pinned ESP-IDF target build. It
does not prove:

- the user-observed local boiling point or saved offset is accurate;
- the boiler-base thermocouple placement is representative or repeatable;
- the heater, pump, valve, SSR, or thermostat physically follows a command;
- the listed nominal `145°C`, 10 A, 250 V thermostat is the installed part;
- installed thermostat tolerance, thermal coupling, series wiring, or heater
  interruption;
- safe mains construction, pressure behavior, dry-boil protection, or
  unattended operation.

## Authorization and setup record

| Field | Required value |
| --- | --- |
| Explicit Human authorizer | |
| Qualified supervisor | |
| Date, location, and allowed test boundary | |
| Repository revision and firmware artifact hash | |
| ESP-IDF version / target | `6.0.2` / `esp32c3` |
| Firmware version | `0.4.0` |
| App build and protocol revision | |
| Brew / Steam targets | |
| Existing saved offset and calibration status | |
| Boiler fill/state and machine start condition | |
| Ambient temperature and local pressure/altitude context | |
| Independent thermometer ID, calibration, uncertainty, placement | |
| Independent heater-current/SSR observation method | |
| Thermostat markings, identity evidence, mounting, and coupling | |
| Qualified series-wiring/interruption evidence | |
| Emergency disconnect and abort owner | |
| Water, pressure, enclosure, grounding, isolation, and protection review | |

Any missing required value blocks connected or energized work.

## Stop conditions

Stop through the independent disconnect path on any unexpected heating,
temperature disagreement, invalid or lost instrument, unexpected heater or pump
state, fault, timeout, safety-lease/deadline anomaly, output-write failure,
leak, pressure concern, dry-boil concern, smoke, odor, abnormal sound, unstable
mounting, lost supervision, or request to bypass a protection.

Do not raise the `135°C` cap, suppress a fault, defeat the SSR lease, bypass the
thermostat, or intentionally overheat the appliance to finish a check. Preserve
stopped and failed runs as evidence.

## Stage A — De-energized review

- [ ] Exact firmware/app artifacts and TCAL-008 software evidence reviewed.
- [ ] Thermostat markings and installed identity photographed or transcribed.
- [ ] A qualified reviewer documents whether the thermostat is independently
  in series with heater energy and how interruption was established without
  relying on the marketplace listing.
- [ ] Thermocouple attachment, conductors, terminals, enclosure, protective
  earth, fusing, strain relief, creepage, clearance, and water separation are
  reviewed for the exact setup.
- [ ] Emergency disconnect is identified, reachable, and assigned to a Human.
- [ ] No unresolved precondition requires bypassing software or physical
  protection.

## Stage B — Heater-disconnected software/output check

Use a qualified low-voltage method with heater energy physically unavailable.
Do not infer mains interruption from GPIO or API state.

- [ ] Boot and fault states command heater off.
- [ ] A valid Steam target of `134°C` is accepted.
- [ ] A valid Steam target of `135°C` is accepted and persists across reboot.
- [ ] `136°C` is rejected without changing the persisted target.
- [ ] With zero offset, exact raw/effective `135°C` does not latch a fault and
  the ordinary controller requests heater off at the reached target.
- [ ] With controlled test inputs, the first representable effective reading
  above `135°C` latches `over_temperature` and commands heater off.
- [ ] Independently, the first representable raw reading above `135°C` latches
  `over_temperature` and commands heater off even when effective remains below
  the cap.
- [ ] Independent low-voltage observation agrees with the heater-off command.
- [ ] Fault dismissal remains unavailable until both raw/effective conditions
  and ordinary target cooldown conditions are satisfied.

Record the input source, uncertainty, raw/effective values, offset, API
snapshot, command trace, and independent output observation for each check.
This stage does not prove SSR load interruption.

## Stage C — Supervised boiling-point calibration

Only after every precondition and Stage A review is accepted:

1. Start from Brew with no extraction, cooldown, fault, Steam workflow, or scale
   calibration active.
2. Record initial raw/effective temperatures, targets, saved offset, boiler
   state, ambient conditions, and instrument readings.
3. Open Temperature Calibration. Confirm the acknowledged raw candidate starts
   at `100°C` or at the saved-offset recalibration point.
4. Confirm the pump remains off. The Human manually operates the steam wand.
5. Allow the Human—not a countdown—to decide when conditions are sufficiently
   stable, then record the candidate, raw/effective readings, independent
   reading, advisory stability, heater command, and physical observation.
6. Adjust only in whole-degree steps within `90–120°C`. Do not chase a result
   after a stop condition.
7. Review the calculated `100 - candidate` offset before Save. Confirm the
   resulting safe target bounds do not silently alter persisted targets.
8. Save only after explicit Human confirmation. Record the acknowledgement,
   NVS result, restored Brew mode, pump command, and effective temperature.
9. Power-cycle and verify the calibrated flag, offset, targets, and effective
   temperature restore without reapplying the offset.
10. Repeat from comparable initial conditions at least three times, including
    one Cancel run. Do not average away failed or stopped observations.

### Calibration run record

| Run | Start condition | Candidate raw °C | Independent °C | Observed result | Saved offset °C | Save/Cancel | Reboot restored | Deviations |
| --- | --- | ---: | ---: | --- | ---: | --- | --- | --- |
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |

## Stage D — Lifecycle and fail-off review

With the same supervised setup, record Save, Cancel, navigation away,
disconnect, session expiry, fault, and reset separately. Each unsaved path must
discard the candidate, command the heater off during ownership transfer, return
to ordinary Brew control, preserve persisted targets/offset, and never command
the pump or valve.

Physical current/flow observations must be recorded separately from firmware
commands. An API value is not independent evidence.

## Stage E — Independent thermostat review

A qualified reviewer must choose a bounded method that does not bypass the
software caps or intentionally overheat the machine. Record:

- installed part markings and whether they match the nominal listing;
- tolerance/reset behavior from authoritative part evidence, if available;
- thermal coupling and mounting;
- series-path evidence independent of firmware/GPIO;
- bounded heater-interruption evidence and instrumentation;
- any check that could not be performed safely.

Do not deliberately trip the thermostat merely to complete this worksheet. If
interruption cannot be established without unsafe heating, mark it deferred.

## Human decision

```text
Human reviewer:
Supervisor:
Date:
Exact accepted/rejected firmware and app artifacts:
Observed calibration result and repeatability:
Software-cap evidence reviewed:
Thermostat identity/wiring/interruption evidence:
Decision: ACCEPT / REJECT / DEFER
Rationale:
Remaining restrictions and unavailable checks:
```

Acceptance is limited to the exact recorded configuration. Until this section
is completed by the responsible Human, PRD-017 remains physically unaccepted
and must not be represented as production-ready or safe for unattended use.
