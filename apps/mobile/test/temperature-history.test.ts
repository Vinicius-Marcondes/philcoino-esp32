import { describe, expect, test } from "bun:test";
import type { MachineState } from "@philcoino/protocol";

import { temperatureHistoryToCsv } from "../src/history/temperature-history-csv";
import { InMemoryTemperatureHistoryRepository } from "../src/history/temperature-history-repository";
import { shareTemperatureHistoryCsv } from "../src/history/temperature-history-share-service";
import {
  createTemperatureHistorySample,
  downsampleTemperatureHistory,
  isTemperatureHistoryGap,
  liveTemperatureHistory,
  localDayRange,
  temperatureHistoryWindows,
  type TemperatureHistorySample,
} from "../src/history/temperature-history";

const machine: MachineState = {
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

describe("temperature history", () => {
  test("creates an acknowledged sample with wall-clock and firmware context", () => {
    const recordedAtMs = new Date(2026, 6, 18, 10, 30).getTime();
    expect(
      createTemperatureHistorySample("machine-1", machine, recordedAtMs),
    ).toEqual({
      activeMode: "brew",
      activeTargetC: 93,
      boilerTemperatureC: 87.4,
      brewTargetC: 93,
      deviceId: "machine-1",
      faultCode: null,
      heaterActive: true,
      heaterEnabled: true,
      machineStatus: "heating",
      recordedAtMs,
      steamTargetC: 115,
      uptimeMs: 184_220,
    });
  });

  test("keeps only the current local day and scopes rows by device", async () => {
    const repository = new InMemoryTemperatureHistoryRepository();
    const today = new Date(2026, 6, 18, 12).getTime();
    const yesterday = new Date(2026, 6, 17, 23, 59).getTime();
    await repository.append(sample("machine-1", yesterday, 1_000));
    await repository.append(sample("machine-1", today, 2_000));
    await repository.append(sample("machine-2", today + 1_000, 3_000));

    expect(await repository.loadToday("machine-1", today)).toEqual([
      sample("machine-1", today, 2_000),
    ]);
    expect(await repository.loadToday("machine-2", today)).toHaveLength(1);

    await repository.clearDevice("machine-1");
    expect(await repository.loadToday("machine-1", today)).toEqual([]);
  });

  test("uses timestamp gaps and uptime resets as graph segment boundaries", () => {
    const start = new Date(2026, 6, 18, 8).getTime();
    const first = sample("machine-1", start, 10_000);
    expect(
      isTemperatureHistoryGap(first, sample("machine-1", start + 1_000, 11_000)),
    ).toBe(false);
    expect(
      isTemperatureHistoryGap(first, sample("machine-1", start + 5_000, 15_000)),
    ).toBe(true);
    expect(
      isTemperatureHistoryGap(first, sample("machine-1", start + 1_000, 100)),
    ).toBe(true);
  });

  test("keeps a detailed live window and critical today points", () => {
    const start = new Date(2026, 6, 18, 8).getTime();
    const samples = Array.from({ length: 500 }, (_, index) => ({
      ...sample("machine-1", start + index * 1_000, index * 1_000),
      boilerTemperatureC: index === 123 ? 20 : index === 321 ? 140 : 90,
      heaterActive: index >= 250,
    }));
    const live = liveTemperatureHistory(samples);
    expect(live[0].recordedAtMs).toBe(start + 319_000);
    expect(live).toHaveLength(181);

    const today = downsampleTemperatureHistory(samples, 40);
    expect(today.some((entry) => entry.boilerTemperatureC === 20)).toBe(true);
    expect(today.some((entry) => entry.boilerTemperatureC === 140)).toBe(true);
    expect(today.some((entry) => entry.recordedAtMs === start + 249_000)).toBe(
      true,
    );
    expect(today.some((entry) => entry.recordedAtMs === start + 250_000)).toBe(
      true,
    );
  });

  test("pages history into three-minute windows ending at the latest sample", () => {
    const start = new Date(2026, 6, 18, 8).getTime();
    const samples = Array.from({ length: 500 }, (_, index) =>
      sample("machine-1", start + index * 1_000, index * 1_000),
    );

    const windows = temperatureHistoryWindows(samples);
    expect(windows).toHaveLength(3);
    expect(windows.at(-1)).toEqual({
      endMs: start + 499_000,
      startMs: start + 319_000,
    });

    const latestWindow = windows.at(-1)!;
    expect(
      samples.filter(
        (entry) =>
          entry.recordedAtMs >= latestWindow.startMs &&
          entry.recordedAtMs <= latestWindow.endMs,
      ),
    ).toEqual(liveTemperatureHistory(samples));
  });

  test("exports every raw row with stable CSV columns and safe text", () => {
    const recordedAtMs = Date.UTC(2026, 6, 18, 13, 0, 0);
    const csv = temperatureHistoryToCsv([
      {
        ...sample("=machine,1", recordedAtMs, 5_000),
        faultCode: "sensor_failure",
      },
    ]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "recorded_at_utc,device_id,machine_uptime_ms,boiler_temperature_c,brew_target_c,steam_target_c,active_mode,active_target_c,heater_enabled,heater_active,machine_status,fault_code",
    );
    expect(lines[1]).toContain("2026-07-18T13:00:00.000Z");
    expect(lines[1]).toContain('"\'=machine,1"');
    expect(lines[1].endsWith(",sensor_failure")).toBe(true);
  });

  test("writes, shares, and removes the temporary CSV", async () => {
    const events: string[] = [];
    await shareTemperatureHistoryCsv(
      [sample("machine 1", new Date(2026, 6, 18, 13).getTime(), 5_000)],
      {
        createTemporaryFile(filename) {
          expect(filename).toBe("philcoino-machine_1-2026-07-18.csv");
          return {
            remove() {
              events.push("remove");
            },
            uri: "cache://history.csv",
            write(contents) {
              expect(contents).toContain("recorded_at_utc");
              events.push("write");
            },
          };
        },
        async isSharingAvailable() {
          return true;
        },
        async shareFile(uri) {
          expect(uri).toBe("cache://history.csv");
          events.push("share");
        },
      },
    );
    expect(events).toEqual(["write", "share", "remove"]);
  });

  test("removes a temporary CSV after sharing fails", async () => {
    const events: string[] = [];
    await expect(
      shareTemperatureHistoryCsv([sample("machine-1", Date.now(), 5_000)], {
        createTemporaryFile() {
          return {
            remove() {
              events.push("remove");
            },
            uri: "cache://history.csv",
            write() {
              events.push("write");
            },
          };
        },
        async isSharingAvailable() {
          return true;
        },
        async shareFile() {
          events.push("share");
          throw new Error("share failed");
        },
      }),
    ).rejects.toThrow("share failed");
    expect(events).toEqual(["write", "share", "remove"]);
  });

  test("does not create a file when native sharing is unavailable", async () => {
    let created = false;
    await expect(
      shareTemperatureHistoryCsv([sample("machine-1", Date.now(), 5_000)], {
        createTemporaryFile() {
          created = true;
          throw new Error("must not create");
        },
        async isSharingAvailable() {
          return false;
        },
        async shareFile() {},
      }),
    ).rejects.toThrow("unavailable");
    expect(created).toBe(false);
  });

  test("calculates local calendar-day boundaries", () => {
    const midday = new Date(2026, 6, 18, 12, 30).getTime();
    const range = localDayRange(midday);
    expect(new Date(range.startMs).getHours()).toBe(0);
    expect(new Date(range.startMs).getDate()).toBe(18);
    expect(new Date(range.endMs).getDate()).toBe(19);
  });
});

function sample(
  deviceId: string,
  recordedAtMs: number,
  uptimeMs: number,
): TemperatureHistorySample {
  return createTemperatureHistorySample(
    deviceId,
    { ...machine, uptimeMs },
    recordedAtMs,
  );
}
