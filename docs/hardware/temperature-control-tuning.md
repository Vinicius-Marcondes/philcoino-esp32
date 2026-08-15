# Temperature control tuning

Status: DRAFT — SOFTWARE/LOW-VOLTAGE EVIDENCE ONLY

This document describes current control inputs and tuning boundaries. It does
not authorize flashing, energized tests, SSR/TRIAC wiring, or mains operation.

## Heater output model

The heater SSR remains active-high on GPIO21 and is driven through the existing
ten-second duty window. Firmware may request part of a window; it cannot confirm
physical current or de-energization. `FailOffSsr`, permission, inhibits, faults,
the independent lease, and hardware cutoff requirements remain dominant.

Brew retains its compile-time legacy-versus-bounded-PI selector. PI defaults
shadow-only. Changing authority or tuning constants creates a new physical-test
configuration and requires supervised instrumented acceptance.

## Independent sensor calibration

Boiler and Steam each own a signed persisted offset:

```text
sensorOffsetC = 100 - observedRawBoilingTemperatureC
effectiveSensorTemperatureC = rawSensorTemperatureC + sensorOffsetC
```

Boiler calibration affects only Brew control and Brew target reachability.
Steam calibration affects only Steam control and Steam reachability. Values are
never copied, blended, or used as fallback. A missing record is valid
uncalibrated 0°C; corrupt storage faults off.

The parameterized workflow accepts whole-degree raw candidates from 90–120°C.
Only one Boiler-or-Steam session may exist. The selected raw sensor temporarily
feeds calibration control while the other sensor continues independent
validation and raw over-temperature protection. Save persists outside the
control lock and becomes active only after exact acknowledgement.

Mapping observed boiling to logical 100°C is a machine-specific rebasing
convention—not a certified calibration, pressure/altitude model, placement
validation, or proof of SSR/cutoff behavior.

## Direct mode mapping

- Brew uses the calibrated Boiler sensor at the boiler base.
- Steam uses the calibrated near-valve Steam sensor.
- No fallback or blending is allowed.
- Switching requires a current valid destination reading and commands heater OFF.
- Switching resets readiness, duty window, timeout, and recovery state.

One invalid active sample commands heater OFF; three consecutive failures latch
`sensor_failure`. Invalid inactive input becomes unavailable and blocks its mode.
Raw temperature above 135°C from either sensor faults immediately with source
attribution. The active effective limits remain Brew 98°C and Steam strictly
above 135°C.

## Steam control

Legacy Steam heat-soak compensation, initial compensation, and decay were
removed. Steam controls directly against `steamTargetC` using the near-valve
sensor. Only the post-ready return timeout remains configurable from 1–15
minutes. Legacy NVS migration retains timeout and discards obsolete fields.

Instrumented Steam tuning must record both probe locations, reference instrument
and calibration, ambient/start state, heater command, peaks, time to readiness,
pressure context, and independent cutoff behavior. A near-valve sensor does not
itself establish steam quality, pressure, or safety.

## Extraction and cooldown

Manual/main Brew extraction keeps the existing compile-time +2°C heater-duty
bias; pre-infusion remains 0°C. This affects private requested duty only—not
published target, readiness, fault limits, calibration, or persistence.

Cooldown still snapshots the Brew threshold, inhibits/commands heater OFF before
starting the pump, stops by threshold/deadline/Stop, and retains five seconds of
stabilization. Reset never resumes it.

## Readiness and displayed state

Readiness requires the active selected temperature within ±1°C for three
seconds. Heater command is the authoritative software request. If temperature
continues rising while command is OFF, investigate inertia, lag, SSR leakage/
failure, wiring, and mounting before increasing duty.

## Suggested supervised tuning process

With a separately approved configuration and independent protection:

1. Record exact build, board, wiring, both probes, instruments, and start state.
2. Change one compile-time control constant at a time.
3. Measure warm-up, overshoot, extraction drop/recovery, and post-recovery peak.
4. Repeat comparable runs; do not fit from one trace.
5. Stop on sensor disagreement, invalid readings, unexpected output, or cutoff issues.

Previous C3, single-sensor, fixed-correction, heat-soak, pump-SSR, or RobotDyn
acceptance does not validate this S3 dual-probe configuration. Repository tests
cannot substitute for physical instrumentation.

## Safety limits

Raw/effective fault limits, fail-off paths, task deadlines, output leases, the
90% pump cap, and independent cutoff are not flavor/performance tuning knobs.
Do not raise limits or weaken sensor validity to compensate for placement,
wiring, pressure, or thermal-response problems.
