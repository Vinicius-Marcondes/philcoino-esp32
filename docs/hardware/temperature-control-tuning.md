# Temperature control tuning

Status: DRAFT - LOW-VOLTAGE SOFTWARE TUNING ONLY

This document explains the firmware temperature-control curve and the constants
used to tune it. It does not approve mains wiring, energized testing, SSR
mounting, or thermal safety. Hardware cutoff validation remains required before
software behavior can be treated as safe.

## Control model

The ESP32 controls the heater through an SSR, so firmware cannot output partial
power directly. It approximates a curve by turning the SSR on for part of a
fixed time window and off for the rest.

The current heater window is:

```cpp
kHeaterControlWindowMs = 10U * 1000U;
```

That means each control cycle is 10 seconds. If the calculated pulse is 2500 ms,
the SSR is on for the first 2.5 seconds of the window and off for the remaining
7.5 seconds. The window restarts every 10 seconds while the active temperature is
below target.

When the active temperature reaches or exceeds the active target, firmware turns
the heater command off and resets the heater window.

## Steam temperature correction

Firmware validates the raw boiler-base MAX6675 status and finite reading before
deriving the active temperature. The only correction constant is compile-time:

```cpp
kSteamTemperatureOffsetC = 5;
```

The controller uses these semantics:

```text
Brew active temperature  = validated raw boiler-base temperature
Steam active temperature = validated raw boiler-base temperature + 5°C
```

The conversion occurs once inside `TemperatureController`. Heater demand and
duty, recovery, readiness, heating timeout, five-minute Steam timeout,
over-temperature latching/dismissal, API state, and OLED presentation all use
that same active value. At a Steam target of `120°C`, raw `115°C` is active
`120°C` and requests no additional heat. The unchanged raw sample is reported
as `115°C` in Brew, so a mode change may visibly move the API/OLED value by
exactly `5°C`.

This fixed value is an owner-selected compensation for an observed boiler-base
to upper-boiler difference. It is not a calibration result, scaling curve, or
proof of heater safety. Changing it requires a source edit, rebuild, and
reflash; do not add runtime configuration under PRD-003.

## Extraction heater-duty bias

Brew extraction has a separate compile-time duty-only hypothesis:

```cpp
kPreInfusionHeaterDutyOffsetC = 0;
kExtractionHeaterDutyOffsetC = 2;
```

The controller receives the current extraction phase and derives a private
heater-duty target. Pre-infusion, soak, idle, and Steam use their unchanged
base target. Manual and profile main extraction use:

```text
heater duty target = min(brewTargetC + 2°C, brewOverTemperatureC - 1°C)
```

Only heater demand and pulse duration use this private target. Persisted/API/
OLED targets, the displayed boiler temperature, readiness, heating and Steam
deadlines, recovery ownership, over-temperature limits, and extraction profile
data continue to use the base target and existing active temperature. Heater
permission, sensor/control faults, safety-lease trips, and output failures
still suppress the heater command; they do not independently stop extraction.

Phase changes update eligibility and begin a new heater-duty window without
resetting readiness, heating timeout, Steam timeout, or extraction deadlines.
The `+2°C` value is an owner-selected software hypothesis, not a measured
thermal result. Host tests establish deterministic command policy only and do
not prove heater output, water flow, cooling, SSR operation, calibration, or
energized safety.

## Firmware cooldown policy

Cooldown is a separate fixed workflow, not a tuning control. A new Start
requires a valid Brew-effective sample above the current Brew target, idle
extraction/cooldown, and no machine fault. Firmware snapshots the Brew target,
switches to Brew, establishes a transient heater inhibit and heater-off command,
then requests the pump-running command. It never changes the user's heater
permission.

The pump-running command ends at the first validated sample at or below the
snapshot, at exactly 45 seconds, or on Stop. Firmware then holds pump-off and
heater-inhibited command state for exactly five seconds before returning to
normal Brew control when the existing permission/fault rules allow it. Same-key
replay preserves the original deadline; reset and power loss return to initial
idle/off rather than resuming.

The Brew threshold, 45-second cutoff, and five-second stabilization are
owner-selected software hypotheses. API, OLED, simulator, host, and target-build
agreement cannot establish physical flow, water use, cooling rate, SSR state,
heater current, or safe thermal behavior. Changing any fixed constant based on
physical observations requires a new scoped product decision. THERM-011 was
owner-accepted for the tested configuration on 2026-07-16.

