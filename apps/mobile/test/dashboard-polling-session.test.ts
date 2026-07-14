import { describe, expect, test } from "bun:test";
import type {
  MachineState,
  MachineStateV2,
  ProfileSet,
} from "@philcoino/protocol";

import { ApiClientError } from "../src/networking/api-client-error";
import {
  createSimulator,
  DEFAULT_SIMULATOR_TOKEN,
} from "../../../tools/device-simulator/src/app.ts";
import {
  DASHBOARD_POLL_INTERVAL_MS,
  DashboardPollingSession,
  type DashboardStateClient,
} from "../src/dashboard/dashboard-polling-session";
import type { ConnectionState } from "../src/networking/connection-state";
import {
  DeviceApiClient,
  type FetchImplementation,
} from "../src/networking/device-api-client";

const validState: MachineState = {
  activeMode: "brew",
  brewTargetC: 93,
  boilerTemperatureC: 87.4,
  fault: null,
  heaterEnabled: true,
  heaterActive: true,
  status: "heating",
  steamTargetC: 115,
  steamTimeoutRemainingMs: null,
  uptimeMs: 184_220,
};
const validStateV2: MachineStateV2 = {
  machine: validState,
  extraction: {
    status: "idle",
    extractionId: null,
    selection: null,
    phase: "idle",
    elapsedMs: 0,
    remainingMs: null,
    pumpCommand: "off",
  },
};
const profiles: ProfileSet = {
  profiles: [
    { id: "profile-1", profile: null },
    { id: "profile-2", profile: null },
    { id: "profile-3", profile: null },
    { id: "profile-4", profile: null },
  ],
};

