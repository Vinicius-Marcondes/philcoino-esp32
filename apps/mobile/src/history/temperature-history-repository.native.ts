import * as SQLite from "expo-sqlite";

import type { TemperatureHistorySample } from "./temperature-history";
import { localDayRange } from "./temperature-history";
import type { TemperatureHistoryRepository } from "./temperature-history-repository";

interface TemperatureHistoryRow {
  active_mode: unknown;
  active_target_c: unknown;
  boiler_temperature_c: unknown;
  brew_target_c: unknown;
  device_id: unknown;
  fault_code: unknown;
  heater_active: unknown;
  heater_enabled: unknown;
  machine_status: unknown;
  recorded_at_ms: unknown;
  steam_target_c: unknown;
  uptime_ms: unknown;
}

const DATABASE_NAME = "philcoino-mobile.db";

class SQLiteTemperatureHistoryRepository
  implements TemperatureHistoryRepository
{
  private databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

  async append(sample: TemperatureHistorySample): Promise<void> {
    const database = await this.database();
    await database.runAsync(
      `INSERT INTO temperature_history (
        device_id,
        recorded_at_ms,
        uptime_ms,
        boiler_temperature_c,
        brew_target_c,
        steam_target_c,
        active_mode,
        active_target_c,
        heater_enabled,
        heater_active,
        machine_status,
        fault_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id, recorded_at_ms) DO UPDATE SET
        uptime_ms = excluded.uptime_ms,
        boiler_temperature_c = excluded.boiler_temperature_c,
        brew_target_c = excluded.brew_target_c,
        steam_target_c = excluded.steam_target_c,
        active_mode = excluded.active_mode,
        active_target_c = excluded.active_target_c,
        heater_enabled = excluded.heater_enabled,
        heater_active = excluded.heater_active,
        machine_status = excluded.machine_status,
        fault_code = excluded.fault_code`,
      sample.deviceId,
      sample.recordedAtMs,
      sample.uptimeMs,
      sample.boilerTemperatureC,
      sample.brewTargetC,
      sample.steamTargetC,
      sample.activeMode,
      sample.activeTargetC,
      sample.heaterEnabled ? 1 : 0,
      sample.heaterActive ? 1 : 0,
      sample.machineStatus,
      sample.faultCode,
    );
    await this.prune(sample.recordedAtMs);
  }

  async clearDevice(deviceId: string): Promise<void> {
    const database = await this.database();
    await database.runAsync(
      "DELETE FROM temperature_history WHERE device_id = ?",
      deviceId,
    );
  }

  async initialize(nowMs = Date.now()): Promise<void> {
    await this.database();
    await this.prune(nowMs);
  }

  async *iterateToday(
    deviceId: string,
    nowMs = Date.now(),
  ): AsyncIterable<TemperatureHistorySample> {
    for (const sample of await this.loadToday(deviceId, nowMs)) {
      yield sample;
    }
  }

  async loadToday(
    deviceId: string,
    nowMs = Date.now(),
  ): Promise<TemperatureHistorySample[]> {
    await this.prune(nowMs);
    const database = await this.database();
    const range = localDayRange(nowMs);
    const rows = await database.getAllAsync<TemperatureHistoryRow>(
      `SELECT
        device_id,
        recorded_at_ms,
        uptime_ms,
        boiler_temperature_c,
        brew_target_c,
        steam_target_c,
        active_mode,
        active_target_c,
        heater_enabled,
        heater_active,
        machine_status,
        fault_code
      FROM temperature_history
      WHERE device_id = ? AND recorded_at_ms >= ? AND recorded_at_ms < ?
      ORDER BY recorded_at_ms ASC`,
      deviceId,
      range.startMs,
      range.endMs,
    );
    return rows.map(rowToSample);
  }

  async prune(nowMs = Date.now()): Promise<void> {
    const database = await this.database();
    const range = localDayRange(nowMs);
    await database.runAsync(
      "DELETE FROM temperature_history WHERE recorded_at_ms < ? OR recorded_at_ms >= ?",
      range.startMs,
      range.endMs,
    );
  }

  private database(): Promise<SQLite.SQLiteDatabase> {
    this.databasePromise ??= this.openDatabase();
    return this.databasePromise;
  }

  private async openDatabase(): Promise<SQLite.SQLiteDatabase> {
    const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await database.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS temperature_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        recorded_at_ms INTEGER NOT NULL,
        uptime_ms INTEGER NOT NULL,
        boiler_temperature_c REAL NOT NULL,
        brew_target_c REAL NOT NULL,
        steam_target_c REAL NOT NULL,
        active_mode TEXT NOT NULL CHECK(active_mode IN ('brew', 'steam')),
        active_target_c REAL NOT NULL,
        heater_enabled INTEGER NOT NULL CHECK(heater_enabled IN (0, 1)),
        heater_active INTEGER NOT NULL CHECK(heater_active IN (0, 1)),
        machine_status TEXT NOT NULL CHECK(machine_status IN ('heating', 'ready', 'fault')),
        fault_code TEXT CHECK(fault_code IS NULL OR fault_code IN (
          'sensor_failure',
          'over_temperature',
          'heating_timeout',
          'internal_error'
        )),
        UNIQUE(device_id, recorded_at_ms)
      );
      CREATE INDEX IF NOT EXISTS temperature_history_device_time
        ON temperature_history(device_id, recorded_at_ms);
      PRAGMA user_version = 1;
    `);
    return database;
  }
}

function rowToSample(row: TemperatureHistoryRow): TemperatureHistorySample {
  const activeMode = enumValue(row.active_mode, ["brew", "steam"] as const);
  const machineStatus = enumValue(
    row.machine_status,
    ["heating", "ready", "fault"] as const,
  );
  const faultCode =
    row.fault_code === null
      ? null
      : enumValue(
          row.fault_code,
          [
            "sensor_failure",
            "over_temperature",
            "heating_timeout",
            "internal_error",
          ] as const,
        );

  return {
    activeMode,
    activeTargetC: finiteNumber(row.active_target_c),
    boilerTemperatureC: finiteNumber(row.boiler_temperature_c),
    brewTargetC: finiteNumber(row.brew_target_c),
    deviceId: nonEmptyString(row.device_id),
    faultCode,
    heaterActive: sqliteBoolean(row.heater_active),
    heaterEnabled: sqliteBoolean(row.heater_enabled),
    machineStatus,
    recordedAtMs: nonNegativeInteger(row.recorded_at_ms),
    steamTargetC: finiteNumber(row.steam_target_c),
    uptimeMs: nonNegativeInteger(row.uptime_ms),
  };
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error("Stored temperature history contains an invalid enum value.");
  }
  return value as T[number];
}

function finiteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Stored temperature history contains an invalid number.");
  }
  return value;
}

function nonNegativeInteger(value: unknown): number {
  const number = finiteNumber(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error("Stored temperature history contains an invalid integer.");
  }
  return number;
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Stored temperature history contains an invalid device ID.");
  }
  return value;
}

function sqliteBoolean(value: unknown): boolean {
  if (value !== 0 && value !== 1) {
    throw new Error("Stored temperature history contains an invalid boolean.");
  }
  return value === 1;
}

export const temperatureHistoryRepository =
  new SQLiteTemperatureHistoryRepository();