## GPTimer fail-off safety lease

Every heater-on control update arms or renews a 1500 ms one-shot GPTimer safety
lease before GPIO20 is commanded high. Healthy 500 ms control updates renew the
deadline without toggling the GPIO, so full-power warm-up remains continuously
on and the existing 10-second duty curve is unchanged.

If control execution stops renewing the lease, the cache-safe timer interrupt
commands GPIO20 low. The trip remains latched for the current boot; the next
controller update reports `internal_error` and automatic heating cannot resume
until reboot. Normal off transitions command GPIO20 low before disarming the
lease, and target persistence commands the heater off before synchronous NVS
writes.

This is a firmware fail-off boundary, not an independent thermal cutoff. It
cannot interrupt current through an SSR that has failed with its output shorted,
and it does not control GPIO20 before firmware initializes the pin.

## Normal ramp

Normal ramp mode is used for regular heat-up and stable temperature holding.
The key constants are in
`firmware/espresso-machine/components/firmware_config/include/philcoino/config.hpp`:

```cpp
kMinimumHeaterPulseMs = 500U;
kBrewHeatRampMinimumTargetBandC = 4.0F;
kBrewHeatRampBandC = 8.0F;
kSteamHeatRampBandC = 12.0F;
```

The ramp band defines where firmware stops using full heat and starts reducing
heater duty. Brew mode scales this band by the selected target so lower targets
warm more aggressively on first boot while the 95C behavior remains unchanged.

Current brew target scaling:

| Brew target | Effective ramp band |
| ---: | ---: |
| 85C | 4C |
| 90C | 6C |
| 92C | 6.8C |
| 95C | 8C |

For brew mode with a target of 85C and an effective 4C ramp band:

| Temperature | Error below target | Normal behavior |
| --- | ---: | --- |
| 81C or below | 4C or more | Full heat for the whole 10s window |
| 83C | 2C | About 25% duty, 2.5s on / 10s |
| 83.5C | 1.5C | About 1.4s on / 10s |
| 85C or above | 0C | Heater off |

Normal mode uses a squared curve:

```text
duty = (temperature_error / ramp_band)^2
```

That makes it conservative near the target to reduce overshoot.

## Recovery ramp

Recovery mode is used after the boiler drops meaningfully below target, such as
during extraction when incoming water pulls heat out of the boiler.

Current recovery constants:

```cpp
kBrewRecoveryTriggerDropC = 1.0F;
kSteamRecoveryTriggerDropC = 3.0F;
kBrewRecoveryHeatRampBandC = 4.0F;
kSteamRecoveryHeatRampBandC = 6.0F;
```

Recovery mode is armed only after the active temperature reaches the active
target at least once. This prevents extraction recovery from engaging during the
first warm-up from cold.

After recovery is armed, recovery mode turns on when:

```text
target - active_temperature >= recovery_trigger_drop
```

For brew mode with a target of 85C and `kBrewRecoveryTriggerDropC = 1.0F`,
recovery starts at 84C or below.

Recovery mode stays latched until the active temperature reaches the target.
This avoids rapidly switching between normal and recovery behavior while the
boiler is still recovering.

Recovery uses a linear curve:

```text
duty = temperature_error / recovery_ramp_band
```

For brew mode with a target of 85C and `kBrewRecoveryHeatRampBandC = 4.0F`:

| Temperature | Error below target | Recovery behavior |
| --- | ---: | --- |
| 81C or below | 4C or more | Full heat for the whole 10s window |
| 83C | 2C | About 50% duty, 5s on / 10s |
| 84C | 1C | About 25% duty, 2.5s on / 10s |
| 85C or above | 0C | Heater off, recovery clears |

Recovery is intentionally more aggressive than normal ramp mode. It should help
recover from extraction drops without making steady-state holding too jumpy.

## Readiness and displayed state

Readiness is separate from heater duty. Firmware reports `ready` only after the
active temperature stays within the ready band for the required time:

```cpp
kReadyBandC = 1;
kReadyStabilityMs = 3U * 1000U;
```

The machine can therefore be close to target while still pulsing heat. It can
also show `Cooling` or `Stabilizing` in the app while protocol status remains
`heating`, because protocol `heating` means "not ready yet", not necessarily
"SSR is energized".

