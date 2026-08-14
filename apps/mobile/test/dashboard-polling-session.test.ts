import { describe, expect, it } from "bun:test";

import {
  DASHBOARD_TRANSIENT_RETRY_DELAY_MS,
  DashboardPollingSession,
} from "../src/dashboard/dashboard-polling-session";
import { ApiClientError } from "../src/networking/api-client-error";
import { createDebugDeviceApiClient } from "../src/networking/debug-device-api-client";

describe("DashboardPollingSession", () => {
  it("yields to a mutation without cancelling the reusable control connection", async () => {
    const initial = await createDebugDeviceApiClient().getState();
    let calls = 0;
    const first: {
      resolve?: () => void;
      signal?: AbortSignal;
    } = {};
    const snapshots: Array<typeof initial | null> = [];
    const session = new DashboardPollingSession({
      client: {
        getState(options) {
          calls += 1;
          if (calls === 1) {
            first.signal = options?.signal;
            return new Promise((resolve) => {
              first.resolve = () => resolve(initial);
            });
          }
          return Promise.resolve({ ...initial, revision: initial.revision + calls });
        },
      },
      onConnectionChange: () => undefined,
      onSnapshotChange: (snapshot) => snapshots.push(snapshot),
    });

    session.start();
    session.pauseForMutation();
    expect(first.signal?.aborted).toBe(false);
    first.resolve?.();
    await flushPromises();
    expect(snapshots).toEqual([null]);

    session.resume();
    await flushPromises();
    expect(calls).toBe(2);
    expect(snapshots.at(-1)?.revision).toBe(initial.revision + 2);
    session.stop();
  });

  it("still cancels an in-flight poll for lifecycle suspension", async () => {
    const observation: { signal?: AbortSignal } = {};
    const session = new DashboardPollingSession({
      client: {
        getState(options) {
          observation.signal = options?.signal;
          return new Promise((_resolve, reject) => {
            observation.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          });
        },
      },
      onConnectionChange: () => undefined,
      onSnapshotChange: () => undefined,
    });

    session.start();
    session.pause();
    expect(observation.signal?.aborted).toBe(true);
    await flushPromises();
    session.stop();
  });

  it("retries one transient failure immediately before clearing live state", async () => {
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const snapshots: Array<unknown> = [];
    const connections: string[] = [];
    let calls = 0;
    const session = new DashboardPollingSession({
      client: {
        getState() {
          calls += 1;
          return Promise.reject(new ApiClientError("offline", "lost packet"));
        },
      },
      onConnectionChange: (connection) => connections.push(connection.status),
      onSnapshotChange: (snapshot) => snapshots.push(snapshot),
      scheduler: {
        clearTimeout: () => undefined,
        setTimeout(callback, delayMs) {
          scheduled.push({ callback, delayMs });
          return scheduled.length;
        },
      },
    });

    session.start();
    await flushPromises();
    expect(calls).toBe(1);
    expect(snapshots).toEqual([null]);
    expect(connections).toEqual(["connecting"]);
    expect(scheduled[0]?.delayMs).toBe(DASHBOARD_TRANSIENT_RETRY_DELAY_MS);

    scheduled.shift()?.callback();
    await flushPromises();
    expect(calls).toBe(2);
    expect(snapshots).toEqual([null, null]);
    expect(connections).toEqual(["connecting", "offline"]);
    session.stop();
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
