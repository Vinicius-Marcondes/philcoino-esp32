import { describe, expect, test } from "bun:test";

import { DashboardPollingSession } from "../src/dashboard/dashboard-polling-session";
import { InMemoryTemperatureHistoryRepository } from "../src/history/temperature-history-repository";
import { synchronizeTemperatureHistory } from "../src/history/temperature-history-sync";
import {
  DeviceApiClient,
  type FetchImplementation,
} from "../src/networking/device-api-client";
import {
  createSimulator,
  DEFAULT_SIMULATOR_TOKEN,
} from "../../../tools/device-simulator/src/app.ts";

describe("device request contention", () => {
  test("live polling, recovery, mutation, and a third client can reach the device concurrently", async () => {
    const simulator = createSimulator();
    const request = simulator.app.request.bind(simulator.app);
    let active = 0;
    let maximumActive = 0;
    const paths: string[] = [];
    let releaseRequests: () => void = () => undefined;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    const fetchImplementation: FetchImplementation = async (url, init) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      paths.push(new URL(url).pathname);
      await requestGate;
      try {
        return await request(url, {
          body: init.body,
          headers: init.headers,
          method: init.method,
          signal: init.signal,
        });
      } finally {
        active -= 1;
      }
    };
    const client = new DeviceApiClient({
      address: "http://127.0.0.1:3000",
      fetch: fetchImplementation,
      token: DEFAULT_SIMULATOR_TOKEN,
    });
    let liveSnapshotReceived: () => void = () => undefined;
    const liveSnapshot = new Promise<void>((resolve) => {
      liveSnapshotReceived = resolve;
    });
    const polling = new DashboardPollingSession({
      client,
      onConnectionChange: () => undefined,
      onSnapshotChange: (snapshot) => {
        if (snapshot !== null) liveSnapshotReceived();
      },
      scheduler: {
        clearTimeout: () => undefined,
        setTimeout: () => 1,
      },
    });

    polling.start();
    const history = synchronizeTemperatureHistory({
      client,
      deviceId: "philcoino-simulator",
      repository: new InMemoryTemperatureHistoryRepository(),
      yieldBetweenPages: () => Promise.resolve(),
    });
    const mutation = client.setHeaterEnabled({ heaterEnabled: false });
    const thirdClient = client.getHealth();

    for (let attempt = 0; attempt < 10 && active < 4; attempt += 1) {
      await Promise.resolve();
    }
    expect(active).toBe(4);
    releaseRequests();
    await Promise.all([history, mutation, thirdClient, liveSnapshot]);
    polling.stop();

    expect(maximumActive).toBe(4);
    expect(paths).toContain("/api/v2/state");
    expect(paths).toContain("/api/v2/history");
    expect(paths).toContain("/api/v1/heater");
    expect(paths).toContain("/healthz");
  });
});