describe("DashboardPollingSession", () => {
  test("polls immediately and schedules the next request one second after completion", async () => {
    const scheduler = new FakeScheduler();
    let requests = 0;
    const connections: ConnectionState[] = [];
    const snapshots: (MachineStateV2 | null)[] = [];
    const session = new DashboardPollingSession({
      client: {
        getProfiles: async () => profiles,
        getStateV2: async () => {
          requests += 1;
          return validStateV2;
        },
      },
      onConnectionChange: (connection) => connections.push(connection),
      onSnapshotChange: (snapshot) => snapshots.push(snapshot),
      scheduler,
    });

    session.start();
    await settle();

    expect(requests).toBe(1);
    expect(scheduler.nextDelay()).toBe(DASHBOARD_POLL_INTERVAL_MS);
    expect(connections).toEqual([{ status: "connecting" }, { status: "online" }]);
    expect(snapshots).toEqual([null, validStateV2]);

    scheduler.runNext();
    await settle();
    expect(requests).toBe(2);
    session.stop();
  });

  test("never overlaps requests and cancels the active request when stopped", async () => {
    const scheduler = new FakeScheduler();
    let requests = 0;
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    let aborted = false;
    const pending = deferred<MachineStateV2>();
    const client: DashboardStateClient = {
      getProfiles: async () => profiles,
      getStateV2: ({ signal } = {}) => {
        requests += 1;
        activeRequests += 1;
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
        signal?.addEventListener("abort", () => {
          aborted = true;
          activeRequests -= 1;
          pending.reject(new ApiClientError("cancelled", "cancelled"));
        });
        return pending.promise.finally(() => {
          if (!aborted) {
            activeRequests -= 1;
          }
        });
      },
    };
    const session = new DashboardPollingSession({
      client,
      onConnectionChange: () => {},
      onSnapshotChange: () => {},
      scheduler,
    });

    session.start();
    session.start();
    expect(requests).toBe(1);
    expect(scheduler.size).toBe(0);
    expect(maximumActiveRequests).toBe(1);

    session.stop();
    await settle();
    expect(aborted).toBe(true);
    expect(scheduler.size).toBe(0);
  });

  test("pauses an active read and resumes immediately without clearing live state", async () => {
    const scheduler = new FakeScheduler();
    const connections: ConnectionState[] = [];
    const snapshots: (MachineStateV2 | null)[] = [];
    let requests = 0;
    const client: DashboardStateClient = {
      getProfiles: async () => profiles,
      getStateV2: ({ signal } = {}) => {
        requests += 1;
        if (requests === 1) {
          return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new ApiClientError("cancelled", "cancelled"));
            });
          });
        }
        return Promise.resolve(validStateV2);
      },
    };
    const session = new DashboardPollingSession({
      client,
      onConnectionChange: (connection) => connections.push(connection),
      onSnapshotChange: (snapshot) => snapshots.push(snapshot),
      scheduler,
    });

    session.start();
    session.pause();
    await settle();
    expect(requests).toBe(1);
    expect(snapshots).toEqual([null]);

    session.resume();
    await settle();
    expect(requests).toBe(2);
    expect(snapshots).toEqual([null, validStateV2]);
    expect(connections).toEqual([
      { status: "connecting" },
      { status: "online" },
    ]);
    session.stop();
  });

  test("clears the last snapshot and exposes a protocol error without stopping recovery", async () => {
    const scheduler = new FakeScheduler();
    const connections: ConnectionState[] = [];
    const snapshots: (MachineStateV2 | null)[] = [];
    let request = 0;
    const session = new DashboardPollingSession({
      client: {
        getProfiles: async () => profiles,
        getStateV2: async () => {
          request += 1;
          if (request === 1) {
            return validStateV2;
          }
          throw new ApiClientError("protocol", "invalid response");
        },
      },
      onConnectionChange: (connection) => connections.push(connection),
      onSnapshotChange: (snapshot) => snapshots.push(snapshot),
      scheduler,
    });

    session.start();
    await settle();
    scheduler.runNext();
    await settle();

    expect(connections.at(-1)).toEqual({ status: "protocol-error" });
    expect(snapshots).toEqual([null, validStateV2, null]);
    expect(scheduler.nextDelay()).toBe(DASHBOARD_POLL_INTERVAL_MS);
    session.stop();
  });

  test("reads live and fault states through the authenticated simulator contract", async () => {
    const simulator = createSimulator();
    const scheduler = new FakeScheduler();
    const snapshots: (MachineStateV2 | null)[] = [];
    const firstSnapshot = deferred<MachineStateV2>();
    const faultSnapshot = deferred<MachineStateV2>();
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
    const session = new DashboardPollingSession({
      client,
      onConnectionChange: () => {},
      onSnapshotChange: (snapshot) => {
        snapshots.push(snapshot);
        if (snapshot?.machine.status === "fault") {
          faultSnapshot.resolve(snapshot);
        } else if (snapshot !== null) {
          firstSnapshot.resolve(snapshot);
        }
      },
      scheduler,
    });

    session.start();
    await expect(firstSnapshot.promise).resolves.toMatchObject({
      machine: { status: "heating" },
      extraction: { status: "idle" },
    });

    simulator.machine.injectFault("sensor_failure");
    scheduler.runNext();
    await expect(faultSnapshot.promise).resolves.toMatchObject({
      machine: {
        fault: { code: "sensor_failure" },
        heaterEnabled: true,
        heaterActive: false,
        status: "fault",
      },
    });
    session.stop();
  });
});

class FakeScheduler {
  private nextHandle = 1;
  private readonly timers = new Map<number, { callback: () => void; delayMs: number }>();

  get size(): number {
    return this.timers.size;
  }

  clearTimeout = (handle: unknown) => {
    this.timers.delete(handle as number);
  };

  setTimeout = (callback: () => void, delayMs: number): number => {
    const handle = this.nextHandle++;
    this.timers.set(handle, { callback, delayMs });
    return handle;
  };

  nextDelay(): number | null {
    return this.timers.values().next().value?.delayMs ?? null;
  }

  runNext(): void {
    const entry = this.timers.entries().next().value;
    if (entry === undefined) {
      throw new Error("No timer is scheduled.");
    }
    const [handle, timer] = entry;
    this.timers.delete(handle);
    timer.callback();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
