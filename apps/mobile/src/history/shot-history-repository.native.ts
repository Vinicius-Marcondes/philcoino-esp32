import * as SQLite from "expo-sqlite";
import type {
  ProfileSlotId,
  ScaleCompletionReason,
  WeightedExtractionTracePage,
  WeightedExtractionTracePhase,
  ScaleAvailability,
  PumpCommand,
} from "@philcoino/protocol";

import type { WeightedShotSummary } from "./shot-history";
import type { ShotHistoryRepository } from "./shot-history-repository";
import {
  mergeTracePage,
  type StoredWeightedShotTrace,
  type TraceCompleteness,
  type TraceGapStatus,
} from "./weighted-shot-trace";

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
    const database = await this.database();
    await database.withTransactionAsync(async () => {
      await database.runAsync(
        "DELETE FROM weighted_shot_trace_samples WHERE device_id = ?",
        deviceId,
      );
      await database.runAsync(
        "DELETE FROM weighted_shot_traces WHERE device_id = ?",
        deviceId,
      );
      await database.runAsync(
        "DELETE FROM weighted_shot_history WHERE device_id = ?",
        deviceId,
      );
    });
  }

  async commitTracePage(
    deviceId: string,
    page: WeightedExtractionTracePage,
  ): Promise<StoredWeightedShotTrace> {
    const database = await this.database();
    const previous = await this.loadTrace(deviceId, page.extractionId);
    const trace = mergeTracePage(previous, deviceId, page);
    await database.withTransactionAsync(async () => {
      await database.runAsync(
        `INSERT OR REPLACE INTO weighted_shot_traces
          (device_id, extraction_id, boot_id, completeness)
         VALUES (?, ?, ?, ?)`,
        trace.deviceId,
        trace.extractionId,
        trace.bootId,
        trace.completeness,
      );
      for (const sample of trace.samples) {
        await database.runAsync(
          `INSERT OR REPLACE INTO weighted_shot_trace_samples (
            device_id, extraction_id, boot_id, sequence, uptime_ms, elapsed_ms,
            phase, boiler_temperature_c, active_target_c,
            net_weight_decigrams, scale_availability, pump_command,
            derived_flow_g_per_s, gap_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          trace.deviceId, trace.extractionId, trace.bootId, sample.sequence,
          sample.uptimeMs, sample.elapsedMs, sample.phase,
          sample.boilerTemperatureC, sample.activeTargetC,
          sample.netWeightDecigrams, sample.scaleAvailability,
          sample.pumpCommand, sample.derivedFlowGPerS, sample.gapStatus,
        );
      }
    });
    return trace;
  }

  async load(
    deviceId: string,
    nowMs = Date.now(),
  ): Promise<WeightedShotSummary[]> {
    await this.prune(nowMs);
    const rows = await (await this.database()).getAllAsync<Record<string, unknown>>(
      `SELECT h.*, t.completeness AS trace_completeness,
              (SELECT COUNT(*) FROM weighted_shot_trace_samples s
               WHERE s.device_id = h.device_id
                 AND s.extraction_id = h.extraction_id) AS trace_sample_count
       FROM weighted_shot_history h
       LEFT JOIN weighted_shot_traces t
         ON t.device_id = h.device_id
        AND t.extraction_id = h.extraction_id
       WHERE h.device_id = ? ORDER BY h.recorded_at_ms DESC`,
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
      traceCompleteness:
        row.trace_completeness === null
          ? null
          : String(row.trace_completeness) as TraceCompleteness,
      traceSampleCount: Number(row.trace_sample_count),
    }));
  }

  async prune(nowMs = Date.now()): Promise<void> {
    const database = await this.database();
    const cutoff = nowMs - RETENTION_MS;
    await database.withTransactionAsync(async () => {
      await database.runAsync(
        `DELETE FROM weighted_shot_trace_samples
         WHERE (device_id, extraction_id) IN (
           SELECT device_id, extraction_id FROM weighted_shot_history
           WHERE recorded_at_ms < ?
         )`,
        cutoff,
      );
      await database.runAsync(
        `DELETE FROM weighted_shot_traces
         WHERE (device_id, extraction_id) IN (
           SELECT device_id, extraction_id FROM weighted_shot_history
           WHERE recorded_at_ms < ?
         )`,
        cutoff,
      );
      await database.runAsync(
        "DELETE FROM weighted_shot_history WHERE recorded_at_ms < ?",
        cutoff,
      );
    });
  }

  async loadTrace(
    deviceId: string,
    extractionId: string,
  ): Promise<StoredWeightedShotTrace | null> {
    const database = await this.database();
    const metadata = await database.getFirstAsync<Record<string, unknown>>(
      `SELECT * FROM weighted_shot_traces
       WHERE device_id = ? AND extraction_id = ?`,
      deviceId,
      extractionId,
    );
    if (metadata === null) return null;
    const rows = await database.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM weighted_shot_trace_samples
       WHERE device_id = ? AND extraction_id = ?
       ORDER BY sequence`,
      deviceId,
      extractionId,
    );
    return {
      bootId: String(metadata.boot_id),
      completeness: String(metadata.completeness) as TraceCompleteness,
      deviceId,
      extractionId,
      samples: rows.map((row) => ({
        activeTargetC: Number(row.active_target_c),
        boilerTemperatureC: Number(row.boiler_temperature_c),
        derivedFlowGPerS:
          row.derived_flow_g_per_s === null
            ? null
            : Number(row.derived_flow_g_per_s),
        elapsedMs: Number(row.elapsed_ms),
        gapStatus: String(row.gap_status) as TraceGapStatus,
        netWeightDecigrams:
          row.net_weight_decigrams === null
            ? null
            : Number(row.net_weight_decigrams),
        phase: String(row.phase) as WeightedExtractionTracePhase,
        pumpCommand: String(row.pump_command) as PumpCommand,
        scaleAvailability: String(row.scale_availability) as ScaleAvailability,
        sequence: Number(row.sequence),
        uptimeMs: Number(row.uptime_ms),
      })),
    };
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
      CREATE TABLE IF NOT EXISTS weighted_shot_traces (
        device_id TEXT NOT NULL,
        extraction_id TEXT NOT NULL,
        boot_id TEXT NOT NULL,
        completeness TEXT NOT NULL,
        PRIMARY KEY(device_id, extraction_id)
      );
      CREATE TABLE IF NOT EXISTS weighted_shot_trace_samples (
        device_id TEXT NOT NULL,
        extraction_id TEXT NOT NULL,
        boot_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        uptime_ms INTEGER NOT NULL,
        elapsed_ms INTEGER NOT NULL,
        phase TEXT NOT NULL,
        boiler_temperature_c REAL NOT NULL,
        active_target_c INTEGER NOT NULL,
        net_weight_decigrams INTEGER,
        scale_availability TEXT NOT NULL,
        pump_command TEXT NOT NULL,
        derived_flow_g_per_s REAL,
        gap_status TEXT NOT NULL,
        PRIMARY KEY(device_id, extraction_id, boot_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS weighted_shot_trace_lookup
        ON weighted_shot_trace_samples(device_id, extraction_id, sequence);
    `);
    return database;
  }
}

export const shotHistoryRepository = new SQLiteShotHistoryRepository();
