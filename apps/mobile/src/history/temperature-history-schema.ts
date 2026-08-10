export const TEMPERATURE_HISTORY_DATABASE_VERSION = 7;

export function createTemperatureHistoryTableSql(
  tableName = "temperature_history",
): string {
  assertInternalTableName(tableName);
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
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
      pump_command TEXT CHECK(pump_command IS NULL OR pump_command IN ('running', 'off')),
      machine_status TEXT NOT NULL CHECK(machine_status IN ('heating', 'ready', 'fault')),
      fault_code TEXT CHECK(fault_code IS NULL OR fault_code IN (
        'sensor_failure', 'over_temperature', 'heating_timeout', 'internal_error'
      )),
      steam_control_json TEXT,
      starts_after_history_gap INTEGER NOT NULL DEFAULT 0
        CHECK(starts_after_history_gap IN (0, 1)),
      UNIQUE(device_id, recorded_at_ms)
    );
  `;
}

export function rebuildTemperatureHistoryV7Sql(): string {
  return `
    DROP TABLE IF EXISTS temperature_history_v7;
    ${createTemperatureHistoryTableSql("temperature_history_v7")}
    INSERT INTO temperature_history_v7 (
      id, device_id, recorded_at_ms, uptime_ms, boiler_temperature_c,
      brew_target_c, steam_target_c, active_mode, active_target_c,
      heater_enabled, heater_active, pump_command, machine_status, fault_code,
      steam_control_json, starts_after_history_gap
    )
    SELECT
      id, device_id, recorded_at_ms, uptime_ms, boiler_temperature_c,
      brew_target_c, steam_target_c, active_mode, active_target_c,
      heater_enabled, heater_active, pump_command, machine_status, fault_code,
      steam_control_json, starts_after_history_gap
    FROM temperature_history;
    DROP TABLE temperature_history;
    ALTER TABLE temperature_history_v7 RENAME TO temperature_history;
  `;
}

function assertInternalTableName(tableName: string): void {
  if (!/^temperature_history(?:_v7)?$/.test(tableName)) {
    throw new TypeError("Unexpected temperature-history table name.");
  }
}
