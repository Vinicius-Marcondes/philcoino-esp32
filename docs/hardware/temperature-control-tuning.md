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

## Normal ramp

Normal ramp mode is used for regular heat-up and stable temperature holding.
The key constants are in
`firmware/espresso-machine/components/firmware_config/include/philcoino/config.hpp`:

```cpp
kMinimumHeaterPulseMs = 500U;
kBrewHeatRampBandC = 8.0F;
kSteamHeatRampBandC = 12.0F;
```

The ramp band defines where firmware stops using full heat and starts reducing
heater duty.

For brew mode with a target of 85C and `kBrewHeatRampBandC = 8.0F`:

| Temperature | Error below target | Normal behavior |
| --- | ---: | --- |
| 77C or below | 8C or more | Full heat for the whole 10s window |
| 81C | 4C | About 25% duty, 2.5s on / 10s |
| 83.5C | 1.5C | About 500ms on / 10s, clamped by minimum pulse |
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

## How to tune

Make one small change at a time, flash, and observe at least several full heat
cycles. For brew tuning, focus on the brew constants first.

### Faster warm-up

Use these only if the machine is too slow before reaching the target:

- Decrease `kBrewHeatRampBandC` slightly to stay more aggressive closer to
  target.
- Increase `kMinimumHeaterPulseMs` slightly if near-target pulses are too short
  to affect the boiler.

Risk: more overshoot after the heater turns off.

### Less overshoot

Use these if the temperature still rises too far past target:

- Increase `kBrewHeatRampBandC` to start tapering earlier.
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
