import { describe, expect, test } from "bun:test";
import type { HistoryCursor, HistoryPage } from "@philcoino/protocol";

import { InMemoryTemperatureHistoryRepository } from "../src/history/temperature-history-repository";
import {
  mapHistoryPage,
  synchronizeTemperatureHistory,
  temperatureHistorySyncWarning,
  TemperatureHistoryProtocolError,
} from "../src/history/temperature-history-sync";
import {
  createTemperatureHistorySample,
  isTemperatureHistoryGap,
} from "../src/history/temperature-history";
import { DeviceApiClient } from "../src/networking/device-api-client";
import { ApiClientError } from "../src/networking/api-client-error";
import {
  createSimulator,
  DEFAULT_SIMULATOR_TOKEN,
} from "../../../tools/device-simulator/src/app.ts";

const bootId = "0123456789abcdef0123456789abcdef";

describe("temperature history synchronization", () => {
  test("anchors all pages to the first request midpoint and commits cursors durably", async () => {
    const repository = new InMemoryTemperatureHistoryRepository();
    const today = new Date(2026, 6, 18, 12).getTime();
    await repository.append(phoneSample(today - 1_000, 4_000));
    const requests: Array<HistoryCursor | undefined> = [];
    const pages = [
      page([sample(1, 3_000), sample(2, 4_000)], 2, true, "initial"),
      page([sample(3, 5_000)], 3, false, "continuous"),
    ];
    let pageIndex = 0;
    let commits = 0;
    const times = [today - 50, today + 50];

    await expect(
      synchronizeTemperatureHistory({
        client: {
          async getHistory(cursor) {
            requests.push(cursor);
            return pages[pageIndex++];
          },
        },
        deviceId: "machine-1",
        now: () => times.shift() ?? today,
        onPageCommitted: () => {
          commits += 1;
        },
        repository,
      }),
    ).resolves.toEqual({ pagesCommitted: 2, samplesCommitted: 3 });

    expect(requests).toEqual([undefined, { afterSequence: 2, bootId }]);
    expect(commits).toBe(2);
    expect(await repository.loadSyncCursor("machine-1")).toEqual({
      afterSequence: 3,
      bootId,
    });
    const stored = await repository.loadToday("machine-1", today);
    expect(stored.map((entry) => entry.recordedAtMs)).toEqual([
      today - 2_000,
      today - 1_000,
      today,
    ]);
    expect(stored.map((entry) => entry.sourceSequence)).toEqual([1, 2, 3]);
  });

  test("keeps the last committed cursor when a later page fails", async () => {
    const repository = new InMemoryTemperatureHistoryRepository();
    let requests = 0;
    await expect(
      synchronizeTemperatureHistory({
        client: {
          async getHistory() {
            requests += 1;
            if (requests === 1) {
              return page([sample(1, 1_000)], 1, true, "initial");
            }
            throw new Error("connection lost");
          },
        },
        deviceId: "machine-1",
        now: () => new Date(2026, 6, 18, 12).getTime(),
        repository,
      }),
    ).rejects.toThrow("connection lost");
    expect(await repository.loadSyncCursor("machine-1")).toEqual({
      afterSequence: 1,
      bootId,
    });
  });

  test("retries one transient ESP32 history rejection", async () => {
    const repository = new InMemoryTemperatureHistoryRepository();
    let requests = 0;
    await expect(
      synchronizeTemperatureHistory({
        client: {
          async getHistory() {
            requests += 1;
            if (requests === 1) {
              throw new ApiClientError("http", "temporarily busy", {
                status: 500,
              });
            }
            return page([sample(1, 1_000)], 1, false, "initial");
          },
        },
        deviceId: "machine-1",
        now: () => new Date(2026, 6, 18, 12).getTime(),
        repository,
      }),
    ).resolves.toEqual({ pagesCommitted: 1, samplesCommitted: 1 });
    expect(requests).toBe(2);
  });

  test("marks reset and truncated starts as explicit graph gaps", () => {
    for (const continuity of ["reset", "truncated"] as const) {
      const mapped = mapHistoryPage(
        page([sample(8, 8_000), sample(9, 9_000)], 9, false, continuity),
        "machine-1",
        20_000,
        10_000,
      );
      expect(mapped[0].startsAfterHistoryGap).toBe(true);
      expect(mapped[1].startsAfterHistoryGap).toBe(false);
    }
  });

  test("distinguishes network, device, protocol, and storage warnings", () => {
    expect(
      temperatureHistorySyncWarning(new ApiClientError("timeout", "timeout")),
    ).toBe("network");
    expect(
      temperatureHistorySyncWarning(new ApiClientError("http", "rejected")),
    ).toBe("device");
    expect(
      temperatureHistorySyncWarning(
        new TemperatureHistoryProtocolError("wrong device"),
      ),
    ).toBe("protocol");
    expect(temperatureHistorySyncWarning(new Error("sqlite"))).toBe("storage");
  });

  test("backfills paginated simulator history and resumes across a reboot", async () => {
    const simulator = createSimulator();
    const request = simulator.app.request.bind(simulator.app);
    const client = new DeviceApiClient({
      address: "http://127.0.0.1:3000",
      fetch: (url, init) =>
        Promise.resolve(
          request(url, {
            body: init.body,
            headers: init.headers,
            method: init.method,
            signal: init.signal,
          }),
        ),
      token: DEFAULT_SIMULATOR_TOKEN,
    });
    const identity = await client.getDevice();
    const repository = new InMemoryTemperatureHistoryRepository();
    const firstAnchor = new Date(2026, 6, 18, 12).getTime();
    await simulator.app.request("/_simulator/advance", {
      body: JSON.stringify({ milliseconds: 125_000 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    await expect(
      synchronizeTemperatureHistory({
        client,
        deviceId: identity.deviceId,
        now: () => firstAnchor,
        repository,
      }),
    ).resolves.toEqual({ pagesCommitted: 3, samplesCommitted: 125 });

    await simulator.app.request("/_simulator/power-cycle", { method: "POST" });
    await simulator.app.request("/_simulator/advance", {
      body: JSON.stringify({ milliseconds: 2_000 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await synchronizeTemperatureHistory({
      client,
      deviceId: identity.deviceId,
      now: () => firstAnchor + 10_000,
      repository,
    });

    const stored = await repository.loadToday(
      identity.deviceId,
      firstAnchor + 10_000,
    );
    expect(stored).toHaveLength(127);
    expect(stored.at(-2)?.startsAfterHistoryGap).toBe(true);
    expect(stored.at(-1)?.startsAfterHistoryGap).toBe(false);
    expect(stored.at(-2)?.sourceBootId).not.toBe(stored[0].sourceBootId);
  });

  test("backfills two, five, and ten minute interruptions without artificial gaps", async () => {
    for (const minutes of [2, 5, 10]) {
      const simulator = createSimulator();
      const request = simulator.app.request.bind(simulator.app);
      const client = new DeviceApiClient({
        address: "http://127.0.0.1:3000",
        fetch: (url, init) =>
          Promise.resolve(
            request(url, {
              body: init.body,
              headers: init.headers,
              method: init.method,
              signal: init.signal,
            }),
          ),
        token: DEFAULT_SIMULATOR_TOKEN,
      });
      const identity = await client.getDevice();
      const repository = new InMemoryTemperatureHistoryRepository();
      const anchor = new Date(2026, 6, 18, 14).getTime();
      await simulator.app.request("/_simulator/advance", {
        body: JSON.stringify({ milliseconds: minutes * 60_000 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      await synchronizeTemperatureHistory({
        client,
        deviceId: identity.deviceId,
        now: () => anchor,
        repository,
      });
      const stored = await repository.loadToday(identity.deviceId, anchor);
      expect(stored).toHaveLength(minutes * 60);
      expect(
        stored.some(
          (sample, index) =>
            index > 0 && isTemperatureHistoryGap(stored[index - 1], sample),
        ),
      ).toBe(false);
    }
  });
});

function page(
  samples: HistoryPage["samples"],
  afterSequence: number,
  hasMore: boolean,
  continuity: HistoryPage["continuity"],
): HistoryPage {
  return {
    bootId,
    capturedAtUptimeMs: 5_000,
    continuity,
    deviceId: "machine-1",
    hasMore,
    latestSequence: 3,
    nextCursor: { afterSequence, bootId },
    oldestSequence: 1,
    samples,
  };
}

function sample(sequence: number, uptimeMs: number): HistoryPage["samples"][number] {
  return {
    activeMode: "brew",
    boilerTemperatureC: 91,
    brewTargetC: 93,
    faultCode: null,
    heaterActive: true,
    heaterEnabled: true,
    machineStatus: "heating",
    pumpActive: false,
    sequence,
    steamTargetC: 115,
    uptimeMs,
  };
}

function phoneSample(recordedAtMs: number, uptimeMs: number) {
  return createTemperatureHistorySample(
    "machine-1",
    {
      activeMode: "brew",
      boilerTemperatureC: 91,
      brewTargetC: 93,
      fault: null,
      heaterActive: true,
      heaterEnabled: true,
      status: "heating",
      steamTargetC: 115,
      steamTimeoutRemainingMs: null,
      uptimeMs,
    },
    {
      elapsedMs: 0,
      extractionId: null,
      phase: "idle",
      pumpCommand: "off",
      remainingMs: null,
      selection: null,
      status: "idle",
    },
    recordedAtMs,
  );
}
