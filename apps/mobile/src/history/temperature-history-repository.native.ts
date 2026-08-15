import * as SQLite from "expo-sqlite";

import type { TemperatureHistorySample } from "./temperature-history";
import { localDayRange } from "./temperature-history";
import {
  createTemperatureHistoryTableSql,
  rebuildTemperatureHistoryV8Sql,
  TEMPERATURE_HISTORY_DATABASE_VERSION,
} from "./temperature-history-schema";
import type { TemperatureHistoryRepository } from "./temperature-history-repository";

type Row = Record<string, unknown>;
const DATABASE_NAME = "philcoino-mobile.db";

class SQLiteTemperatureHistoryRepository
  implements TemperatureHistoryRepository
{
  private databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

  async append(sample: TemperatureHistorySample): Promise<void> {
    const database = await this.database();
    const previous = await database.getFirstAsync<{ recorded_at_ms: number; uptime_ms: number }>(
      `SELECT recorded_at_ms, uptime_ms FROM temperature_history
       WHERE device_id = ? ORDER BY recorded_at_ms DESC LIMIT 1`,
      sample.deviceId,
    );
    const startsAfterGap =
      sample.startsAfterHistoryGap ||
      (previous !== null &&
        (sample.recordedAtMs - previous.recorded_at_ms > 2_500 ||
          sample.uptimeMs <= previous.uptime_ms ||
          sample.uptimeMs - previous.uptime_ms > 2_500));
    await database.runAsync(
      `INSERT INTO temperature_history (
        device_id, recorded_at_ms, uptime_ms, boiler_temperature_c, steam_temperature_c,
        brew_target_c, steam_target_c, active_mode, active_target_c,
        heater_enabled, heater_active, pump_command, machine_status, fault_code,
        starts_after_history_gap
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id, recorded_at_ms) DO UPDATE SET
        uptime_ms = excluded.uptime_ms,
        boiler_temperature_c = excluded.boiler_temperature_c,
        steam_temperature_c = excluded.steam_temperature_c,
        brew_target_c = excluded.brew_target_c,
        steam_target_c = excluded.steam_target_c,
        active_mode = excluded.active_mode,
        active_target_c = excluded.active_target_c,
        heater_enabled = excluded.heater_enabled,
        heater_active = excluded.heater_active,
        pump_command = excluded.pump_command,
        machine_status = excluded.machine_status,
        fault_code = excluded.fault_code,
        starts_after_history_gap = excluded.starts_after_history_gap`,
      sample.deviceId,
      sample.recordedAtMs,
      sample.uptimeMs,
      sample.boilerTemperatureC,
      sample.steamTemperatureC,
      sample.brewTargetC,
      sample.steamTargetC,
      sample.activeMode,
      sample.activeTargetC,
      sample.heaterEnabled ? 1 : 0,
      sample.heaterActive ? 1 : 0,
      sample.pumpCommand,
      sample.machineStatus,
      sample.faultCode,
      startsAfterGap ? 1 : 0,
    );
  }

  async clearDevice(deviceId: string): Promise<void> {
    await (await this.database()).runAsync(
      "DELETE FROM temperature_history WHERE device_id = ?",
      deviceId,
    );
  }

  async initialize(): Promise<void> {
    await this.database();
  }

  async *iterateAll(deviceId: string): AsyncIterable<TemperatureHistorySample> {
    const database = await this.database();
    for await (const row of database.getEachAsync<Row>(
      `${selectColumns()} WHERE device_id = ? ORDER BY recorded_at_ms ASC`,
      deviceId,
    )) {
      yield rowToSample(row);
    }
  }

  async loadToday(
    deviceId: string,
    nowMs = Date.now(),
  ): Promise<TemperatureHistorySample[]> {
    const range = localDayRange(nowMs);
    const rows = await (await this.database()).getAllAsync<Row>(
      `${selectColumns()}
       WHERE device_id = ? AND recorded_at_ms >= ? AND recorded_at_ms < ?
       ORDER BY recorded_at_ms ASC`,
      deviceId,
      range.startMs,
      range.endMs,
    );
    return rows.map(rowToSample);
  }

  private database(): Promise<SQLite.SQLiteDatabase> {
    this.databasePromise ??= this.openDatabase();
    return this.databasePromise;
  }

  private async openDatabase(): Promise<SQLite.SQLiteDatabase> {
    const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await database.execAsync(`
      PRAGMA journal_mode = WAL;
      ${createTemperatureHistoryTableSql()}
    `);
    const columns = await database.getAllAsync<{ name: string }>(
      "PRAGMA table_info(temperature_history)",
    );
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("pump_command")) {
      await database.execAsync("ALTER TABLE temperature_history ADD COLUMN pump_command TEXT;");
      if (names.has("pump_active")) {
        await database.execAsync(
          `UPDATE temperature_history
           SET pump_command = CASE pump_active
             WHEN 1 THEN 'running' WHEN 0 THEN 'off' ELSE NULL END;`,
        );
      }
    }
    if (!names.has("steam_temperature_c")) {
      await database.execAsync("ALTER TABLE temperature_history ADD COLUMN steam_temperature_c REAL;");
    }
    if (!names.has("starts_after_history_gap")) {
      await database.execAsync(
        "ALTER TABLE temperature_history ADD COLUMN starts_after_history_gap INTEGER NOT NULL DEFAULT 0;",
      );
    }
    if (
      names.has("pump_active") ||
      names.has("source_boot_id") ||
      names.has("source_sequence") ||
      names.has("controller_configuration_json") ||
      names.has("controller_diagnostics_json") ||
      names.has("predictive_temperature_json")
      || names.has("steam_control_json")
      || !names.has("steam_temperature_c")
    ) {
      await database.withExclusiveTransactionAsync((transaction) =>
        transaction.execAsync(rebuildTemperatureHistoryV8Sql()),
      );
    }
    await database.execAsync(`
      DROP TABLE IF EXISTS temperature_history_sync;
      CREATE INDEX IF NOT EXISTS temperature_history_device_time
        ON temperature_history(device_id, recorded_at_ms);
      PRAGMA user_version = ${TEMPERATURE_HISTORY_DATABASE_VERSION};
    `);
    return database;
  }
}

