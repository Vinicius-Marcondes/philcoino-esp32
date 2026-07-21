import { describe, expect, test } from "bun:test";
import type {
  ExtractionState,
  MachineState,
  PredictiveTemperatureDiagnostics,
} from "@philcoino/protocol";

import { temperatureHistoryToCsv } from "../src/history/temperature-history-csv";
import { InMemoryTemperatureHistoryRepository } from "../src/history/temperature-history-repository";
import { shareTemperatureHistoryCsv } from "../src/history/temperature-history-share-service";
import {
  createTemperatureHistorySample,
  isLatestTemperatureHistoryWindow,
  isTemperatureHistoryGap,
  isLatestHistoryPageOffset,
  liveTemperatureHistory,
  localDayRange,
  temperatureGraphValueTopPercent,
  temperatureHistoryGraphScale,
  temperatureHistoryWindowSamples,
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

const idleExtraction: ExtractionState = {
  elapsedMs: 0,
  extractionId: null,
  phase: "idle",
  pumpCommand: "off",
  remainingMs: null,
  selection: null,
  status: "idle",
};

const pumpingExtraction: ExtractionState = {
  elapsedMs: 5_000,
  extractionId: "run-1",
  phase: "manual",
  pumpCommand: "running",
  remainingMs: 40_000,
  selection: { kind: "manual" },
  status: "running",
};

const prediction: PredictiveTemperatureDiagnostics = {
  activeTargetC: 93,
  baselineHeaterDuty: 0.4,
  commandedHeaterDuty1s: 0.5,
  fallbackReason: "none",
  featureSchemaVersion: 1,
  heat15s: 5,
  heat30s: 12,
  heat5s: 2,
  heaterCommandDuty: 1,
  hypotheticalCorrectionDuty: 0.1,
  hypotheticalHeaterDuty: 0.3,
  modelVersion: 1,
  operatingMode: "brewing",
  predictedPeakC: 94,
  predictedTemperature10sC: 93.8,
  predictedTemperature20sC: 94,
  predictedTemperature5sC: 93.5,
  pump15s: 3,
  pump5s: 2,
  runMode: "passive",
  temperatureAccelerationCPerS2: 0.01,
  temperatureFilteredC: 92.5,
  temperatureRawC: 92.75,
  temperatureSlopeCPerS: 0.1,
  trainingDataHash: 1347571540,
  usable: true,
};

describe("temperature history", () => {
  test("creates an acknowledged sample with wall-clock and firmware context", () => {
    const recordedAtMs = new Date(2026, 6, 18, 10, 30).getTime();
    expect(
      createTemperatureHistorySample(
        "machine-1",
        machine,
        pumpingExtraction,
        recordedAtMs,
      ),
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
      pumpActive: true,
      predictiveTemperature: null,
      recordedAtMs,
      sourceBootId: null,
      sourceSequence: null,
      startsAfterHistoryGap: false,
      steamTargetC: 115,
      uptimeMs: 184_220,
    });
  });

  test("stores live prediction diagnostics and exports their CSV fields", () => {
    const recordedAtMs = new Date(2026, 6, 18, 10, 31).getTime();
    const live = createTemperatureHistorySample(
      "machine-1",
      machine,
      pumpingExtraction,
      recordedAtMs,
      prediction,
    );

    expect(live.predictiveTemperature).toEqual(prediction);
    const csv = temperatureHistoryToCsv([live]);
    expect(csv).toContain(
      ",92.75,92.5,93,0.1,0.01,0.4,1,0.5,2,5,12,2,3,93.5,93.8,94,94,0.1,0.3,brewing,passive,true,none,1,1,1347571540",
    );
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

  test("replaces a retried device sequence even when its anchored timestamp changes", async () => {
    const repository = new InMemoryTemperatureHistoryRepository();
    const today = new Date(2026, 6, 18, 12).getTime();
    const bootId = "0123456789abcdef0123456789abcdef";
    const recovered = {
      ...sample("machine-1", today, 2_000),
      sourceBootId: bootId,
      sourceSequence: 7,
    };
    await repository.storeRecoveredPage("machine-1", {
      cursor: { afterSequence: 7, bootId },
      samples: [recovered],
    });
    await repository.storeRecoveredPage("machine-1", {
      cursor: { afterSequence: 7, bootId },
      samples: [{ ...recovered, recordedAtMs: today + 250 }],
    });

    const stored = await repository.loadToday("machine-1", today);
    expect(stored).toHaveLength(1);
    expect(stored[0].recordedAtMs).toBe(today + 250);
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
    expect(
      isTemperatureHistoryGap(first, {
        ...sample("machine-1", start + 1_000, 11_000),
        startsAfterHistoryGap: true,
      }),
    ).toBe(true);
    expect(
      isTemperatureHistoryGap(
        { ...first, sourceBootId: "0".repeat(32), sourceSequence: 1 },
        {
          ...sample("machine-1", start + 1_000, 11_000),
          sourceBootId: "1".repeat(32),
          sourceSequence: 1,
        },
      ),
    ).toBe(true);
  });

  test("keeps a detailed live window", () => {
    const start = new Date(2026, 6, 18, 8).getTime();
    const samples = Array.from({ length: 500 }, (_, index) => ({
      ...sample("machine-1", start + index * 1_000, index * 1_000),
      boilerTemperatureC: index === 123 ? 20 : index === 321 ? 140 : 90,
      heaterActive: index >= 250,
      pumpActive: index >= 270 && index < 290,
    }));
    const live = liveTemperatureHistory(samples);
    expect(live[0].recordedAtMs).toBe(start + 470_000);
    expect(live).toHaveLength(30);

  });

  test("pages history into stable clock-aligned 30-second windows", () => {
    const start = new Date(2026, 6, 18, 8).getTime();
    const samples = Array.from({ length: 500 }, (_, index) =>
      sample("machine-1", start + index * 1_000, index * 1_000),
    );

    const windows = temperatureHistoryWindows(samples);
    expect(windows).toHaveLength(18);
    expect(windows.at(-1)).toEqual({
      endMs: start + 510_000,
      startMs: start + 480_000,
    });

    const latestWindow = windows.at(-1)!;
    expect(temperatureHistoryWindowSamples(samples, latestWindow)).toHaveLength(19);
    expect(isLatestTemperatureHistoryWindow(windows, latestWindow)).toBe(true);
    expect(isLatestTemperatureHistoryWindow(windows, windows[0])).toBe(false);
  });

  test("does not change an older page identity when live samples arrive", () => {
    const start = new Date(2026, 6, 18, 8).getTime();
    const initial = Array.from({ length: 100 }, (_, index) =>
      sample("machine-1", start + index * 1_000, index * 1_000),
    );
    const before = temperatureHistoryWindows(initial);
    const viewed = before[1];
    const after = temperatureHistoryWindows([
      ...initial,
      sample("machine-1", start + 100_000, 100_000),
    ]);

    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toContainEqual(viewed);
  });

  test("uses five adaptive ticks with padding around each live page", () => {
    const start = new Date(2026, 6, 18, 8).getTime();
    const cold = [
      { ...sample("machine-1", start, 1_000), boilerTemperatureC: 27.25, activeTargetC: 94 },
    ];
    const warm = [
      { ...sample("machine-1", start, 2_000), boilerTemperatureC: 90.5, activeTargetC: 94 },
      { ...sample("machine-1", start + 1_000, 3_000), boilerTemperatureC: 98, activeTargetC: 94 },
    ];

    const precise = [
      { ...sample("machine-1", start, 2_000), boilerTemperatureC: 95.2, activeTargetC: 94 },
    ];

    expect(temperatureHistoryGraphScale([])).toEqual({
      maximumValue: 10,
      minimumValue: 0,
      ticks: [0, 2.5, 5, 7.5, 10],
    });
    expect(temperatureHistoryGraphScale(cold)).toEqual({
      maximumValue: 100,
      minimumValue: 20,
      ticks: [20, 40, 60, 80, 100],
    });
    expect(temperatureHistoryGraphScale(warm)).toEqual({
      maximumValue: 105,
      minimumValue: 85,
      ticks: [85, 90, 95, 100, 105],
    });
    expect(temperatureHistoryGraphScale(precise)).toEqual({
      maximumValue: 100,
      minimumValue: 90,
      ticks: [90, 92.5, 95, 97.5, 100],
    });
    expect(temperatureGraphValueTopPercent(95, 90, 100)).toBe(50);
  });

  test("keeps a later fault separate from a stopped pump command", () => {
    const start = new Date(2026, 6, 18, 8).getTime();
    const samples: TemperatureHistorySample[] = Array.from(
      { length: 103 },
      (_, index) => ({
      ...sample("machine-1", start + index * 1_000, index * 1_000),
      faultCode: index >= 69 ? ("over_temperature" as const) : null,
      machineStatus: index >= 69 ? ("fault" as const) : ("heating" as const),
      pumpActive: index < 42,
      }),
    );
    const windows = temperatureHistoryWindows(samples);
    const latestWindow = windows.at(-1)!;
    const extractionWindow = windows.find((window) =>
      temperatureHistoryWindowSamples(samples, window).some(
        (entry) => entry.pumpActive,
      ),
    )!;

    expect(temperatureHistoryWindowSamples(samples, latestWindow)).not.toContainEqual(
      expect.objectContaining({ pumpActive: true }),
    );
    expect(temperatureHistoryWindowSamples(samples, latestWindow)).toContainEqual(
      expect.objectContaining({ faultCode: "over_temperature", pumpActive: false }),
    );
    expect(isLatestTemperatureHistoryWindow(windows, extractionWindow)).toBe(false);
  });

  test("follows only the newest graph page offset", () => {
    expect(isLatestHistoryPageOffset(600, 900, 300)).toBe(true);
    expect(isLatestHistoryPageOffset(595, 900, 300)).toBe(true);
    expect(isLatestHistoryPageOffset(300, 900, 300)).toBe(false);
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
      "recorded_at_utc,device_id,machine_uptime_ms,boiler_temperature_c,brew_target_c,steam_target_c,active_mode,active_target_c,heater_enabled,heater_active,pump_active,machine_status,fault_code,temperature_raw_c,temperature_filtered_c,prediction_active_target_c,temperature_slope_c_per_s,temperature_acceleration_c_per_s2,baseline_heater_duty,heater_command_duty,commanded_heater_duty_1s,heat_5s,heat_15s,heat_30s,pump_5s,pump_15s,predicted_temperature_5s_c,predicted_temperature_10s_c,predicted_temperature_20s_c,predicted_peak_c,hypothetical_correction_duty,hypothetical_heater_duty,prediction_operating_mode,prediction_run_mode,prediction_usable,prediction_fallback_reason,prediction_model_version,prediction_feature_schema_version,prediction_training_data_hash",
    );
    expect(lines[1]).toContain("2026-07-18T13:00:00.000Z");
    expect(lines[1]).toContain('"\'=machine,1"');
    expect(lines[1]).toContain(",true,true,false,heating,");
    expect(lines[1]).toContain(",sensor_failure,");
    expect(lines[1].split(",").slice(-26).every((cell) => cell === "")).toBe(
      true,
    );
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
    idleExtraction,
    recordedAtMs,
  );
}
