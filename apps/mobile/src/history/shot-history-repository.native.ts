import * as SQLite from "expo-sqlite";
import type { ProfileSlotId, ScaleCompletionReason } from "@philcoino/protocol";

import type { WeightedShotSummary } from "./shot-history";
import type { ShotHistoryRepository } from "./shot-history-repository";

const DATABASE_NAME = "philcoino-mobile.db";
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

class SQLiteShotHistoryRepository implements ShotHistoryRepository {
  private databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

  async append(summary: WeightedShotSummary): Promise<void> {
    const database = await this.database();
    await database.runAsync(
      `INSERT OR REPLACE INTO weighted_shot_history (
        device_id, extraction_id, recorded_at_ms, profile_id,
        target_decigrams, compensation_decigrams, cutoff_decigrams,
        final_weight_decigrams, settled, duration_ms, outcome, fallback_occurred
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      summary.deviceId, summary.extractionId, summary.recordedAtMs,
      summary.profileId, summary.targetDecigrams, summary.compensationDecigrams,
      summary.cutoffDecigrams, summary.finalWeightDecigrams,
      summary.settled ? 1 : 0, summary.durationMs, summary.outcome,
      summary.fallbackOccurred ? 1 : 0,
    );
    await this.prune(summary.recordedAtMs);
  }

  async clearDevice(deviceId: string): Promise<void> {
    await (await this.database()).runAsync(
      "DELETE FROM weighted_shot_history WHERE device_id = ?",
      deviceId,
    );
  }

  async load(
    deviceId: string,
    nowMs = Date.now(),
  ): Promise<WeightedShotSummary[]> {
    await this.prune(nowMs);
    const rows = await (await this.database()).getAllAsync<Record<string, unknown>>(
      `SELECT * FROM weighted_shot_history
       WHERE device_id = ? ORDER BY recorded_at_ms DESC`,
      deviceId,
    );
    return rows.map((row) => ({
      compensationDecigrams: Number(row.compensation_decigrams),
      cutoffDecigrams: Number(row.cutoff_decigrams),
      deviceId: String(row.device_id),
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      extractionId: String(row.extraction_id),
      fallbackOccurred: Number(row.fallback_occurred) === 1,
      finalWeightDecigrams:
        row.final_weight_decigrams === null
          ? null
          : Number(row.final_weight_decigrams),
      outcome: String(row.outcome) as ScaleCompletionReason,
      profileId: String(row.profile_id) as ProfileSlotId,
      recordedAtMs: Number(row.recorded_at_ms),
      settled: Number(row.settled) === 1,
      targetDecigrams: Number(row.target_decigrams),
    }));
  }

  async prune(nowMs = Date.now()): Promise<void> {
    await (await this.database()).runAsync(
      "DELETE FROM weighted_shot_history WHERE recorded_at_ms < ?",
      nowMs - RETENTION_MS,
    );
  }

  private async database(): Promise<SQLite.SQLiteDatabase> {
    this.databasePromise ??= this.open();
    return this.databasePromise;
  }

  private async open(): Promise<SQLite.SQLiteDatabase> {
    const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await database.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS weighted_shot_history (
        device_id TEXT NOT NULL,
        extraction_id TEXT NOT NULL,
        recorded_at_ms INTEGER NOT NULL,
        profile_id TEXT NOT NULL,
        target_decigrams INTEGER NOT NULL,
        compensation_decigrams INTEGER NOT NULL,
        cutoff_decigrams INTEGER NOT NULL,
        final_weight_decigrams INTEGER,
        settled INTEGER NOT NULL,
        duration_ms INTEGER,
        outcome TEXT NOT NULL,
        fallback_occurred INTEGER NOT NULL,
        PRIMARY KEY(device_id, extraction_id)
      );
      CREATE INDEX IF NOT EXISTS weighted_shot_history_device_time
        ON weighted_shot_history(device_id, recorded_at_ms);
    `);
    return database;
  }
}

export const shotHistoryRepository = new SQLiteShotHistoryRepository();