function selectColumns(): string {
  return `SELECT device_id, recorded_at_ms, uptime_ms, boiler_temperature_c, steam_temperature_c,
    brew_target_c, steam_target_c, active_mode, active_target_c,
    heater_enabled, heater_active, pump_command, machine_status, fault_code,
    starts_after_history_gap FROM temperature_history`;
}

function rowToSample(row: Row): TemperatureHistorySample {
  const activeMode = row.active_mode;
  if (activeMode !== "brew" && activeMode !== "steam") {
    throw new TypeError("Stored active mode is invalid.");
  }
  const status = row.machine_status;
  if (status !== "heating" && status !== "ready" && status !== "fault") {
    throw new TypeError("Stored machine status is invalid.");
  }
  const faultCode = row.fault_code;
  if (
    faultCode !== null &&
    faultCode !== "sensor_failure" &&
    faultCode !== "over_temperature" &&
    faultCode !== "heating_timeout" &&
    faultCode !== "internal_error"
  ) {
    throw new TypeError("Stored fault code is invalid.");
  }
  return {
    activeMode,
    activeTargetC: Number(row.active_target_c),
    boilerTemperatureC: row.boiler_temperature_c === null
      ? null
      : Number(row.boiler_temperature_c),
    brewTargetC: Number(row.brew_target_c),
    deviceId: String(row.device_id),
    faultCode,
    heaterActive: Number(row.heater_active) === 1,
    heaterEnabled: Number(row.heater_enabled) === 1,
    machineStatus: status,
    pumpCommand: storedPumpCommand(row.pump_command),
    recordedAtMs: Number(row.recorded_at_ms),
    startsAfterHistoryGap: Number(row.starts_after_history_gap) === 1,
    steamTemperatureC: row.steam_temperature_c === null
      ? null
      : Number(row.steam_temperature_c),
    steamTargetC: Number(row.steam_target_c),
    uptimeMs: Number(row.uptime_ms),
  };
}

function storedPumpCommand(
  value: unknown,
): TemperatureHistorySample["pumpCommand"] {
  if (value === null || value === "running" || value === "off") return value;
  throw new TypeError("Stored pump command is invalid.");
}

export const temperatureHistoryRepository =
  new SQLiteTemperatureHistoryRepository();
