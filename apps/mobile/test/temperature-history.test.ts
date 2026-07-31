import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type {
  ControllerConfiguration,
  ControllerDiagnostics,
  ExtractionState,
  MachineState,
} from "@philcoino/protocol";

import { temperatureHistoryToCsv } from "../src/history/temperature-history-csv";
import { InMemoryTemperatureHistoryRepository } from "../src/history/temperature-history-repository";
import { shareTemperatureHistoryCsv } from "../src/history/temperature-history-share-service";
import {
  rebuildTemperatureHistoryV5Sql,
  TEMPERATURE_HISTORY_CURRENT_COLUMNS,
} from "../src/history/temperature-history-schema";
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
  steamControl: {
    settings: {
      initialCompensationC: 12,
      decayDurationMs: 720_000,
      readyTimeoutMs: 300_000,
    },
    compensationActive: false,
    appliedCompensationC: 0,
    controlTemperatureC: null,
    heatSoakElapsedMs: null,
  },
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

const controllerConfiguration: ControllerConfiguration = {
  controllerIntervalMs: 500,
  filterAlpha: 0.25,
  firmwareVersion: "0.4.0",
  piKi: 0.01,
  piKp: 0.08,
  selectedController: "legacy_curve",
  ssrWindowMs: 10_000,
};

const controllerDiagnostics: ControllerDiagnostics = {
  baseTargetC: 93,
  deliveredCommandDuty1s: 0.5,
  errorC: 0.5,
  extractionPhase: "manual",
  heaterCommandActive: true,
  integralContribution: 0.04,
  integralState: 4,
  legacyRequestedDuty: 0.4,
  operatingMode: "brewing",
  piAntiWindupActive: false,
  piRequestedDuty: 0.08,
  piSaturation: "none",
  privateTargetC: 93,
  proportionalContribution: 0.04,
  pumpCommand: "running",
  selectedController: "legacy_curve",
  temperatureFilteredC: 92.5,
  temperatureRawC: 92.75,
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
      controllerConfiguration: null,
      controllerDiagnostics: null,
      recordedAtMs,
      sourceBootId: null,
      sourceSequence: null,
      startsAfterHistoryGap: false,
      steamControl: machine.steamControl,
      steamTargetC: 115,
      uptimeMs: 184_220,
    });
  });

  test("exports recovered controller configuration and command diagnostics", () => {
    const recordedAtMs = new Date(2026, 6, 18, 10, 31).getTime();
    const live = {
      ...createTemperatureHistorySample(
        "machine-1",
        machine,
        pumpingExtraction,
        recordedAtMs,
      ),
      controllerConfiguration,
      controllerDiagnostics,
    };

    const csv = temperatureHistoryToCsv([live]);
    expect(csv).toContain(
      ",0.4.0,legacy_curve,0.08,0.01,0.25,500,10000,92.75,92.5,93,93,0.5,0.4,0.08,0.04,0.04,4,none,false,true,0.5,running,manual,brewing",
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

  test("migrates v4 rows without retaining prediction storage", () => {
    const database = new Database(":memory:");
    try {
      database.exec(`
        CREATE TABLE temperature_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT NOT NULL,
          recorded_at_ms INTEGER NOT NULL,
          uptime_ms INTEGER NOT NULL,
          boiler_temperature_c REAL NOT NULL,
          brew_target_c REAL NOT NULL,
          steam_target_c REAL NOT NULL,
          active_mode TEXT NOT NULL,
          active_target_c REAL NOT NULL,
          heater_enabled INTEGER NOT NULL,
          heater_active INTEGER NOT NULL,
          pump_active INTEGER,
          machine_status TEXT NOT NULL,
          fault_code TEXT,
          predictive_temperature_json TEXT,
          source_boot_id TEXT,
          source_sequence INTEGER,
          starts_after_history_gap INTEGER NOT NULL DEFAULT 0,
          UNIQUE(device_id, recorded_at_ms)
        );
        INSERT INTO temperature_history (
          device_id, recorded_at_ms, uptime_ms, boiler_temperature_c,
          brew_target_c, steam_target_c, active_mode, active_target_c,
          heater_enabled, heater_active, pump_active, machine_status,
          fault_code, predictive_temperature_json, source_boot_id,
          source_sequence, starts_after_history_gap
        ) VALUES (
          'machine-1', 1000, 500, 91.5, 93, 115, 'brew', 93,
          1, 1, 0, 'heating', NULL, '{"predictedPeakC":99}',
          '0123456789abcdef0123456789abcdef', 7, 1
        );
      `);

      database.exec("BEGIN EXCLUSIVE");
      database.exec(rebuildTemperatureHistoryV5Sql());
      database.exec("COMMIT");

      const columns = database
        .query("PRAGMA table_info(temperature_history)")
        .all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(
        [...TEMPERATURE_HISTORY_CURRENT_COLUMNS],
      );
      expect(
        columns.some((column) => column.name.includes("predict")),
      ).toBe(false);
      expect(
        database
          .query(
            `SELECT device_id, boiler_temperature_c, source_sequence,
                    starts_after_history_gap, controller_configuration_json,
                    controller_diagnostics_json
             FROM temperature_history`,
          )
          .get(),
      ).toEqual({
        boiler_temperature_c: 91.5,
        controller_configuration_json: null,
        controller_diagnostics_json: null,
        device_id: "machine-1",
        source_sequence: 7,
        starts_after_history_gap: 1,
      });
    } finally {
      database.close();
    }
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
      "recorded_at_utc,device_id,machine_uptime_ms,boiler_temperature_c,brew_target_c,steam_target_c,active_mode,active_target_c,steam_control_temperature_c,steam_applied_compensation_c,steam_compensation_active,steam_heat_soak_elapsed_ms,steam_initial_compensation_c,steam_decay_duration_ms,steam_ready_timeout_ms,heater_enabled,heater_active,pump_active,machine_status,fault_code,controller_firmware_version,controller_selected,controller_pi_kp,controller_pi_ki,controller_filter_alpha,controller_interval_ms,ssr_window_ms,temperature_raw_c,temperature_filtered_c,controller_base_target_c,controller_private_target_c,controller_error_c,legacy_requested_duty,pi_requested_duty,pi_proportional_contribution,pi_integral_contribution,pi_integral_state,pi_saturation,pi_anti_windup_active,heater_command_active,delivered_command_duty_1s,pump_command,extraction_phase,controller_operating_mode",
    );
    expect(lines[1]).toContain("2026-07-18T13:00:00.000Z");
    expect(lines[1]).toContain('"\'=machine,1"');
    expect(lines[1]).toContain(",true,true,false,heating,");
    expect(lines[1]).toContain(",sensor_failure,");
    expect(lines[1].split(",").slice(-24).every((cell) => cell === "")).toBe(
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
