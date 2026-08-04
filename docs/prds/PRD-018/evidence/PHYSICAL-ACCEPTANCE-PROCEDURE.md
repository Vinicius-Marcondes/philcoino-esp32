# PRD-018 supervised physical acceptance procedure

Status: AUTHORIZED — NOT EXECUTED

This worksheet does not authorize modifying, connecting, or energizing mains
wiring. A qualified Human must explicitly authorize and supervise the exact
setup after reviewing the software evidence, independent protection, stop
controls, instrumentation, and unresolved project safety findings.

## Evidence boundary

The completed software evidence verifies the equation, persistence policy,
protocol, simulator, presentation, host safety paths, and ESP32-C3 build. It
does not prove:

- the reported initial `10–15°C` thermal gap or `10–15` minute equilibrium time;
- that the control estimate equals an independently measured steam temperature;
- that the default `12°C` / 12-minute curve is appropriate for this boiler;
- that the physical heater, SSR, or thermostat interrupts energy as commanded;
- safe mains construction, pressure behavior, dry-boil protection, or
  unattended operation.

## Authorization and setup record

| Field | Required value |
| --- | --- |
| Explicit Human authorizer and qualified supervisor | |
| Date, location, and permitted test boundary | |
| Repository revision and firmware/app artifact hashes | |
| ESP-IDF version / target | `6.0.2` / `esp32c3` |
| Global calibration offset and calibration evidence | |
| Brew and Steam targets | |
| Initial compensation / decay / ready timeout | |
| Boiler fill, ambient conditions, and repeatable start condition | |
| Lateral thermocouple trace source | |
| Independent top/boiler reference ID, calibration, uncertainty, and placement | |
| Independent heater-current/SSR observation method | |
| Thermostat identity, mounting, series wiring, and interruption evidence | |
| Emergency disconnect and abort owner | |
| Water, pressure, enclosure, grounding, isolation, and protection review | |

Any missing required value blocks connected or energized work.

## Stop conditions

Use the independent disconnect path for unexpected heating, temperature
disagreement, invalid/lost instrumentation, unexpected heater or pump state,
fault, timeout, output-write or safety-lease anomaly, leak, pressure concern,
dry-boil concern, smoke, odor, abnormal sound, unstable mounting, lost
supervision, or any request to bypass a protection.

Do not raise the `135°C` cap, suppress a fault, defeat the SSR lease, bypass the
thermostat, or intentionally overheat the appliance to finish a check. Preserve
stopped and failed runs as evidence.

## Stage A — de-energized and heater-disconnected checks

- [ ] Exact software evidence and artifacts reviewed.
- [ ] Independent thermostat and emergency disconnect reviewed by a qualified
  Human.
- [ ] Thermocouple attachment, conductors, terminals, enclosure, protective
  earth, fusing, strain relief, creepage, clearance, and water separation
  reviewed for the exact setup.
- [ ] With heater energy physically unavailable, boot, fault, persistence
  failure, and settings mutation each independently show an off output.
- [ ] Missing settings store defaults; a deliberately invalid test record
  follows the documented fail-off path.
- [ ] Exact calibrated/raw `135°C` remains permitted and a strictly greater
  reading faults in the bounded test-input setup.

GPIO/API state is not evidence that mains heater energy was interrupted.

## Stage B — instrumented steam characterization

Only after explicit authorization and all Stage A preconditions pass, a
qualified Human may choose a bounded method for supervised runs. Each run must:

1. Start from a recorded, repeatable Brew/boiler/ambient condition.
2. Record the exact build, targets, global offset, and all three Steam settings.
3. Capture synchronized lateral raw/calibrated temperature, independent
   top/boiler reference, control estimate, applied compensation, heater command,
   independent heater-current observation, mode/status/fault, and timestamps.
4. Record Steam entry, first firmware-ready report, first Human-usable steam,
   peak temperatures, equilibrium criterion/time, timeout/return behavior, and
   any deviation or stop.
5. Preserve failed and aborted runs. Do not average them away.

Perform at least 10 comparable runs before proposing production values. Change
only one tuning variable between candidate groups, and do not promote values
from a single run.

| Run | Start condition | Initial °C | Decay min | Ready timeout min | Ready time | Usable steam time | Equilibrium time | Peak raw/calibrated °C | Peak reference °C | Result/deviation |
| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | | | | |
| 2 | | | | | | | | | | |
| 3 | | | | | | | | | | |
| 4 | | | | | | | | | | |
| 5 | | | | | | | | | | |
| 6 | | | | | | | | | | |
| 7 | | | | | | | | | | |
| 8 | | | | | | | | | | |
| 9 | | | | | | | | | | |
| 10 | | | | | | | | | | |

## Stage C — lifecycle and independent cutoff evidence

- [ ] Temporary mode changes preserve the active heat-soak origin.
- [ ] The episode clears only outside Steam after calibrated temperature reaches
  the Brew target or below.
- [ ] Reboot clears the volatile episode and restores persisted settings.
- [ ] Active settings changes preserve both timer origins and command heater off
  before the write.
- [ ] A shortened ready timeout is evaluated from the original ready timestamp
  on the next update.
- [ ] Faults, disconnects, permission removal, and output anomalies remain
  fail-off in independent physical observation.
- [ ] A qualified reviewer records independent thermostat series-path and
  bounded interruption evidence without bypassing software caps or deliberately
  overheating the boiler.

## Human decision

```text
Human reviewer:
Qualified supervisor:
Date:
Exact accepted/rejected firmware and app artifacts:
Accepted settings, calibration, targets, and operating conditions:
10-run repeatability result:
Independent heater-off and thermostat evidence:
Decision: ACCEPT / REJECT / DEFER
Rationale:
Remaining restrictions and unavailable checks:
```

Acceptance is limited to the exact recorded configuration. Until this section
is completed, PRD-018 remains physically unaccepted and must not be represented
as production-ready or safe for unattended use.
