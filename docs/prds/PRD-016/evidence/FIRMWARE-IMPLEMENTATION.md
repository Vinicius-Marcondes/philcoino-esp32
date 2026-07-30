# PRD-016 firmware software evidence

Date: 2026-07-28

> Historical evidence: PRD-017 later replaced the fixed Steam-only `+5°C`
> correction described below with one persisted signed global offset. The Brew
> PI and prediction-removal evidence remains valid.

## Implemented boundary

- Removed the passive prediction model, configuration, feature histories,
  inference, live API v2 variant, history packing, capture, and focused tests.
- Added a pure Brew PI policy at a fixed 500 ms interval with an EMA filter,
  finite/range validation, bounded integral state, clamped output, and
  conditional anti-windup in both saturation directions.
- Added the default-off `CONFIG_PHILCOINO_BREW_PI_CONTROL` selector.
  Default/disabled builds keep the legacy nonlinear curve authoritative and run
  PI only for diagnostics. Enabled builds use PI requested duty for Brew only.
- Retained the existing ten-second SSR window and minimum pulse policy. Steam
  continues through the legacy controller and its fixed `+5°C` active
  temperature correction.
- Retained the private Manual/main `+2°C` Brew duty target, pre-infusion `0°C`,
  and base target during soak/idle.
- Replaced prediction history with controller configuration and bounded
  controller/request/command diagnostics.

## Initial shadow configuration

The checked-in initial values are `Kp=0.08`, `Ki=0.01`, EMA
`filterAlpha=0.25`, and integral bounds `[-100, 100]` degree-seconds. They are
conservative shadow-analysis candidates, not physically accepted tuning.
`CONFIG_PHILCOINO_BREW_PI_CONTROL` defaults off. Enabling it for an energized
machine still requires the separately authorized BPI-009 procedure and explicit
owner acceptance.

## Resource rebaseline

The host resource test reports:

```text
HistorySample=40
HistoryBuffer=24072
HistoryPage=416
ControlSnapshot=128
BrewPiController=76
```

The 600-entry ring remains below the existing 40 KiB history budget. The page
remains capped at eight samples, `HistoryPage` remains below 2 KiB, and
serialized pages retain the 8 KiB transport ceiling. These are host layout and
serialization checks, not ESP32 target heap/stack/flash evidence.

## Verification

Native host configuration:

```text
cmake -S firmware/espresso-machine/host-tests -B <temporary-build>
cmake --build <temporary-build> --parallel
ctest --test-dir <temporary-build> --output-on-failure
```

Result: PASS, 10/10 tests.

Sanitizer configuration:

```text
cmake -S firmware/espresso-machine/host-tests -B <temporary-sanitizer-build> -DPHILCOINO_ENABLE_SANITIZERS=ON
cmake --build <temporary-sanitizer-build> --parallel
ctest --test-dir <temporary-sanitizer-build> --output-on-failure
```

Result: PASS, 10/10 tests; configured API codec/mutation targets use
ASan/UBSan.

Firmware contract captures:

```text
<temporary-build>/firmware_api_test <temporary-capture-directory>
bun firmware/espresso-machine/host-tests/validate_contract.ts <temporary-capture-directory>
```

Result: PASS, 32 captures validated against the strict protocol schemas.

Focused coverage includes PI arithmetic/filtering, invalid configuration and
timing, finite failure, integral bounds, freeze/reset behavior, conditional
anti-windup in both directions, build-flag authority, arbitrary shadow output,
Steam preservation, extraction bias/phase changes, target transactions,
cooldown inhibition, permission disable, output failure, fault reset/dismissal,
history capacity, pagination, serialization budget, and command-only
diagnostics.

## Evidence boundary

These results do not prove ESP32 scheduling, target stack/heap/flash deltas,
GPIO voltage, SSR current, heater power, physical de-energization, thermal
response, overshoot reduction, recovery time, idle stability, or mains safety.
The pinned ESP-IDF build and physical A/B gate remain separate evidence.
