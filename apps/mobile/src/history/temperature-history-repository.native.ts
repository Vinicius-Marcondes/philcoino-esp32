import * as SQLite from "expo-sqlite";

import type { TemperatureHistorySample } from "./temperature-history";
import { localDayRange } from "./temperature-history";
import type {
  RecoveredHistoryPage,
  TemperatureHistoryRepository,
} from "./temperature-history-repository";
import type { HistoryCursor } from "@philcoino/protocol";

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
  pump_active: unknown;
  recorded_at_ms: unknown;
  source_boot_id: unknown;
  source_sequence: unknown;
  starts_after_history_gap: unknown;
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
        pump_active,
        machine_status,
        fault_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id, recorded_at_ms) DO UPDATE SET
        uptime_ms = excluded.uptime_ms,
        boiler_temperature_c = excluded.boiler_temperature_c,
        brew_target_c = excluded.brew_target_c,
        steam_target_c = excluded.steam_target_c,
        active_mode = excluded.active_mode,
        active_target_c = excluded.active_target_c,
        heater_enabled = excluded.heater_enabled,
        heater_active = excluded.heater_active,
        pump_active = excluded.pump_active,
        machine_status = excluded.machine_status,
        fault_code = excluded.fault_code
      WHERE temperature_history.source_sequence IS NULL`,
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
      sample.pumpActive === null ? null : sample.pumpActive ? 1 : 0,
      sample.machineStatus,
      sample.faultCode,
    );
    await this.prune(sample.recordedAtMs);
  }

  async clearDevice(deviceId: string): Promise<void> {
    const database = await this.database();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        "DELETE FROM temperature_history WHERE device_id = ?",
        deviceId,
      );
      await transaction.runAsync(
        "DELETE FROM temperature_history_sync WHERE device_id = ?",
        deviceId,
      );
    });
  }

  async loadSyncCursor(deviceId: string): Promise<HistoryCursor | null> {
    const database = await this.database();
    const row = await database.getFirstAsync<{
      after_sequence: unknown;
      boot_id: unknown;
    }>(
      `SELECT boot_id, after_sequence
       FROM temperature_history_sync
       WHERE device_id = ?`,
      deviceId,
    );
    if (row === null) {
      return null;
    }
    return {
      afterSequence: nonNegativeInteger(row.after_sequence),
      bootId: historyBootId(row.boot_id),
    };
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
        pump_active,
        machine_status,
        fault_code
        ,source_boot_id
        ,source_sequence
        ,starts_after_history_gap
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

  async storeRecoveredPage(
    deviceId: string,
    page: RecoveredHistoryPage,
  ): Promise<void> {
    const database = await this.database();
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const first = page.samples[0];
      const last = page.samples.at(-1);
      if (first !== undefined && last !== undefined) {
        await transaction.runAsync(
          `DELETE FROM temperature_history
           WHERE device_id = ?
             AND source_sequence IS NULL
             AND uptime_ms >= ?
             AND uptime_ms <= ?
             AND recorded_at_ms >= ?
             AND recorded_at_ms <= ?`,
          deviceId,
          first.uptimeMs,
          last.uptimeMs,
          first.recordedAtMs - 5_000,
          last.recordedAtMs + 5_000,
        );
      }

      for (const sample of page.samples) {
        await transaction.runAsync(
          `INSERT OR REPLACE INTO temperature_history (
            device_id, recorded_at_ms, uptime_ms,
            boiler_temperature_c, brew_target_c, steam_target_c,
            active_mode, active_target_c, heater_enabled, heater_active,
            pump_active, machine_status, fault_code,
            source_boot_id, source_sequence, starts_after_history_gap
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          sample.pumpActive === null ? null : sample.pumpActive ? 1 : 0,
          sample.machineStatus,
          sample.faultCode,
          sample.sourceBootId,
          sample.sourceSequence,
          sample.startsAfterHistoryGap ? 1 : 0,
        );
      }

      await transaction.runAsync(
        `INSERT INTO temperature_history_sync (device_id, boot_id, after_sequence)
         VALUES (?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
           boot_id = excluded.boot_id,
           after_sequence = excluded.after_sequence`,
        deviceId,
        page.cursor.bootId,
        page.cursor.afterSequence,
      );
    });
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
        pump_active INTEGER CHECK(pump_active IS NULL OR pump_active IN (0, 1)),
        machine_status TEXT NOT NULL CHECK(machine_status IN ('heating', 'ready', 'fault')),
        fault_code TEXT CHECK(fault_code IS NULL OR fault_code IN (
          'sensor_failure',
          'over_temperature',
          'heating_timeout',
          'internal_error'
        )),
        source_boot_id TEXT,
        source_sequence INTEGER,
        starts_after_history_gap INTEGER NOT NULL DEFAULT 0
          CHECK(starts_after_history_gap IN (0, 1)),
        UNIQUE(device_id, recorded_at_ms)
      );
      CREATE INDEX IF NOT EXISTS temperature_history_device_time
        ON temperature_history(device_id, recorded_at_ms);
      CREATE TABLE IF NOT EXISTS temperature_history_sync (
        device_id TEXT PRIMARY KEY,
        boot_id TEXT NOT NULL,
        after_sequence INTEGER NOT NULL
      );
    `);
    const columns = await database.getAllAsync<{ name: unknown }>(
      "PRAGMA table_info(temperature_history)",
    );
    if (!columns.some((column) => column.name === "pump_active")) {
      await database.execAsync(`
        ALTER TABLE temperature_history
          ADD COLUMN pump_active INTEGER
          CHECK(pump_active IS NULL OR pump_active IN (0, 1));
      `);
    }
    if (!columns.some((column) => column.name === "source_boot_id")) {
      await database.execAsync(
        "ALTER TABLE temperature_history ADD COLUMN source_boot_id TEXT;",
      );
    }
    if (!columns.some((column) => column.name === "source_sequence")) {
      await database.execAsync(
        "ALTER TABLE temperature_history ADD COLUMN source_sequence INTEGER;",
      );
    }
    if (!columns.some((column) => column.name === "starts_after_history_gap")) {
      await database.execAsync(`
        ALTER TABLE temperature_history
          ADD COLUMN starts_after_history_gap INTEGER NOT NULL DEFAULT 0
          CHECK(starts_after_history_gap IN (0, 1));
      `);
    }
    await database.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS temperature_history_device_source
        ON temperature_history(device_id, source_boot_id, source_sequence)
        WHERE source_boot_id IS NOT NULL AND source_sequence IS NOT NULL;
      PRAGMA user_version = 3;
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
    pumpActive: nullableSqliteBoolean(row.pump_active),
    recordedAtMs: nonNegativeInteger(row.recorded_at_ms),
    sourceBootId:
      row.source_boot_id === null ? null : historyBootId(row.source_boot_id),
    sourceSequence:
      row.source_sequence === null
        ? null
        : nonNegativeInteger(row.source_sequence),
    startsAfterHistoryGap: sqliteBoolean(row.starts_after_history_gap),
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

function historyBootId(value: unknown): string {
  const bootId = nonEmptyString(value);
  if (!/^[0-9a-f]{32}$/.test(bootId)) {
    throw new Error("Stored temperature history contains an invalid boot ID.");
  }
  return bootId;
}

function sqliteBoolean(value: unknown): boolean {
  if (value !== 0 && value !== 1) {
    throw new Error("Stored temperature history contains an invalid boolean.");
  }
  return value === 1;
}

function nullableSqliteBoolean(value: unknown): boolean | null {
  return value === null ? null : sqliteBoolean(value);
}

export const temperatureHistoryRepository =
  new SQLiteTemperatureHistoryRepository();
