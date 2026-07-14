# THERM-007 — Integrate bounded firmware workflow coordination

Status: Done
Review Mode: Agent
Review Reason: Lock ordering, task deadlines, startup/reset behavior, and output failure paths are code-reviewable and testable at host/target-build level.

## Goal

Integrate compensation and cooldown into the ESP-IDF runtime without allowing cross-domain coordination, HTTP, display, or persistence to extend output deadlines.

## Scope

- Add a single explicit coordination boundary between temperature and pump workflows.
- Enforce Brew-only extraction Start and reject Steam transitions while extraction/cooldown is active.
- Advance cooldown temperature checks, pump cutoff, stabilization, and compensation through bounded synchronization.
- Preserve heater safety lease, dedicated pump timing, boot-off ordering, volatile workflow reset, and single-owner output writes.
- Define fatal/fault handling for missed locks and failed off commands without deadlock-prone nested acquisition.

## Non-Scope

- HTTP route parsing/serialization, mobile behavior, physical timing claims, or energized tests.

## Implementation Plan

1. Define and document lock ownership/order or message/snapshot handoff between domains.
2. Integrate policies into startup and dedicated runtime tasks.
3. Keep network, display, and NVS outside real-time deadlines.
4. Add host seams and run the pinned target build when available.

## Acceptance Criteria

- [x] No unbounded or cyclic cross-domain lock path is introduced.
- [x] Heater pulses, pump cutoff, and stabilization deadlines remain independent of HTTP/display/persistence work.
- [x] Boot/reset/power-cycle state is Brew-compatible, cooldown idle, extraction idle, and both commands off before later startup work.
- [x] Missed synchronization or failed output commands take the documented fail-off/fault path.
- [x] Host tests and the pinned ESP-IDF target build pass, or target-toolchain unavailability is recorded.

## Verification Strategy

- Static lock-order review, host concurrency/failure seams, strict host tests, and ESP-IDF 6.0.2 target build.

## Dependencies

- THERM-006.

## Files Expected To Change

- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/components/control/`
- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/host-tests/`

## Completion Evidence

### Changed behavior

- The FreeRTOS runtime now aliases temperature and extraction API domains to
  one 50 ms bounded workflow mutex. A high-priority 10 ms workflow task owns
  extraction phase advancement, compensation-phase handoff, cooldown
  threshold/cutoff/stabilization advancement, and the workflow failure path.
- Boot initializes pump and heater command wrappers off, constructs Brew/idle
  controllers, resets volatile cooldown state off, samples the sensor, and
  renders the boot state before starting the workflow and network tasks.
- Extraction Start now requires acknowledged Brew mode. Entering Steam is
  rejected while extraction or cooldown is active. These checks execute under
  the same workflow snapshot boundary used by controller transitions.
- A missed mutex deadline immediately attempts both output-off commands and
  posts an atomic fail-safe request. The next successful workflow owner
  latches an internal temperature fault, stops extraction, and aborts active
  cooldown without nested lock acquisition.
- Target persistence was split into a bounded prepare/off transition, NVS save
  outside the workflow mutex, and bounded adoption/acknowledgement. Combined
  API v2 machine/extraction snapshots are now copied under one acquisition;
  serialization remains outside it.

### Decisions

- There is no cross-domain lock order: both legacy domain labels intentionally
  resolve to one non-recursive mutex and callers never acquire it twice.
- Sensor SPI reads, NVS, OLED rendering, Wi-Fi state reads, and HTTP response
  construction/transmission are outside the real-time coordination boundary.
- Cooldown reuses the latest validated controller snapshot at the 10 ms policy
  cadence; thermocouple sampling remains independently bounded at 500 ms.
- THERM-007 wires eligibility and scheduling. Exact cooldown route parsing,
  contracted conflict payloads, combined cooldown serialization, and OLED
  wording remain strictly assigned to THERM-008.

### Compatibility and safety impact

- API v1 paths and successful request/response shapes remain unchanged. Its
  mode endpoint now safely rejects Steam during an active workflow, as required
  by PRD-004.
- Heater permission remains independent from cooldown inhibit. No persistence,
  display, or network work can hold the mutex across the 45-second cutoff or
  five-second stabilization policy update.
- `running` and `off` remain requested GPIO command states only. Off attempts,
  host tests, and scheduling review do not confirm flow, current, cooling, SSR
  state, or physical de-energization.
- Workflow state remains RAM-only and is explicitly reset rather than resumed
  at boot or power loss.

### Verification evidence

- Fresh strict C++17 `-Wall -Wextra -Werror` CMake build passed.
- `ctest --test-dir /tmp/philcoino-host-tests --output-on-failure` passed
  4/4, including Brew-only extraction, Steam rejection during extraction and
  cooldown, cooldown/extraction mutual exclusion, output failures, exact
  deadlines, reset behavior, and existing API v1/v2 regression coverage.
- Static ownership review found one mutex, no nested acquisition, one atomic
  fail-safe handoff, and NVS/rendering/serialization outside the boundary.

### Checks not run

- The ESP-IDF 6.0.2 target build was unavailable because neither `idf.py` nor
  `IDF_PATH` exists in this environment. No SDK or tool was installed.
- Firmware captures and OLED/API cooldown contract validation are deliberately
  deferred to THERM-008. Simulator/mobile and physical checks are outside this
  runtime-integration task.

### Remaining blockers and human acceptance

- No Agent blocker remains for THERM-007.
- THERM-008 must finish strict route/serialization/OLED integration before the
  runtime is contract-complete. THERM-010 and THERM-011 remain deferred Human
  gates; no physical evidence or energized authorization was supplied.
