import { beforeEach, describe, expect, it } from "bun:test";
import {
  ApiV2ErrorResponseSchema,
  CooldownActiveConflictResponseSchema,
  CooldownStateSchema,
  ExtractionActiveConflictResponseSchema,
  MachineStateV2Schema,
  ProfileSetSchema,
} from "@philcoino/protocol";

import {
  createSimulator,
  DEFAULT_SIMULATOR_TOKEN,
  type SimulatorApplication,
} from "../src/app.ts";

const authorization = { Authorization: `Bearer ${DEFAULT_SIMULATOR_TOKEN}` };
let simulator: SimulatorApplication;

beforeEach(() => {
  simulator = createSimulator();
});

describe("API v2 extraction thermal eligibility and compensation", () => {
  it("activates compensation only for Manual and profile main extraction", async () => {
    await setTemperature(94);
    await startExtraction("manual-compensation-01", { kind: "manual" });
    let state = await getStateV2();
    expect(state).toMatchObject({
      machine: { brewTargetC: 93, heaterActive: true },
      extraction: { phase: "manual" },
      compensation: { status: "active", phase: "manual" },
    });

    await setHeaterEnabled(false);
    state = await getStateV2();
    expect(state.extraction.status).toBe("running");
    expect(state.compensation).toEqual({ status: "inactive", phase: null });

    await stopExtraction();
    await setHeaterEnabled(true);
    await startExtraction("profile-compensation-1", {
      kind: "profile",
      profileId: "profile-2",
    });
    expect((await getStateV2()).compensation).toEqual({
      status: "inactive",
      phase: null,
    });
    await advance(5_000);
    expect((await getStateV2()).extraction).toMatchObject({ phase: "soak" });
    expect((await getStateV2()).compensation).toEqual({
      status: "inactive",
      phase: null,
    });
    await advance(5_000);
    expect(await getStateV2()).toMatchObject({
      machine: { brewTargetC: 93 },
      extraction: { phase: "main-extraction" },
      compensation: { status: "active", phase: "main-extraction" },
    });
  });

  it("rejects extraction Start in Steam and rejects entering Steam while active", async () => {
    await setMode("steam");
    let response = await simulator.app.request(
      "/api/v2/extractions/start",
      jsonRequest("POST", {
        idempotencyKey: "steam-extraction-001",
        selection: { kind: "manual" },
      }),
    );
    expect(response.status).toBe(409);
    expect(ApiV2ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "brew_mode_required",
    );

    await setMode("brew");
    await startExtraction("brew-extraction-001", { kind: "manual" });
    response = await modeRequest("steam");
    expect(response.status).toBe(409);
    expect((await getStateV2()).machine.activeMode).toBe("brew");
  });

  it("keeps an active extraction pump independent from a temperature fault", async () => {
    await startExtraction("fault-compensation-1", { kind: "manual" });
    await control("PUT", "/_simulator/fault", { code: "sensor_failure" });
    await advance(1_000);
    const state = await getStateV2();
    expect(state).toMatchObject({
      machine: { status: "fault", heaterActive: false },
      extraction: { status: "running", pumpCommand: "running" },
      compensation: { status: "inactive", phase: null },
    });
  });
});