The heater command is the authoritative value for whether firmware is requesting
heat. If the heater command is off and the temperature still rises, that is
thermal inertia, sensor lag, or hardware current flow outside firmware control.

## Future tuning boundary

The notes below are hypotheses for any future separately authorized,
supervised tuning session. They are not authorization to flash, connect loads,
run water, or energize another configuration. THERM-011 was owner-accepted for
the configuration tested on 2026-07-16; a future session must record its own
exact build, setup, instruments/calibration, independent cutoff, qualified
supervision, and stop conditions.

Make one small change at a time, flash, and observe at least several full heat
cycles. For brew tuning, focus on the brew constants first.

### Faster warm-up

Use these only if the machine is too slow before reaching the target:

- Decrease `kBrewHeatRampBandC` slightly to stay more aggressive closer to
- Decrease `kBrewHeatRampMinimumTargetBandC` if low brew targets are still too
  slow.
- Decrease `kBrewHeatRampBandC` slightly if high brew targets are too slow.
- Increase `kMinimumHeaterPulseMs` slightly if near-target pulses are too short
  to affect the boiler.

Risk: more overshoot after the heater turns off.

### Less overshoot

Use these if the temperature still rises too far past target:

- Increase `kBrewHeatRampBandC` to start tapering earlier.
- Increase `kBrewHeatRampMinimumTargetBandC` if lower brew targets overshoot
  after first warm-up.
- Decrease `kMinimumHeaterPulseMs` if the SSR and heater respond reliably to
  shorter pulses.
- Increase sensor contact quality before over-tuning software; poor thermal
  coupling creates late readings and overshoot.

Risk: slower warm-up and slower recovery after extraction.

### Faster extraction recovery

Use these if water flow drops the boiler too far or recovery feels too slow:

- Decrease `kBrewRecoveryTriggerDropC` to enter recovery sooner.
- Decrease `kBrewRecoveryHeatRampBandC` to make recovery duty more aggressive.
- Increase `kMinimumHeaterPulseMs` only if short pulses do not visibly affect
  the boiler.

Risk: recovery may overshoot after the shot if the boiler has high thermal
inertia.

### Calmer recovery

Use these if recovery overshoots after extraction:

- Increase `kBrewRecoveryTriggerDropC` so recovery starts only after a larger
  drop.
- Increase `kBrewRecoveryHeatRampBandC` so recovery uses a gentler duty curve.
- Increase `kBrewHeatRampBandC` if normal holding also overshoots.

Risk: slower recovery during repeated shots.

## Suggested tuning workflow

1. Set a brew target and wait until the machine stabilizes.
2. Record overshoot after first warm-up.
3. Let the machine settle again and run water or pull a shot.
4. Record the lowest temperature reached, time to recover, and post-recovery
   overshoot.
5. Change only one constant.
6. Repeat with the same target and similar water-flow duration.

Useful observations:

- Target temperature.
- Lowest temperature during extraction.
- Highest temperature after recovery.
- Approximate time from lowest point back to target.
- Whether the SSR LED is solid on, pulsing, or off.

Physical acceptance of the Steam correction was completed by the owner in
STEAM-004 on 2026-07-16 for the tested configuration. For any future
revalidation, record the reference instrument and calibration status, exact
probe locations, firmware build, boiler fill/state,
pressure context, ambient conditions, heat-soak duration, and supervision.
Collect repeated paired raw-base and independent top-reference readings near
raw `110°C`, `115°C`, and `120°C` during rise, steady Steam operation, and
recovery. Software, simulator, host, and target-build results cannot substitute
for those measurements.

## Safety limits

These tuning constants must not be used to compensate for missing hardware
safety:

- `kBrewOverTemperatureC` and `kSteamOverTemperatureC` are fault thresholds, not
  tuning knobs for flavor or speed.
- A working independent thermal cutoff is still required.
- An SSR can fail shorted, leaving the heater on even when firmware commands it
  off.
- Sensor placement and thermal coupling must be validated; bad readings can make
  any curve unsafe.

If the app or OLED shows the heater command off but temperature keeps climbing
substantially, investigate thermal inertia, SSR leakage/failure, wiring, and
sensor mounting before making the curve more aggressive.
