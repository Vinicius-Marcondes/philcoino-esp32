import { describe, expect, test } from "bun:test";
import type {
  CooldownState,
  ExtractionState,
  HeaterSettingsResponse,
  MachineState,
  Mode,
  ProfileSet,
  TemperatureSettingsResponse,
} from "@philcoino/protocol";

import {
  DashboardMutationSession,
  type DashboardMutationClient,
  type DashboardMutationKind,
  type DashboardMutationState,
} from "../src/dashboard/dashboard-mutation-session";
import { ApiClientError } from "../src/networking/api-client-error";
import type { ConnectionState } from "../src/networking/connection-state";
import {
  DeviceApiClient,
  type FetchImplementation,
} from "../src/networking/device-api-client";
import {
  createSimulator,
  DEFAULT_SIMULATOR_TOKEN,
} from "../../../tools/device-simulator/src/app.ts";

describe("DashboardMutationSession", () => {
  test("shows pending and applies target values only after acknowledgement", async () => {
    const response = deferred<TemperatureSettingsResponse>();
    const client = mutationClient({
      updateTemperatureSettings: () => response.promise,
    });
    const harness = createHarness(client);

    harness.session.start();
    harness.session.updateTemperatureSettings({
      brewTargetC: 94,
      steamTargetC: 116,
    });

    expect(harness.polling.pauses).toBe(1);
    expect(harness.outcomes.at(-1)).toEqual({
      kind: "temperatures",
      state: {
        message:
          "Waiting for the machine to validate and save Brew 94°C and Steam 116°C…",
        status: "pending",
      },
    });
    expect(harness.acknowledgedSettings).toEqual([]);

    response.resolve({ brewTargetC: 94, steamTargetC: 116 });
    await settle();

    expect(harness.acknowledgedSettings).toEqual([
      { brewTargetC: 94, steamTargetC: 116 },
    ]);
    expect(harness.outcomes.at(-1)?.state.status).toBe("acknowledged");
    expect(harness.polling.resumes).toBe(1);
  });

  test("does not expose a requested mode before the response arrives", async () => {
    const response = deferred<{ mode: Mode }>();
    const client = mutationClient({ setMode: () => response.promise });
    const harness = createHarness(client);

    harness.session.start();
    harness.session.setMode("steam");

    expect(harness.acknowledgedModes).toEqual([]);
    expect(harness.outcomes.at(-1)?.state.status).toBe("pending");

    response.resolve({ mode: "steam" });
    await settle();

    expect(harness.acknowledgedModes).toEqual(["steam"]);
    expect(harness.outcomes.at(-1)).toEqual({
      kind: "mode",
      state: {
        message: "Machine acknowledged Steam mode.",
        status: "acknowledged",
      },
    });
  });

  test("replaces the fault snapshot only after over-temperature dismissal acknowledgement", async () => {
    const acknowledgedState: MachineState = {
      activeMode: "brew",
      brewTargetC: 93,
      boilerTemperatureC: 93,
      fault: null,
      heaterEnabled: true,
      heaterActive: false,
      status: "heating",
      steamTargetC: 115,
      steamTimeoutRemainingMs: null,
      uptimeMs: 190_000,
    };
    const response = deferred<MachineState>();
    const client = mutationClient({
      dismissOverTemperature: () => response.promise,
    });
    const harness = createHarness(client);

    harness.session.start();
    harness.session.dismissOverTemperature();

    expect(harness.dismissedFaults).toEqual([]);
    expect(harness.outcomes.at(-1)).toEqual({
      kind: "fault",
      state: {
        message:
          "Waiting for the machine to dismiss the over-temperature limit…",
        status: "pending",
      },
    });

    response.resolve(acknowledgedState);
    await settle();

    expect(harness.dismissedFaults).toEqual([acknowledgedState]);
    expect(harness.outcomes.at(-1)).toEqual({
      kind: "fault",
      state: {
        message:
          "Machine dismissed the over-temperature limit and resumed normal control.",
        status: "acknowledged",
      },
    });
  });

  test("keeps an authoritative firmware rejection visible", async () => {
    const client = mutationClient({
      setMode: async () => {
        throw new ApiClientError("http", "rejected", {
          response: {
            error: {
              code: "sensor_unavailable",
              message: "Clear the latched sensor fault before changing mode.",
            },
          },
          status: 409,
        });
      },
    });
    const harness = createHarness(client);

    harness.session.start();
    harness.session.setMode("steam");
    await settle();

    expect(harness.acknowledgedModes).toEqual([]);
    expect(harness.connections).toEqual([]);
    expect(harness.outcomes.at(-1)).toEqual({
      kind: "mode",
      state: {
        message: "The requested change is unavailable in the machine’s current state.",
        status: "rejected",
      },
    });
  });

  test("does not expose a requested heater permission before acknowledgement", async () => {
    const response = deferred<HeaterSettingsResponse>();
    const client = mutationClient({ setHeaterEnabled: () => response.promise });
    const harness = createHarness(client);

    harness.session.start();
    harness.session.setHeaterEnabled(false);

    expect(harness.acknowledgedHeaterSettings).toEqual([]);
    expect(harness.outcomes.at(-1)).toEqual({
      kind: "heater",
      state: {
        message: "Waiting for the machine to turn heater output off...",
        status: "pending",
      },
    });

    response.resolve({ heaterEnabled: false });
    await settle();

    expect(harness.acknowledgedHeaterSettings).toEqual([
      { heaterEnabled: false },
    ]);
    expect(harness.outcomes.at(-1)).toEqual({
      kind: "heater",
      state: {
        message: "Machine turned heater output off.",
        status: "acknowledged",
      },
    });
  });


  test("dismisses visible mutation feedback without cancelling the active request", async () => {
    const response = deferred<TemperatureSettingsResponse>();
    const client = mutationClient({
      updateTemperatureSettings: () => response.promise,
    });
    const harness = createHarness(client);

    harness.session.start();
    harness.session.updateTemperatureSettings({ brewTargetC: 95 });
    harness.session.dismissMutation("temperatures");

    expect(harness.outcomes.at(-1)).toEqual({
      kind: "temperatures",
      state: {
        message: "",
        status: "idle",
      },
    });
    expect(harness.polling.resumes).toBe(0);

    response.resolve({ brewTargetC: 95, steamTargetC: 115 });
    await settle();

    expect(harness.acknowledgedSettings).toEqual([
      { brewTargetC: 95, steamTargetC: 115 },
    ]);
    expect(harness.outcomes.at(-1)).toEqual({
      kind: "temperatures",
      state: {
        message: "Machine saved Brew 95°C and Steam 115°C.",
        status: "acknowledged",
      },
    });
    expect(harness.polling.resumes).toBe(1);
  });

  test("reports a disconnect without applying a false success", async () => {
    const client = mutationClient({
      updateTemperatureSettings: async () => {
        throw new ApiClientError("offline", "socket closed");
      },
    });
    const harness = createHarness(client);

    harness.session.start();
    harness.session.updateTemperatureSettings({ brewTargetC: 95 });
    await settle();

    expect(harness.acknowledgedSettings).toEqual([]);
    expect(harness.connections).toEqual([{ status: "offline" }]);
    expect(harness.outcomes.at(-1)?.state).toEqual({
      message:
        "Connection to the machine was lost before acknowledgement. No change is shown.",
      status: "disconnected",
    });
  });

  test("ignores a late response after the active screen stops", async () => {
    const response = deferred<{ mode: Mode }>();
    const client = mutationClient({ setMode: () => response.promise });
    const harness = createHarness(client);

    harness.session.start();
    harness.session.setMode("steam");
    harness.session.stop();
    response.resolve({ mode: "steam" });
    await settle();

    expect(harness.acknowledgedModes).toEqual([]);
    expect(harness.outcomes.at(-1)?.state.status).toBe("pending");
    expect(harness.polling.resumes).toBe(0);
  });

  test("reuses one Start key after an unacknowledged retry and publishes only the acknowledgement", async () => {
    const requests: string[] = [];
    let attempt = 0;
    const client = mutationClient({
      startExtraction: async (request) => {
        requests.push(request.idempotencyKey);
        attempt += 1;
        if (attempt === 1) {
          throw new ApiClientError("offline", "socket closed");
        }
        return {
          status: "running",
          extractionId: "retry-run-1",
          selection: { kind: "manual" },
          phase: "manual",
          elapsedMs: 5_000,
          remainingMs: 55_000,
          pumpCommand: "running",
        };
      },
    });
    const harness = createHarness(client, () => "stable-start-key-01");
    harness.session.start();

    harness.session.startExtraction({ kind: "manual" });
    await settle();
    expect(harness.acknowledgedExtractions).toEqual([]);
    expect(harness.outcomes.at(-1)?.state.status).toBe("disconnected");

    harness.session.startExtraction({ kind: "manual" });
    await settle();
    expect(requests).toEqual(["stable-start-key-01", "stable-start-key-01"]);
    expect(harness.acknowledgedExtractions).toHaveLength(1);
    expect(harness.acknowledgedExtractions[0]).toMatchObject({
      extractionId: "retry-run-1",
      elapsedMs: 5_000,
      status: "running",
    });
  });

  test("uses a fresh Start key after a detected device reboot", async () => {
    const requests: string[] = [];
    const keys = ["pre-reboot-key-01", "post-reboot-key-1"];
    const client = mutationClient({
      startExtraction: async (request) => {
        requests.push(request.idempotencyKey);
        throw new ApiClientError("offline", "socket closed");
      },
    });
    const harness = createHarness(client, () => keys.shift() ?? "unexpected-key");
    harness.session.start();

    harness.session.startExtraction({ kind: "manual" });
    await settle();
    harness.session.handleDeviceRestart();
    harness.session.startExtraction({ kind: "manual" });
    await settle();

    expect(requests).toEqual(["pre-reboot-key-01", "post-reboot-key-1"]);
  });

  test("publishes cooldown state only after acknowledgement and reuses its key after transport loss", async () => {
    const requests: string[] = [];
    const acknowledged: CooldownState = {
      status: "pumping",
      cooldownId: "cooldown-test-1",
      brewTargetC: 93,
      elapsedMs: 0,
      remainingMs: 45_000,
      pumpCommand: "running",
      heaterInhibited: true,
      outcome: null,
    };
    let attempt = 0;
    const client = mutationClient({
      startCooldown: async (request) => {
        requests.push(request.idempotencyKey);
        attempt += 1;
        if (attempt === 1) {
          throw new ApiClientError("offline", "socket closed");
        }
        return acknowledged;
      },
    });
    const harness = createHarness(
      client,
      undefined,
      () => "stable-cooldown-key-01",
    );
    harness.session.start();

    harness.session.startCooldown();
    await settle();
    expect(harness.acknowledgedCooldowns).toEqual([]);
    expect(harness.outcomes.at(-1)?.state.status).toBe("disconnected");

    harness.session.startCooldown();
    await settle();
    expect(requests).toEqual([
      "stable-cooldown-key-01",
      "stable-cooldown-key-01",
    ]);
    expect(harness.acknowledgedCooldowns).toEqual([acknowledged]);
    expect(harness.outcomes.at(-1)?.state.status).toBe("acknowledged");
  });

  test("serializes cooldown Stop and applies its stabilizing acknowledgement", async () => {
    const response = deferred<CooldownState>();
    const client = mutationClient({ stopCooldown: () => response.promise });
    const harness = createHarness(client);
    harness.session.start();

    harness.session.stopCooldown();
    expect(harness.acknowledgedCooldowns).toEqual([]);
    expect(harness.polling.pauses).toBe(1);
    expect(harness.outcomes.at(-1)?.state.status).toBe("pending");

    response.resolve({
      status: "stabilizing",
      cooldownId: "cooldown-test-2",
      brewTargetC: 93,
      elapsedMs: 12_000,
      remainingMs: 5_000,
      pumpCommand: "off",
      heaterInhibited: true,
      outcome: "stopped",
    });
    await settle();

    expect(harness.acknowledgedCooldowns.at(-1)).toMatchObject({
      status: "stabilizing",
      outcome: "stopped",
      pumpCommand: "off",
    });
    expect(harness.polling.resumes).toBe(1);
  });

  test("uses a fresh cooldown key after an authoritative rejection", async () => {
    const requests: string[] = [];
    const keys = ["cooldown-rejected-01", "cooldown-retry-0002"];
    const client = mutationClient({
      startCooldown: async (request) => {
        requests.push(request.idempotencyKey);
        if (requests.length === 1) {
          throw new ApiClientError("http", "not required", {
            response: {
              error: {
                code: "cooldown_not_required",
                message: "The boiler is already at the Brew target.",
              },
            },
            status: 409,
          });
        }
        return {
          status: "pumping",
          cooldownId: "cooldown-retry-1",
          brewTargetC: 93,
          elapsedMs: 0,
          remainingMs: 45_000,
          pumpCommand: "running",
          heaterInhibited: true,
          outcome: null,
        };
      },
    });
    const harness = createHarness(client, undefined, () => keys.shift()!);
    harness.session.start();

    harness.session.startCooldown();
    await settle();
    expect(harness.outcomes.at(-1)?.state.status).toBe("rejected");

    harness.session.startCooldown();
    await settle();
    expect(requests).toEqual(["cooldown-rejected-01", "cooldown-retry-0002"]);
    expect(harness.acknowledgedCooldowns).toHaveLength(1);
  });

  test("serializes profile export, Start, and Stop with acknowledged state", async () => {
    const client = mutationClient({});
    const harness = createHarness(client, () => "serialized-start-01");
    harness.session.start();

    harness.session.replaceProfiles({
      profiles: [
        { id: "profile-1", profile: null },
        { id: "profile-2", profile: null },
        { id: "profile-3", profile: null },
        { id: "profile-4", profile: null },
      ],
    });
    harness.session.startExtraction({ kind: "manual" });
    await settle();
    expect(harness.acknowledgedProfiles).toHaveLength(1);
    expect(harness.acknowledgedExtractions).toHaveLength(0);

    harness.session.startExtraction({ kind: "manual" });
    await settle();
    expect(harness.acknowledgedExtractions.at(-1)?.status).toBe("running");
    harness.session.stopExtraction();
    await settle();
    expect(harness.acknowledgedExtractions.at(-1)?.status).toBe("idle");
  });

  test("uses validated simulator acknowledgements and rejection payloads", async () => {
    const simulator = createSimulator();
    const request = simulator.app.request.bind(simulator.app);
    const fetch: FetchImplementation = (url, init) =>
      Promise.resolve(
        request(url, {
          body: init.body,
          headers: init.headers,
          method: init.method,
          signal: init.signal,
        }),
      );
    const client = new DeviceApiClient({
      address: "http://127.0.0.1:3000",
      fetch,
      token: DEFAULT_SIMULATOR_TOKEN,
    });
    const harness = createHarness(client);
    harness.session.start();

    harness.session.updateTemperatureSettings({
      brewTargetC: 95,
      steamTargetC: 120,
    });
    await waitFor(() => harness.acknowledgedSettings.length === 1);
    expect(harness.acknowledgedSettings.at(-1)).toEqual({
      brewTargetC: 95,
      steamTargetC: 120,
    });

    harness.session.setHeaterEnabled(false);
    await waitFor(() => harness.acknowledgedHeaterSettings.length === 1);
    expect(harness.acknowledgedHeaterSettings.at(-1)).toEqual({
      heaterEnabled: false,
    });

    simulator.machine.injectFault("sensor_failure");
    harness.session.setMode("steam");
    await waitFor(
      () => harness.outcomes.at(-1)?.state.status === "rejected",
    );

    expect(harness.acknowledgedModes).toEqual([]);
    expect(harness.outcomes.at(-1)?.state).toMatchObject({
      status: "rejected",
    });
  });
});