describe("API v2 deterministic cooldown", () => {
  it("switches to Brew, snapshots the target, and preserves disabled permission", async () => {
    await setTemperature(110);
    await setMode("steam");
    await setHeaterEnabled(false);
    const cooldown = await startCooldown("cooldown-disabled-01");
    expect(cooldown).toMatchObject({
      status: "pumping",
      brewTargetC: 93,
      elapsedMs: 0,
      remainingMs: 45_000,
      pumpCommand: "running",
      heaterInhibited: true,
    });
    expect(await getStateV2()).toMatchObject({
      machine: {
        activeMode: "brew",
        heaterEnabled: false,
        heaterActive: false,
      },
      compensation: { status: "inactive" },
    });
  });

  it("stops at the first target sample and stabilizes for exactly five seconds", async () => {
    await setTemperature(1000);
    await startCooldown("cooldown-target-001");
    await advance(1_234);
    await setTemperature(93.1);
    expect((await getStateV2()).cooldown).toMatchObject({
      status: "pumping",
      elapsedMs: 1_234,
    });
    await setTemperature(93);
    expect((await getStateV2()).cooldown).toMatchObject({
      status: "stabilizing",
      elapsedMs: 1_234,
      remainingMs: 5_000,
      pumpCommand: "off",
      heaterInhibited: true,
      outcome: "target-reached",
    });
    await advance(4_999);
    expect((await getStateV2()).cooldown).toMatchObject({
      status: "stabilizing",
      remainingMs: 1,
    });
    await advance(1);
    expect((await getStateV2()).cooldown).toMatchObject({
      status: "idle",
      elapsedMs: 6_234,
      pumpCommand: "off",
      heaterInhibited: false,
      outcome: "target-reached",
    });
  });

  it("cuts the pump command off at exactly 45 seconds", async () => {
    await setTemperature(1000);
    await startCooldown("cooldown-cutoff-001");
    await advance(44_999);
    expect((await getStateV2()).cooldown).toMatchObject({
      status: "pumping",
      elapsedMs: 44_999,
      remainingMs: 1,
      pumpCommand: "running",
    });
    await advance(1);
    expect((await getStateV2()).cooldown).toMatchObject({
      status: "stabilizing",
      elapsedMs: 45_000,
      remainingMs: 5_000,
      pumpCommand: "off",
      outcome: "cutoff",
    });
    await advance(5_000);
    expect((await getStateV2()).cooldown).toMatchObject({
      status: "idle",
      elapsedMs: 50_000,
      outcome: "cutoff",
    });
  });

  it("makes Stop idempotent and preserves the stabilization deadline", async () => {
    await setTemperature(1000);
    await startCooldown("cooldown-stop-0001");
    await advance(12_345);
    const first = await stopCooldown();
    expect(first).toMatchObject({
      status: "stabilizing",
      elapsedMs: 12_345,
      remainingMs: 5_000,
      outcome: "stopped",
    });
    expect(await stopCooldown()).toEqual(first);
    await advance(5_000);
    expect(await stopCooldown()).toMatchObject({
      status: "idle",
      elapsedMs: 17_345,
      outcome: "stopped",
    });
  });

  it("replays active and terminal identity without restarting time", async () => {
    await setTemperature(1000);
    const first = await startCooldown("cooldown-replay-01");
    await advance(12_345);
    const replay = await startCooldown("cooldown-replay-01");
    expect(replay).toMatchObject({
      cooldownId: first.cooldownId,
      elapsedMs: 12_345,
      remainingMs: 32_655,
    });

    let response = await simulator.app.request(
      "/api/v2/cooldowns/start",
      jsonRequest("POST", { idempotencyKey: "cooldown-compete-1" }),
    );
    expect(response.status).toBe(409);
    expect(
      CooldownActiveConflictResponseSchema.parse(await response.json())
        .activeCooldown.elapsedMs,
    ).toBe(12_345);

    await stopCooldown();
    await advance(5_000);
    const terminal = await startCooldown("cooldown-replay-01");
    expect(terminal).toMatchObject({
      status: "idle",
      cooldownId: first.cooldownId,
      outcome: "stopped",
    });

    response = await simulator.app.request(
      "/api/v2/cooldowns/start",
      jsonRequest("POST", { idempotencyKey: "cooldown-new-after-1" }),
    );
    expect(response.status).toBe(200);
    expect(CooldownStateSchema.parse(await response.json())).toMatchObject({
      status: "pumping",
    });
  });

  it("enforces workflow mutual exclusion for extraction, profiles, and Steam", async () => {
    await setTemperature(1000);
    await startCooldown("cooldown-conflict-1");

    let response = await simulator.app.request(
      "/api/v2/extractions/start",
      jsonRequest("POST", {
        idempotencyKey: "extract-during-cd-1",
        selection: { kind: "manual" },
      }),
    );
    expect(response.status).toBe(409);
    expect(
      CooldownActiveConflictResponseSchema.parse(await response.json()).error.code,
    ).toBe("cooldown_active");

    const profiles = await getProfiles();
    response = await simulator.app.request(
      "/api/v2/profiles",
      jsonRequest("PUT", profiles),
    );
    expect(response.status).toBe(409);
    expect(
      CooldownActiveConflictResponseSchema.parse(await response.json()).error.code,
    ).toBe("cooldown_active");

    response = await modeRequest("steam");
    expect(response.status).toBe(409);
    expect((await getStateV2()).machine.activeMode).toBe("brew");
  });

  it("keeps retained workflow commands isolated across shared-pump handoffs", async () => {
    await startExtraction("extract-before-cool-01", { kind: "manual" });
    await advance(1_000);
    await stopExtraction();
    await setTemperature(1000);
    const started = await startCooldown("cooldown-owner-isolation");

    let state = await getStateV2();
    expect(state).toMatchObject({
      extraction: {
        status: "idle",
        outcome: "stopped",
        pumpCommand: "off",
      },
      cooldown: {
        cooldownId: started.cooldownId,
        status: "pumping",
        pumpCommand: "running",
      },
    });

    await stopCooldown();
    await advance(5_000);
    await startExtraction("extract-after-cool-001", { kind: "manual" });
    const idleStop = await stopCooldown();
    expect(idleStop).toMatchObject({
      cooldownId: started.cooldownId,
      status: "idle",
      pumpCommand: "off",
    });
    state = await getStateV2();
    expect(state).toMatchObject({
      extraction: { status: "running", pumpCommand: "running" },
      cooldown: { status: "idle", pumpCommand: "off" },
    });

    const replay = await startCooldown("cooldown-owner-isolation");
    expect(replay).toMatchObject({
      cooldownId: started.cooldownId,
      status: "idle",
      pumpCommand: "off",
    });
    expect((await getStateV2()).extraction).toMatchObject({
      status: "running",
      pumpCommand: "running",
    });
  });

  it("rejects ineligible temperature and distinguishable faults", async () => {
    let response = await simulator.app.request(
      "/api/v2/cooldowns/start",
      jsonRequest("POST", { idempotencyKey: "cooldown-not-needed" }),
    );
    expect(response.status).toBe(409);
    expect(ApiV2ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "cooldown_not_required",
    );

    await control("PUT", "/_simulator/fault", { code: "sensor_failure" });
    response = await simulator.app.request(
      "/api/v2/cooldowns/start",
      jsonRequest("POST", { idempotencyKey: "cooldown-no-sensor" }),
    );
    expect(ApiV2ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "sensor_unavailable",
    );

    await simulator.app.request("/_simulator/power-cycle", { method: "POST" });
    await control("PUT", "/_simulator/fault", { code: "internal_error" });
    response = await simulator.app.request(
      "/api/v2/cooldowns/start",
      jsonRequest("POST", { idempotencyKey: "cooldown-machine-fault" }),
    );
    expect(ApiV2ErrorResponseSchema.parse(await response.json()).error.code).toBe(
      "machine_faulted",
    );
  });

  it("continues on manual time without a phone and never resumes after reset", async () => {
    await setTemperature(1000);
    await startCooldown("cooldown-disconnect-1");
    simulator.machine.advance(45_000);
    expect(simulator.machine.getCooldownState()).toMatchObject({
      status: "stabilizing",
      outcome: "cutoff",
    });
    simulator.machine.advance(5_000);
    expect(simulator.machine.getCooldownState()).toMatchObject({
      status: "idle",
      outcome: "cutoff",
    });

    await setTemperature(1000);
    await startCooldown("cooldown-reset-0001");
    await simulator.app.request("/_simulator/power-cycle", { method: "POST" });
    expect((await getStateV2()).cooldown).toEqual({
      status: "idle",
      cooldownId: null,
      brewTargetC: null,
      elapsedMs: 0,
      remainingMs: null,
      pumpCommand: "off",
      heaterInhibited: false,
      outcome: null,
    });
  });

  it("aborts on sensor or output failure with off command state", async () => {
    await setTemperature(1000);
    await startCooldown("cooldown-sensor-abort");
    await control("PUT", "/_simulator/fault", { code: "sensor_failure" });
    expect(await getStateV2()).toMatchObject({
      machine: { status: "fault", heaterActive: false },
      cooldown: { status: "idle", pumpCommand: "off", outcome: "failed" },
    });

    await simulator.app.request("/_simulator/power-cycle", { method: "POST" });
    await setTemperature(1000);
    await failNextOutput("heater-off");
    let response = await simulator.app.request(
      "/api/v2/cooldowns/start",
      jsonRequest("POST", { idempotencyKey: "cooldown-heater-fail" }),
    );
    expect(response.status).toBe(500);
    expect(await getStateV2()).toMatchObject({
      machine: { status: "fault", heaterActive: false },
      cooldown: { status: "idle", pumpCommand: "off", outcome: "failed" },
    });

    await simulator.app.request("/_simulator/power-cycle", { method: "POST" });
    await setTemperature(1000);
    await failNextOutput("pump-running");
    response = await simulator.app.request(
      "/api/v2/cooldowns/start",
      jsonRequest("POST", { idempotencyKey: "cooldown-pump-fail-1" }),
    );
    expect(response.status).toBe(500);
    expect((await getStateV2()).cooldown).toMatchObject({
      status: "idle",
      pumpCommand: "off",
      outcome: "failed",
    });

    await simulator.app.request("/_simulator/power-cycle", { method: "POST" });
    await setTemperature(1000);
    await startCooldown("cooldown-off-fail-1");
    await failNextOutput("pump-off");
    response = await simulator.app.request("/api/v2/cooldowns/stop", {
      headers: authorization,
      method: "POST",
    });
    expect(response.status).toBe(500);
    expect((await getStateV2()).cooldown).toMatchObject({
      status: "idle",
      pumpCommand: "off",
      outcome: "failed",
    });
  });

  it("rejects malformed Start and cooldown Start during extraction", async () => {
    let response = await simulator.app.request(
      "/api/v2/cooldowns/start",
      jsonRequest("POST", { idempotencyKey: "short" }),
    );
    expect(response.status).toBe(400);

    await startExtraction("active-extraction-1", { kind: "manual" });
    response = await simulator.app.request(
      "/api/v2/cooldowns/start",
      jsonRequest("POST", { idempotencyKey: "cooldown-extract-01" }),
    );
    expect(response.status).toBe(409);
    expect(
      ExtractionActiveConflictResponseSchema.parse(await response.json()).error.code,
    ).toBe("extraction_active");
  });
});

