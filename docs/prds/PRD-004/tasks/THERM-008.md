# THERM-008 — Expose firmware API v2 and OLED workflow state

Status: Done
Review Mode: Agent
Review Reason: Strict parsing/serialization, route behavior, captures, and command-state display mapping are deterministic and testable without hardware.

## Goal

Expose the integrated compensation and cooldown policies through strict independent C++ API v2 handling and truthful OLED state.

## Scope

- Add cooldown Start/Stop routing, parsing, idempotency, conflicts, and serialization.
- Extend combined state with contract-valid compensation and cooldown snapshots.
- Enforce Steam/extraction/workflow conflicts at the authoritative firmware API boundary.
- Render compact compensation/cooldown phase and command wording on OLED without claiming flow or de-energization.
- Add host API tests and contract captures for success, replay, conflicts, failures, and exact states.

## Non-Scope

- Contract redesign, mobile changes, runtime tuning, or physical OLED/GPIO acceptance.

## Implementation Plan

1. Implement strict request parsing and response serialization from THERM-001.
2. Route operations through the bounded coordinator without holding locks during transmission.
3. Add OLED mapping from acknowledged controller snapshots.
4. Generate and validate firmware captures against the shared contract.

## Acceptance Criteria

- [x] Firmware independently rejects unknown/malformed input and returns every contracted conflict shape.
- [x] Same-key cooldown replay and idempotent Stop serialize acknowledged original state correctly.
- [x] Combined state and OLED agree on workflow/command state without physical claims.
- [x] API v1 parsing, serialization, routes, and captures remain unchanged.
- [x] Strict host API tests and all firmware contract captures pass.

## Verification Strategy

- Run strict C++ host tests, route/capture generation, OpenAPI fixture validation, and protocol drift checks.

## Dependencies

- THERM-007.

## Files Expected To Change

- `firmware/espresso-machine/components/networking/`
- `firmware/espresso-machine/components/peripherals/`
- `firmware/espresso-machine/main/`
- `firmware/espresso-machine/host-tests/`
- `packages/protocol/fixtures/firmware/`

## Completion Evidence

### Changed behavior

- Firmware now independently parses and serves strict authenticated
  `/api/v2/cooldowns/start` and `/api/v2/cooldowns/stop` routes. Start maps
  malformed keys, active extraction/cooldown, invalid sensor, machine fault,
  target-not-required, replay, and output failure to the contracted shapes.
- API v2 combined state now atomically acknowledges `machine`, `extraction`,
  `compensation`, and `cooldown`. Compensation is active only for acknowledged
  Manual/main extraction when the controller's private duty bias is eligible.
- Same-key active and terminal cooldown replay preserves the original ID and
  deadline. Stop is idle-safe, begins or continues the original stabilization
  deadline, and extraction Stop cannot interrupt a cooldown-owned pump command.
- Profile replacement and extraction Start return an `activeCooldown` conflict
  without advancing the idle extraction controller over the shared pump.
- OLED line four now uses compact command wording: `PUMP CMD ...` with `+2C`
  only for active compensation, `COOL CMD PUMP RUN` while cooldown commands the
  pump running, and `STAB CMD PUMP OFF` during stabilization.
- ESP-IDF HTTP registration now includes the two additive v2 cooldown routes.

### Decisions

- Cooldown eligibility reads a controller-owned validated raw/Brew-effective
  sample even when the current acknowledged mode is Steam; the cooldown policy
  then switches to Brew before its ordered heater-off/pump-running sequence.
- Active cooldown advancement takes priority over extraction advancement
  anywhere the shared pump is observed. Idle workflow snapshots report the
  command owned by that workflow, so extraction running cannot make an idle
  cooldown falsely report `running`.
- Terminal elapsed serialization is bounded to the contract's 50-second
  maximum even when a host/runtime update is delivered late; late work never
  extends the output deadlines.
- API response serialization and OLED rendering use copied acknowledged
  snapshots after releasing the workflow mutex.

### Compatibility and safety impact

- API v1 route registration, parsing, success shapes, error envelope, and
  generated captures remain unchanged. API v2 changes are strict and additive.
- OLED and API say only that firmware issued `running`/`off` commands. They do
  not claim pump flow, current, cooling, SSR state, switch position, or physical
  de-energization.
- Cooldown never modifies the user's heater permission. Active cooldown state
  requires Brew, idle extraction, inactive compensation, a heater-off command,
  no fault, and the appropriate transient inhibit.
- Output Start failure produces a retained failed cooldown plus a machine
  fault; reset/power loss still returns the initial idle/off shape.

### Verification evidence

- Fresh strict C++17 `-Wall -Wextra -Werror` build passed and CTest passed 4/4.
- Host API tests cover strict bodies, authentication, Brew/Steam eligibility,
  compensation state, new/replayed/competing cooldown Start, extraction/profile
  conflicts, Stop/stabilization/terminal replay, sensor/fault/not-required and
  output failures, shared-pump ownership, and unchanged v1 behavior.
- OLED host tests assert exact compact command strings for extraction,
  compensation, cooldown pumping, and stabilization.
- Generated firmware validation passed all 26 captures against strict Zod
  schemas, including active/terminal replay, conflicts, error states,
  compensation, cooldown combined state, and retained failed state.
- OpenAPI validation passed; protocol passed 111 tests/224 expectations and
  protocol TypeScript typecheck passed.

### Checks not run

- ESP-IDF 6.0.2 target build remains unavailable because `idf.py` and
  `IDF_PATH` are absent. No SDK, package, CLI, or dependency was installed.
- Physical OLED/GPIO/SSR/pump behavior was not tested and is not inferred from
  host, capture, simulator, or command-state evidence.

### Remaining blockers and human acceptance

- No Agent blocker remains for THERM-008.
- Cross-layer regression/documentation remains THERM-009. THERM-010 and
  THERM-011 remain deferred Human gates with no supplied physical evidence or
  energized authorization.