function createHarness(
  client: DashboardMutationClient,
  startKeyFactory?: () => string,
  cooldownStartKeyFactory?: () => string,
) {
  const acknowledgedCooldowns: CooldownState[] = [];
  const acknowledgedExtractions: ExtractionState[] = [];
  const acknowledgedHeaterSettings: HeaterSettingsResponse[] = [];
  const acknowledgedModes: Mode[] = [];
  const acknowledgedSettings: TemperatureSettingsResponse[] = [];
  const acknowledgedProfiles: ProfileSet[] = [];
  const connections: ConnectionState[] = [];
  const dismissedFaults: MachineState[] = [];
  const outcomes: {
    kind: DashboardMutationKind;
    state: DashboardMutationState;
  }[] = [];
  const polling = {
    pauses: 0,
    resumes: 0,
    pause() {
      this.pauses += 1;
    },
    resume() {
      this.resumes += 1;
    },
  };
  const session = new DashboardMutationSession({
    client,
    onCooldownAcknowledged: (cooldown) =>
      acknowledgedCooldowns.push(cooldown),
    onConnectionLost: (connection) => connections.push(connection),
    onExtractionAcknowledged: (extraction) =>
      acknowledgedExtractions.push(extraction),
    onHeaterAcknowledged: (settings) =>
      acknowledgedHeaterSettings.push(settings),
    onModeAcknowledged: (mode) => acknowledgedModes.push(mode),
    onMutationChange: (kind, state) => outcomes.push({ kind, state }),
    onOverTemperatureDismissed: (snapshot) => dismissedFaults.push(snapshot),
    onProfilesAcknowledged: (profiles) => acknowledgedProfiles.push(profiles),
    onTemperatureSettingsAcknowledged: (settings) =>
      acknowledgedSettings.push(settings),
    polling,
    startKeyFactory,
    cooldownStartKeyFactory,
  });

  return {
    acknowledgedCooldowns,
    acknowledgedExtractions,
    acknowledgedHeaterSettings,
    acknowledgedModes,
    acknowledgedProfiles,
    acknowledgedSettings,
    connections,
    dismissedFaults,
    outcomes,
    polling,
    session,
  };
}