async function getStateV2() {
  const response = await simulator.app.request("/api/v2/state", {
    headers: authorization,
  });
  expect(response.status).toBe(200);
  return MachineStateV2Schema.parse(await response.json());
}

async function getProfiles() {
  const response = await simulator.app.request("/api/v2/profiles", {
    headers: authorization,
  });
  return ProfileSetSchema.parse(await response.json());
}

async function startExtraction(
  idempotencyKey: string,
  selection: { kind: "manual" } | { kind: "profile"; profileId: "profile-2" },
) {
  const response = await simulator.app.request(
    "/api/v2/extractions/start",
    jsonRequest("POST", { idempotencyKey, selection }),
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function stopExtraction() {
  const response = await simulator.app.request("/api/v2/extractions/stop", {
    headers: authorization,
    method: "POST",
  });
  expect(response.status).toBe(200);
}

async function startCooldown(idempotencyKey: string) {
  const response = await simulator.app.request(
    "/api/v2/cooldowns/start",
    jsonRequest("POST", { idempotencyKey }),
  );
  expect(response.status).toBe(200);
  return CooldownStateSchema.parse(await response.json());
}

async function stopCooldown() {
  const response = await simulator.app.request("/api/v2/cooldowns/stop", {
    headers: authorization,
    method: "POST",
  });
  expect(response.status).toBe(200);
  return CooldownStateSchema.parse(await response.json());
}

async function setMode(mode: "brew" | "steam") {
  const response = await modeRequest(mode);
  expect(response.status).toBe(200);
}

function modeRequest(mode: "brew" | "steam") {
  return simulator.app.request(
    "/api/v1/mode",
    jsonRequest("PUT", { mode }),
  );
}

async function setHeaterEnabled(heaterEnabled: boolean) {
  const response = await simulator.app.request(
    "/api/v1/heater",
    jsonRequest("PUT", { heaterEnabled }),
  );
  expect(response.status).toBe(200);
}

async function setTemperature(boilerTemperatureC: number) {
  await control("PUT", "/_simulator/temperatures", { boilerTemperatureC });
}

async function advance(milliseconds: number) {
  await control("POST", "/_simulator/advance", { milliseconds });
}

async function failNextOutput(
  command: "heater-off" | "pump-running" | "pump-off",
) {
  await control("POST", "/_simulator/fail-next-output-command", { command });
}

async function control(method: string, path: string, body: unknown) {
  const response = await simulator.app.request(path, jsonRequest(method, body, false));
  expect(response.status).toBe(200);
  return response;
}

function jsonRequest(method: string, body: unknown, authenticated = true) {
  return {
    body: JSON.stringify(body),
    headers: {
      ...(authenticated ? authorization : {}),
      "Content-Type": "application/json",
    },
    method,
  };
}
