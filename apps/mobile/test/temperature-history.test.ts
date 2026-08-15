import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { ExtractionState, MachineState } from "@philcoino/protocol";

import {
  TEMPERATURE_HISTORY_CSV_HEADER,
  temperatureHistoryToCsv,
} from "../src/history/temperature-history-csv";
import { InMemoryTemperatureHistoryRepository } from "../src/history/temperature-history-repository";
import { rebuildTemperatureHistoryV8Sql } from "../src/history/temperature-history-schema";
import {
  createTemperatureHistorySample,
  isTemperatureHistoryGap,
  localDayRange,
  type TemperatureHistorySample,
} from "../src/history/temperature-history";

const machine: MachineState = {
  activeMode: "brew",
  brewTargetC: 93,
  boilerTemperatureC: 87.4,
  steamTemperatureC: 112.6,
  fault: null,
  heaterEnabled: true,
  heaterActive: true,
  status: "heating",
  steamTargetC: 115,
  steamReadyTimeoutMs: 300_000,
  steamTimeoutRemainingMs: null,
  uptimeMs: 184_220,
};

const extraction: ExtractionState = {
  elapsedMs: 5_000,
  extractionId: "run-1",
  phase: "manual",
  pumpCommand: "running",
  remainingMs: 40_000,
  selection: { kind: "manual" },
  status: "running",
};

describe("local temperature history", () => {
  test("stores every useful field from an acknowledged state sample", () => {
    const recordedAtMs = new Date(2026, 6, 18, 10, 30).getTime();
    expect(createTemperatureHistorySample("machine-1", machine, extraction, recordedAtMs))
      .toEqual({
        activeMode: "brew",
        activeTargetC: 93,
        boilerTemperatureC: 87.4,
        brewTargetC: 93,
        deviceId: "machine-1",
        faultCode: null,
        heaterActive: true,
        heaterEnabled: true,
        machineStatus: "heating",
        pumpCommand: "running",
        recordedAtMs,
        startsAfterHistoryGap: false,
        steamTemperatureC: 112.6,
        steamTargetC: 115,
        uptimeMs: 184_220,
      });
  });

  test("loads only today while retaining and iterating older rows", async () => {
    const repository = new InMemoryTemperatureHistoryRepository();
    const today = new Date(2026, 6, 18, 12).getTime();
    const yesterday = new Date(2026, 6, 17, 23, 59).getTime();
    await repository.append(sample("machine-1", yesterday, 1_000));
    await repository.append(sample("machine-1", today, 2_000));

    expect(await repository.loadToday("machine-1", today)).toHaveLength(1);
    const all: TemperatureHistorySample[] = [];
    for await (const row of repository.iterateAll("machine-1")) all.push(row);
    expect(all.map((row) => row.recordedAtMs)).toEqual([yesterday, today]);

    await repository.clearDevice("machine-1");
    expect(await repository.loadToday("machine-1", today)).toEqual([]);
  });

  test("treats inactive periods, uptime resets, and explicit markers as gaps", () => {
    const start = new Date(2026, 6, 18, 8).getTime();
    const first = sample("machine-1", start, 10_000);
    expect(isTemperatureHistoryGap(first, sample("machine-1", start + 1_000, 11_000)))
      .toBe(false);
    expect(isTemperatureHistoryGap(first, sample("machine-1", start + 5_000, 15_000)))
      .toBe(true);
    expect(isTemperatureHistoryGap(first, sample("machine-1", start + 1_000, 100)))
      .toBe(true);
    expect(isTemperatureHistoryGap(first, {
      ...sample("machine-1", start + 1_000, 11_000),
      startsAfterHistoryGap: true,
    })).toBe(true);
  });

  test("v8 migration adds dual nullable temperatures and drops obsolete metadata", () => {
    const database = new Database(":memory:");
    try {
      database.exec(`
        CREATE TABLE temperature_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT NOT NULL, recorded_at_ms INTEGER NOT NULL,
          uptime_ms INTEGER NOT NULL, boiler_temperature_c REAL NOT NULL,
          steam_temperature_c REAL,
          brew_target_c REAL NOT NULL, steam_target_c REAL NOT NULL,
          active_mode TEXT NOT NULL, active_target_c REAL NOT NULL,
          heater_enabled INTEGER NOT NULL, heater_active INTEGER NOT NULL,
          pump_active INTEGER, pump_command TEXT, machine_status TEXT NOT NULL, fault_code TEXT,
          steam_control_json TEXT, starts_after_history_gap INTEGER NOT NULL,
          source_boot_id TEXT, source_sequence INTEGER,
          controller_diagnostics_json TEXT
        );
        INSERT INTO temperature_history VALUES (
          1, 'machine-1', 1000, 500, 91.5, NULL, 93, 115, 'brew', 93,
          1, 1, 0, 'off', 'heating', NULL, NULL, 1, 'legacy', 7, '{}'
        );
      `);
      database.exec(rebuildTemperatureHistoryV8Sql());
      const columns = database.query("PRAGMA table_info(temperature_history)")
        .all() as Array<{ name: string }>;
      expect(columns.some((column) => column.name.startsWith("source_"))).toBe(false);
      expect(columns.some((column) => column.name.includes("controller"))).toBe(false);
      expect(columns.some((column) => column.name === "pump_active")).toBe(false);
      expect(columns.some((column) => column.name === "steam_control_json")).toBe(false);
      expect(database.query("SELECT boiler_temperature_c, steam_temperature_c FROM temperature_history").get())
        .toEqual({ boiler_temperature_c: 91.5, steam_temperature_c: null });
    } finally {
      database.close();
    }
  });

  test("exports stable useful columns with spreadsheet-safe text", () => {
    const csv = temperatureHistoryToCsv([
      { ...sample("=machine,1", Date.UTC(2026, 6, 18, 13), 5_000), faultCode: "sensor_failure" },
    ]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(TEMPERATURE_HISTORY_CSV_HEADER);
    expect(lines[1]).toContain("2026-07-18T13:00:00.000Z");
    expect(lines[1]).toContain('"\'=machine,1"');
    expect(lines[1]).toContain("sensor_failure");
  });

  test("calculates local calendar-day boundaries", () => {
    const range = localDayRange(new Date(2026, 6, 18, 12, 30).getTime());
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
  return {
    activeMode: "brew",
    activeTargetC: 93,
    boilerTemperatureC: 92,
    steamTemperatureC: 114,
    brewTargetC: 93,
    deviceId,
    faultCode: null,
    heaterActive: false,
    heaterEnabled: true,
    machineStatus: "ready",
    pumpCommand: "off",
    recordedAtMs,
    startsAfterHistoryGap: false,
    steamTargetC: 115,
    uptimeMs,
  };
}
