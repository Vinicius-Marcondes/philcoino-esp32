import { describe, expect, test } from "bun:test";
import type {
  MachineState,
  Mode,
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
      brewTemperatureC: 93,
      fault: null,
      heaterActive: false,
      status: "heating",
      steamTargetC: 115,
      steamTemperatureC: 100,
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
        message: "Clear the latched sensor fault before changing mode.",
        status: "rejected",
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

function createHarness(client: DashboardMutationClient) {
  const acknowledgedModes: Mode[] = [];
  const acknowledgedSettings: TemperatureSettingsResponse[] = [];
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
    onConnectionLost: (connection) => connections.push(connection),
    onModeAcknowledged: (mode) => acknowledgedModes.push(mode),
    onMutationChange: (kind, state) => outcomes.push({ kind, state }),
    onOverTemperatureDismissed: (snapshot) => dismissedFaults.push(snapshot),
    onTemperatureSettingsAcknowledged: (settings) =>
      acknowledgedSettings.push(settings),
    polling,
  });

  return {
    acknowledgedModes,
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
    dismissOverTemperature: async () => ({
      activeMode: "brew",
      brewTargetC: 93,
      brewTemperatureC: 93,
      fault: null,
      heaterActive: false,
      status: "heating",
      steamTargetC: 115,
      steamTemperatureC: 100,
      steamTimeoutRemainingMs: null,
      uptimeMs: 190_000,
    }),
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
