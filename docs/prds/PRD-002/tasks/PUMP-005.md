# PUMP-005 — Add firmware pump output and profile storage

Status: Done
Review Mode: Agent
Review Reason: Pure peripheral policies, NVS atomicity, startup ordering, and GPIO adapter behavior can be covered by host tests and target compilation.

## Goal

Add fail-off GPIO10 pump command ownership and atomic four-slot profile persistence without coupling them to extraction policy.

## Scope

- Add approved GPIO10 active-high configuration and earliest practical startup-off ordering.
- Add a dedicated pump output abstraction that reports firmware command state only.
- Handle GPIO configure/write failures through existing internal-error behavior without new physical-status claims.
- Add strict pure-C++ profile validation and one-blob atomic NVS persistence with seeded defaults.
- Keep pump and heater SSR abstractions, leases, and state independent.

## Non-Scope

- Extraction phase policy, HTTP endpoints, mobile UI, or energized pump testing.

## Implementation Plan

1. Add configuration constants and host-testable profile types/validation.
2. Add profile backend/storage policy with corruption and failed-save handling.
3. Add pump digital-output wrapper and ESP-IDF GPIO10 adapter.
4. Wire startup to command pump off before noncritical initialization.

## Acceptance Criteria

- [x] GPIO10 is commanded low before output configuration and before networking/display startup.
- [x] Boot never restores an active pump command.
- [x] Valid profile sets persist atomically; corrupt or failed storage never produces a partial set.
- [x] Output failures end in the firmware `off` command state plus internal-error handling without claiming physical de-energization.
- [x] Heater GPIO20 behavior remains unchanged and independent.
- [x] Peripheral host tests and strict C++ checks pass; the pinned ESP-IDF target build is explicitly deferred because `idf.py` is unavailable.

## Verification Strategy

- Host fakes for stuck/failing writes, corrupt NVS, interrupted save, defaults, and reinitialization; target build for GPIO/NVS adapters.

## Dependencies

- PUMP-004.

## Files Expected To Change

- `firmware/espresso-machine/components/firmware_config/`
- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/host-tests/`
- `firmware/espresso-machine/main/`

## Implementation Record

### Changed behavior

- Added approved active-high GPIO10 pump configuration and a dedicated `FailOffPump` command wrapper independent from the heater SSR and its GPTimer safety lease.
- Firmware now commands GPIO10 low before output configuration and again afterward, before heater, storage, sensor, display, or networking initialization. Boot never restores a running command, and PUMP-005 adds no path that commands the pump on.
- Added pure C++ four-slot profile types, seeded defaults, strict ASCII/timing/empty-slot validation, and a complete-set storage policy.
- Added an ESP-IDF NVS backend that stores the ordered profile set as one versioned blob under one key and commits only validated complete sets.
- Startup initializes missing profile storage from defaults and aborts with pump/heater off commands when profile storage is unavailable, corrupt, or invalid.

### Decisions made

- Kept pump command state as `off`/`running` rather than reusing heater `enabled` or its lease; this preserves independent ownership and avoids implying physical feedback.
- Used a fixed versioned binary blob with a magic header and exact byte count. Invalid configured flags, names, padding, timing combinations, or aggregate duration are rejected as one corrupt set.
- Retained seeded profiles `Classic30` and `Pre5Soak5` plus two canonical empty slots to match API v2; firmware does not yet expose or execute them.
- A failed write always leaves the wrapper command state at `off` and attempts an off write, even though a host fake demonstrates that the physical level can remain high when the write fails.

### Safety and compatibility impact

- API v1 and firmware temperature-control behavior are unchanged. Firmware API v2 and extraction policy remain outside PUMP-005 and are not implemented here.
- `running` and `off` describe only the GPIO10 command. No pump current, SSR output, series-switch position, pressure, flow, or physical de-energization is measured.
- GPIO10 remains uncontrolled during reset/boot ROM before application startup; the software ordering reduces application-startup exposure but cannot remove that physical risk.
- Heater GPIO20 retains its separate abstraction and safety lease. Existing heater and mains-safety findings remain unresolved.

### Verification evidence

- PASS — `cmake -S firmware/espresso-machine/host-tests -B /tmp/philcoino-pump005-host-tests`.
- PASS — `cmake --build /tmp/philcoino-pump005-host-tests` with C++17 `-Wall -Wextra -Werror` (4 targets built).
- PASS — `ctest --test-dir /tmp/philcoino-pump005-host-tests --output-on-failure` (4/4 tests).
- PASS — `/tmp/philcoino-pump005-host-tests/firmware_api_test /tmp/philcoino-pump005-firmware-contract`.
- PASS — `bun run firmware/espresso-machine/host-tests/validate_contract.ts /tmp/philcoino-pump005-firmware-contract` (8 captures).
- PASS — `bun run --cwd apps/mobile test` (77 tests, 248 expectations).
- PASS — `bun run typecheck` and `bun run lint`.
- PASS — `bun run test:simulator` (43 tests, 212 expectations) and `bun run typecheck:simulator`.
- PASS — `bun run test:protocol` (69 tests, 143 expectations), `bun run typecheck:protocol`, and `bun run validate:openapi`.
- PASS — `bun run --cwd apps/mobile expo config --type public` (Expo SDK 54 config resolved).
- PASS — `EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE=1 bun run --cwd apps/mobile expo export --platform web --output-dir /tmp/philcoino-pump005-web` (3 static routes exported).

### Checks not run

- The pinned ESP-IDF 6.0.2 target build was not run because `idf.py` is unavailable in the active environment. No SDK, CLI, or dependency was installed.
- No GPIO10 target runtime, reset/power-cycle, disconnected low-voltage, physical mobile, pump/SSR, flow/current, or energized test was run.

### Remaining blockers or human acceptance

- None for PUMP-005 software scope. The ESP-IDF target build and PUMP-009 disconnected low-voltage/human acceptance remain required later.
- PUMP-006 through PUMP-009 were not started as part of this requested range.