function mutationClient(
  overrides: Partial<DashboardMutationClient>,
): DashboardMutationClient {
  return {
    startCooldown: async () => ({
      status: "pumping",
      cooldownId: "cooldown-test-default",
      brewTargetC: 93,
      elapsedMs: 0,
      remainingMs: 45_000,
      pumpCommand: "running",
      heaterInhibited: true,
      outcome: null,
    }),
    stopCooldown: async () => ({
      status: "idle",
      cooldownId: null,
      brewTargetC: null,
      elapsedMs: 0,
      remainingMs: null,
      pumpCommand: "off",
      heaterInhibited: false,
      outcome: null,
    }),
    dismissOverTemperature: async () => ({
      activeMode: "brew",
      brewTargetC: 93,
      boilerTemperatureC: 93,
      fault: null,
      heaterEnabled: true,
      heaterActive: false,
      status: "heating",
      steamTargetC: 115,
      steamTimeoutRemainingMs: null,
      uptimeMs: 190_000,
    }),
    replaceProfiles: async (profiles) => profiles,
    startExtraction: async ({ selection }) =>
      selection.kind === "manual"
        ? {
            status: "running",
            extractionId: "test-run-1",
            selection,
            phase: "manual",
            elapsedMs: 0,
            remainingMs: 30_000,
            pumpCommand: "running",
          }
        : {
            status: "running",
            extractionId: "test-run-1",
            selection,
            phase: "main-extraction",
            elapsedMs: 0,
            remainingMs: 30_000,
            pumpCommand: "running",
          },
    stopExtraction: async () => ({
      status: "idle",
      extractionId: null,
      selection: null,
      phase: "idle",
      elapsedMs: 0,
      remainingMs: null,
      pumpCommand: "off",
    }),
    setHeaterEnabled: async ({ heaterEnabled }) => ({ heaterEnabled }),
    setMode: async ({ mode }) => ({ mode }),
    updateTemperatureSettings: async (settings) => ({
      brewTargetC: settings.brewTargetC ?? 93,
      steamTargetC: settings.steamTargetC ?? 115,
    }),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for the expected mutation state.");
}
