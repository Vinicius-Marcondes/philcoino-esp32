# Architecture

This document describes the current generation: ESP32-S3 N16R8 firmware 0.5.0,
two MAX6675 channels, HTTPS API v4, extraction telemetry format 2, and a
rebuilt/freshly paired Expo 54 client.

## System boundary

```text
Expo mobile -- pinned HTTPS API v4 --+-- simulator (UI/contract evidence)
                                      +-- ESP32-S3 firmware (machine authority)
                                            |
              Boiler MAX6675 -- dual control -- Steam MAX6675
              SCK4 SO5 CS7                    SCK4 SO8 CS9
                                            |
                         heater SSR GPIO21 / pump ZC6-DIM10
```

There is no cloud service, account system, Wi-Fi provisioning flow, or
multi-device store. Firmware owns sensor validity, calibration, persisted
targets/settings, mode switching, readiness, timeouts, faults, heater/pump
commands, extraction, cooldown, telemetry, and OTA safety gating. The phone
submits requests and displays only validated acknowledgements.

## API v4 boundary

- `packages/protocol/openapi.yaml` is the language-neutral source of truth.
- Strict Zod schemas are shared by mobile/simulator; unknown fields are rejected.
- Firmware independently parses/serializes C++ and emits strict response captures.
- API v1-v3 routes are absent. Pairing domains, discovery, fixtures, and types are v4.
- SRP pairing plus pinned HTTPS uses the new S3 identity and requires a rebuilt app and fresh pairing.
- `MachineStateV4` has nullable Boiler/Steam values, per-sensor calibration, direct Steam timeout, and sensor-attributed thermal faults.
- Calibration routes are `/api/v4/temperature-calibrations/{boiler|steam}/current`; one session exists globally.
- Extraction telemetry is page format 2 and includes both nullable temperatures.
- Simulator-only `/_simulator` routes never exist in firmware.

## Firmware layering and startup

- `firmware_config` owns identity, fixed pins, affinity, safety limits, and the one pump cap.
- `peripherals` owns MAX6675/HX711 policy, separate NVS records, fail-off output wrappers, and ESP adapters.
- `control` owns dual-sensor selection, heater policy, faults, scale, extraction, and cooldown.
- `networking` owns codecs, SRP/HTTPS/mDNS, telemetry, OTA, and API orchestration.
- `main/app_main.cpp` owns fail-off initialization order and task creation.

Startup preloads outputs inactive, initializes the shared MAX6675 bus with both
CS high/SCK low, initializes RobotDyn at phase 0/60 Hz/LINEAR/0%, reapplies
pump 0%, and obtains initial sensor observations before networking. Bus/GPIO
failure retries heater/pump OFF and aborts. No startup path resumes a workflow.

`FailOffPump` maps running to the one 90% cap and OFF to 0%, clamps higher
internal requests, retries OFF after a failed positive write, preserves unknown
output after a failed OFF, and inhibits later positive commands after emergency
shutdown. Percent is a command, not delivered voltage, power, pressure, flow,
or closed-loop regulation. Upstream suppresses TRIAC firing below 3%.

Temperature acquisition, heater control, workflow, and scale run on CPU1.
Wi-Fi/TCP-IP/HTTPS/mDNS/pairing/telemetry/OTA run on CPU0. Sensor clocking, NVS,
JSON serialization, and socket transmission stay outside the bounded control
critical section.

## Dual-temperature control

The channels share only SCK GPIO4 and one critical-section lock. Reads are
sequential every 500 ms. Boiler owns SO5/CS7; Steam owns SO8/CS9. Each channel
independently rejects open-circuit, reserved-bit, transport, non-finite, frame
`0x0000`, and downward jumps greater than 10°C. Exactly 10°C is accepted and a
rejected sample never replaces that sensor's baseline.

- Brew uses calibrated Boiler only.
- Steam uses calibrated Steam only.
- There is no fallback or blending.

One invalid active sample commands heater OFF; three consecutive active
failures latch `sensor_failure`. Invalid inactive input becomes unavailable and
blocks its mode without interrupting the healthy active mode. Switching requires
a current valid destination sample, commands heater OFF, and resets readiness,
duty-window, timeout, and recovery state.

Raw temperature above 135°C from either probe immediately latches a fault with
its source sensor. Brew retains the 98°C active effective limit; Steam faults
strictly above 135°C. Fault/output rules dominate targets and readiness.

Each sensor owns a separate calibration record and raw 90-120°C guided workflow.
The selected raw sensor temporarily controls calibration heating while the other
continues validation and over-temperature protection. Boiler offset constrains
Brew reachability; Steam offset constrains Steam reachability. Steam heat-soak
compensation/decay is removed. Legacy Steam storage keeps only its 1-15 minute
ready timeout.

## Extraction, cooldown, scale, and OTA

Manual, immutable profiles, weighted cutoff/fallback, Stop, and reset behavior
remain firmware-owned. The 250 ms replay includes both nullable temperatures
and real gaps. Cooldown preserves its heater-inhibit/OFF ordering, Brew
threshold, cutoff, stabilization, and no-resume behavior. HX711 uses DT11/SCK12
with bounded availability/delays. OTA remains fail-off and CPU0 networking-owned.

## Mobile and simulator

Mobile always labels Boiler and Steam, emphasizes the active sensor, draws
independent nullable chart segments, and exposes two sensor-qualified calibration
actions through one screen. Steam settings contain only ready timeout.

Temperature history uses SQLite v8. Old rows retain Boiler and set Steam NULL;
obsolete compensation metadata is dropped. Shot traces add nullable Steam
without rewriting older rows. Both CSV families export both values.

The simulator mirrors independent raw readings, offsets, availability, fault
injection, persistence, active-sensor selection, and global calibration
exclusivity. Its manually advanced thermal model is development evidence only.

## Persistence

| State | Owner | Power-cycle behavior |
| --- | --- | --- |
| Brew/Steam targets | firmware NVS | retained |
| Boiler/Steam calibration | separate firmware NVS | retained; corruption faults off |
| Steam ready timeout | firmware NVS | retained; legacy fields discarded |
| Mode/readiness/faults/workflows/commands | firmware RAM | reset; boots Brew/workflows OFF |
| Pairing clients/certificate | firmware NVS v4 namespace | retained; v3 credentials not reused |
| Mobile selected device/token | SecureStore | S3/v4 requires fresh pairing |
| Mobile temperature history | SQLite v8 | legacy Steam remains NULL |
| Mobile shots/traces | SQLite | legacy Steam remains NULL |

## Verification and physical boundary

Protocol, simulator, mobile, C++/sanitizer tests, captures, and an ESP-IDF S3
build are software evidence. They do not prove probe isolation, GPIO boot
levels, USB recovery, zero-cross timing, TRIAC cessation, SSR interruption,
pressure, thermal response, grounding, enclosure, or mains safety.

Before control-capable flashing, confirm the exact 44-pin board exposes every
selected GPIO and both probes are electrically ungrounded. With heater/pump
loads disconnected, verify simultaneous stability/isolation, CS/SCK/SO
waveforms, boot/reset pulse absence, native USB recovery, ZC detection, 0%
cessation, and 90% timing. Dual-probe interference blocks Steam control. Prior
C3, one-sensor, pump-SSR, heater-SSR, and RobotDyn acceptance does not validate
this generation.
