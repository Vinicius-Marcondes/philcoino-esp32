import * as SQLite from "expo-sqlite";
import type {
  ProfileSlotId,
  ExtractionOutcome,
  ExtractionTelemetryControlMode,
  ExtractionTelemetryPage,
  ExtractionTelemetryPhase,
  ScaleAvailability,
  PumpCommand,
  TerminalWeightExtraction,
} from "@philcoino/protocol";
import { ExtractionSelectionSchema } from "@philcoino/protocol";

import type { ExtractionSummary, WeightedShotSummary } from "./shot-history";
import type { ShotHistoryRepository } from "./shot-history-repository";
import {
  mergeExtractionTracePage,
  type StoredExtractionTrace,
  type TraceCompleteness,
  type TraceGapStatus,
} from "./extraction-trace";

const DATABASE_NAME = "philcoino-mobile.db";
class SQLiteShotHistoryRepository implements ShotHistoryRepository {
  private databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

  async append(summary: ExtractionSummary | WeightedShotSummary): Promise<void> {
    const record = normalizeSummary(summary);
    const database = await this.database();
    const storedBootId = record.bootId ?? `pending-${record.extractionId}`;
    const existing = await database.getFirstAsync<{
      boot_id: string;
      recorded_at_ms: number;
    }>(
      `SELECT boot_id, recorded_at_ms FROM extraction_history
       WHERE device_id = ? AND extraction_id = ?
         AND (boot_id = ? OR (? != ? AND boot_id = ?))
       ORDER BY CASE WHEN boot_id = ? THEN 0 ELSE 1 END LIMIT 1`,
      record.deviceId,
      record.extractionId,
      storedBootId,
      storedBootId,
      `pending-${record.extractionId}`,
      `pending-${record.extractionId}`,
      storedBootId,
    );
    await database.withTransactionAsync(async () => {
      if (existing !== null) {
        await database.runAsync(
          `DELETE FROM extraction_history
           WHERE device_id = ? AND extraction_id = ? AND boot_id = ?`,
          record.deviceId,
          record.extractionId,
          existing.boot_id,
        );
      }
      await database.runAsync(
        `INSERT INTO extraction_history (
          device_id, boot_id, extraction_id, recorded_at_ms, control_mode,
          selection_kind, profile_id, selection_profile_json, record_status,
          target_decigrams, compensation_decigrams, cutoff_decigrams,
          final_weight_decigrams, settled, duration_ms, outcome, fallback_occurred
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        record.deviceId, storedBootId,
        record.extractionId, existing?.recorded_at_ms ?? record.recordedAtMs,
        record.controlMode, record.selection.kind, record.profileId,
        record.selection.kind === "profile"
          ? JSON.stringify(record.selection.profile)
          : null,
        record.recordStatus ?? (record.outcome === null ? "incomplete" : "complete"),
        record.targetDecigrams, record.compensationDecigrams,
        record.cutoffDecigrams, record.finalWeightDecigrams,
        nullableBoolean(record.settled), record.durationMs, record.outcome,
        nullableBoolean(record.fallbackOccurred),
      );
    });
  }

  async clearDevice(deviceId: string): Promise<void> {
    const database = await this.database();
    await database.withTransactionAsync(async () => {
      await database.runAsync(
        "DELETE FROM extraction_trace_samples WHERE device_id = ?",
        deviceId,
      );
      await database.runAsync(
        "DELETE FROM extraction_traces WHERE device_id = ?",
        deviceId,
      );
      await database.runAsync(
        "DELETE FROM extraction_history WHERE device_id = ?",
        deviceId,
      );
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

  async markUnfinishedIncomplete(
    deviceId: string,
    retainedExtractionId?: string | null,
  ): Promise<void> {
    const database = await this.database();
    if (retainedExtractionId === undefined || retainedExtractionId === null) {
      await database.runAsync(
        `UPDATE extraction_history SET record_status = 'incomplete', outcome = NULL
         WHERE device_id = ? AND record_status = 'running'`,
        deviceId,
      );
      return;
    }
    await database.runAsync(
      `UPDATE extraction_history SET record_status = 'incomplete', outcome = NULL
       WHERE device_id = ? AND record_status = 'running' AND extraction_id != ?`,
      deviceId,
      retainedExtractionId,
    );
  }

  async commitExtractionTracePage(
    deviceId: string,
    page: ExtractionTelemetryPage,
  ): Promise<StoredExtractionTrace> {
    const database = await this.database();
    const previous = await this.loadTrace(
      deviceId,
      page.extractionId,
      page.bootId,
    );
    const trace = mergeExtractionTracePage(previous, deviceId, page);
    const retainedSequence = trace.samples.at(-1)?.sequence ?? 0;
    await database.withTransactionAsync(async () => {
      await database.runAsync(
        `INSERT OR REPLACE INTO extraction_traces (
          device_id, extraction_id, boot_id, completeness, control_mode,
          selection_kind, profile_id, selection_profile_json,
          baseline_weight_decigrams, outcome,
          weight_target_decigrams, weight_compensation_decigrams,
          terminal_final_weight_decigrams, terminal_settled,
          terminal_completion_reason, terminal_fallback
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        trace.deviceId, trace.extractionId, trace.bootId, trace.completeness,
        trace.controlMode ?? page.controlMode, page.selection.kind,
        page.selection.kind === "profile" ? page.selection.profileId : null,
        page.selection.kind === "profile"
          ? JSON.stringify(page.selection.profile)
          : null,
        trace.baselineWeightDecigrams ?? null, trace.outcome ?? null,
        trace.weightControl?.targetWeightDecigrams ?? null,
        trace.weightControl?.compensationDecigrams ?? null,
        trace.terminalWeight?.finalWeightDecigrams ?? null,
        trace.terminalWeight === null || trace.terminalWeight === undefined
          ? null
          : trace.terminalWeight.settled ? 1 : 0,
        trace.terminalWeight?.completionReason ?? null,
        trace.terminalWeight === null || trace.terminalWeight === undefined
          ? null
          : trace.terminalWeight.fallbackOccurred ? 1 : 0,
      );
      await database.runAsync(
        `DELETE FROM extraction_trace_samples
         WHERE device_id = ? AND extraction_id = ?
           AND (boot_id != ? OR sequence > ?)`,
        trace.deviceId, trace.extractionId, trace.bootId, retainedSequence,
      );
      for (const sample of trace.samples) {
        await database.runAsync(
          `INSERT OR REPLACE INTO extraction_trace_samples (
            device_id, extraction_id, boot_id, sequence, uptime_ms, elapsed_ms,
            extraction_elapsed_ms, phase, boiler_temperature_c, active_target_c,
            heater_active, net_weight_decigrams, scale_availability, pump_command,
            derived_flow_g_per_s, gap_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          trace.deviceId, trace.extractionId, trace.bootId, sample.sequence,
          sample.uptimeMs, sample.elapsedMs,
          sample.extractionElapsedMs ?? sample.elapsedMs, sample.phase,
          sample.boilerTemperatureC, sample.activeTargetC,
          sample.heaterActive === undefined ? null : sample.heaterActive ? 1 : 0,
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
  ): Promise<ExtractionSummary[]> {
    void nowMs;
    const rows = await (await this.database()).getAllAsync<Record<string, unknown>>(
      `SELECT h.*, t.completeness AS trace_completeness,
              (SELECT COUNT(*) FROM extraction_trace_samples s
               WHERE s.device_id = h.device_id
                 AND s.extraction_id = h.extraction_id
                 AND s.boot_id = h.boot_id)
                AS trace_sample_count
       FROM extraction_history h
       LEFT JOIN extraction_traces t
        ON t.device_id = h.device_id
        AND t.boot_id = h.boot_id
        AND t.extraction_id = h.extraction_id
       WHERE h.device_id = ? ORDER BY h.recorded_at_ms DESC`,
      deviceId,
    );
    return rows.map((row) => ({
      compensationDecigrams: nullableNumber(row.compensation_decigrams),
      bootId: String(row.boot_id),
      controlMode: String(row.control_mode) as ExtractionTelemetryControlMode,
      cutoffDecigrams: nullableNumber(row.cutoff_decigrams),
      deviceId: String(row.device_id),
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      extractionId: String(row.extraction_id),
      fallbackOccurred: nullableStoredBoolean(row.fallback_occurred),
      finalWeightDecigrams:
        row.final_weight_decigrams === null
          ? null
          : Number(row.final_weight_decigrams),
      outcome: row.outcome === null
        ? null
        : String(row.outcome) as ExtractionOutcome,
      profileId:
        row.profile_id === null ? null : String(row.profile_id) as ProfileSlotId,
      recordedAtMs: Number(row.recorded_at_ms),
      recordStatus: storedRecordStatus(row.record_status),
      selection: storedSelection(row),
      settled: nullableStoredBoolean(row.settled),
      targetDecigrams: nullableNumber(row.target_decigrams),
      traceCompleteness:
        row.trace_completeness === null
          ? null
          : String(row.trace_completeness) as TraceCompleteness,
      traceSampleCount: Number(row.trace_sample_count),
    }));
  }

  async prune(nowMs = Date.now()): Promise<void> {
    void nowMs;
  }

  async loadTrace(
    deviceId: string,
    extractionId: string,
    requestedBootId?: string | null,
  ): Promise<StoredExtractionTrace | null> {
    const database = await this.database();
    const metadata = requestedBootId === undefined
      ? await database.getFirstAsync<Record<string, unknown>>(
          `SELECT * FROM extraction_traces
           WHERE device_id = ? AND extraction_id = ?
           ORDER BY rowid DESC LIMIT 1`,
          deviceId,
          extractionId,
        )
      : await database.getFirstAsync<Record<string, unknown>>(
          `SELECT * FROM extraction_traces
           WHERE device_id = ? AND extraction_id = ? AND boot_id = ?`,
          deviceId,
          extractionId,
          requestedBootId ?? "legacy",
        );
    if (metadata === null) return null;
    const bootId = String(metadata.boot_id);
    const rows = await database.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM extraction_trace_samples
       WHERE device_id = ? AND extraction_id = ? AND boot_id = ?
       ORDER BY sequence`,
      deviceId,
      extractionId,
      bootId,
    );
    return {
      baselineWeightDecigrams: nullableNumber(metadata.baseline_weight_decigrams),
      bootId,
      completeness: String(metadata.completeness) as TraceCompleteness,
      controlMode: String(metadata.control_mode) as ExtractionTelemetryControlMode,
      deviceId,
      extractionId,
      outcome: metadata.outcome === null
        ? null
        : String(metadata.outcome) as ExtractionOutcome,
      selection: storedSelection(metadata),
      samples: rows.map((row) => ({
        activeTargetC: Number(row.active_target_c),
        boilerTemperatureC: Number(row.boiler_temperature_c),
        derivedFlowGPerS:
          row.derived_flow_g_per_s === null
            ? null
            : Number(row.derived_flow_g_per_s),
        elapsedMs: Number(row.elapsed_ms),
        extractionElapsedMs: Number(row.extraction_elapsed_ms),
        gapStatus: String(row.gap_status) as TraceGapStatus,
        netWeightDecigrams:
          row.net_weight_decigrams === null
            ? null
            : Number(row.net_weight_decigrams),
        heaterActive:
          row.heater_active === null ? undefined : Number(row.heater_active) === 1,
        phase: String(row.phase) as ExtractionTelemetryPhase,
        pumpCommand: String(row.pump_command) as PumpCommand,
        scaleAvailability: String(row.scale_availability) as ScaleAvailability,
        sequence: Number(row.sequence),
        uptimeMs: Number(row.uptime_ms),
      })),
      terminalWeight:
        metadata.terminal_completion_reason === null
          ? null
          : {
              compensationDecigrams: Number(
                metadata.weight_compensation_decigrams,
              ),
              completionReason: String(
                metadata.terminal_completion_reason,
              ) as TerminalWeightExtraction["completionReason"],
              cutoffWeightDecigrams:
                Number(metadata.weight_target_decigrams) -
                Number(metadata.weight_compensation_decigrams),
              extractionId,
              fallbackOccurred: Number(metadata.terminal_fallback) === 1,
              finalWeightDecigrams: nullableNumber(
                metadata.terminal_final_weight_decigrams,
              ),
              settled: Number(metadata.terminal_settled) === 1,
              targetWeightDecigrams: Number(metadata.weight_target_decigrams),
            },
      weightControl:
        metadata.weight_target_decigrams === null ||
        metadata.weight_compensation_decigrams === null
          ? null
          : {
              compensationDecigrams: Number(
                metadata.weight_compensation_decigrams,
              ),
              targetWeightDecigrams: Number(metadata.weight_target_decigrams),
            },
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
      CREATE TABLE IF NOT EXISTS extraction_history (
        device_id TEXT NOT NULL,
        boot_id TEXT NOT NULL,
        extraction_id TEXT NOT NULL,
        recorded_at_ms INTEGER NOT NULL,
        control_mode TEXT NOT NULL,
        selection_kind TEXT NOT NULL,
        profile_id TEXT,
        selection_profile_json TEXT,
        record_status TEXT NOT NULL,
        target_decigrams INTEGER,
        compensation_decigrams INTEGER,
        cutoff_decigrams INTEGER,
        final_weight_decigrams INTEGER,
        settled INTEGER,
        duration_ms INTEGER,
        outcome TEXT,
        fallback_occurred INTEGER,
        PRIMARY KEY(device_id, boot_id, extraction_id)
      );
      CREATE TABLE IF NOT EXISTS extraction_traces (
        device_id TEXT NOT NULL,
        extraction_id TEXT NOT NULL,
        boot_id TEXT NOT NULL,
        completeness TEXT NOT NULL,
        control_mode TEXT NOT NULL,
        selection_kind TEXT NOT NULL,
        profile_id TEXT,
        selection_profile_json TEXT,
        baseline_weight_decigrams INTEGER,
        outcome TEXT,
        weight_target_decigrams INTEGER,
        weight_compensation_decigrams INTEGER,
        terminal_final_weight_decigrams INTEGER,
        terminal_settled INTEGER,
        terminal_completion_reason TEXT,
        terminal_fallback INTEGER,
        PRIMARY KEY(device_id, boot_id, extraction_id)
      );
      CREATE TABLE IF NOT EXISTS extraction_trace_samples (
        device_id TEXT NOT NULL,
        extraction_id TEXT NOT NULL,
        boot_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        uptime_ms INTEGER NOT NULL,
        elapsed_ms INTEGER NOT NULL,
        extraction_elapsed_ms INTEGER NOT NULL,
        phase TEXT NOT NULL,
        boiler_temperature_c REAL NOT NULL,
        active_target_c INTEGER NOT NULL,
        heater_active INTEGER,
        net_weight_decigrams INTEGER,
        scale_availability TEXT NOT NULL,
        pump_command TEXT NOT NULL,
        derived_flow_g_per_s REAL,
        gap_status TEXT NOT NULL,
        PRIMARY KEY(device_id, extraction_id, boot_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS extraction_trace_lookup
        ON extraction_trace_samples(device_id, extraction_id, sequence);
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
      DELETE FROM weighted_shot_trace_samples
       WHERE (device_id, extraction_id, boot_id) NOT IN (
         SELECT device_id, extraction_id, boot_id FROM weighted_shot_traces
       );
    `);
    await migrateExtractionHistory(database);
    await ensureColumn(
      database,
      "extraction_traces",
      "selection_profile_json",
      "TEXT",
    );
    await database.execAsync(`
      CREATE INDEX IF NOT EXISTS extraction_history_device_time
        ON extraction_history(device_id, recorded_at_ms);
    `);
    await database.withTransactionAsync(async () => {
      await database.execAsync(`
        INSERT OR IGNORE INTO extraction_history (
          device_id, boot_id, extraction_id, recorded_at_ms, control_mode,
          selection_kind, profile_id, selection_profile_json, record_status,
          target_decigrams,
          compensation_decigrams, cutoff_decigrams, final_weight_decigrams,
          settled, duration_ms, outcome, fallback_occurred
        ) SELECT h.device_id,
                 COALESCE(t.boot_id, 'legacy-' || h.recorded_at_ms),
                 h.extraction_id, h.recorded_at_ms, 'weight',
                 'profile', h.profile_id, NULL, 'complete', h.target_decigrams,
                 h.compensation_decigrams, h.cutoff_decigrams,
                 h.final_weight_decigrams, h.settled, h.duration_ms,
                 CASE WHEN h.outcome = 'stopped' THEN 'stopped'
                      WHEN h.outcome = 'safety-cutoff' THEN 'failed'
                      ELSE 'completed' END,
                 h.fallback_occurred
            FROM weighted_shot_history h
            LEFT JOIN weighted_shot_traces t
              ON t.device_id = h.device_id
             AND t.extraction_id = h.extraction_id;
        INSERT OR IGNORE INTO extraction_traces (
          device_id, extraction_id, boot_id, completeness, control_mode,
          selection_kind, profile_id, selection_profile_json,
          baseline_weight_decigrams, outcome,
          weight_target_decigrams, weight_compensation_decigrams,
          terminal_final_weight_decigrams, terminal_settled,
          terminal_completion_reason, terminal_fallback
        ) SELECT t.device_id, t.extraction_id, t.boot_id, t.completeness,
                 'weight', 'profile', h.profile_id, NULL, NULL,
                 CASE WHEN h.outcome = 'stopped' THEN 'stopped'
                      WHEN h.outcome = 'safety-cutoff' THEN 'failed'
                      ELSE 'completed' END,
                 h.target_decigrams, h.compensation_decigrams,
                 h.final_weight_decigrams, h.settled, h.outcome,
                 h.fallback_occurred
            FROM weighted_shot_traces t
            LEFT JOIN weighted_shot_history h
              ON h.device_id = t.device_id
             AND h.extraction_id = t.extraction_id;
        INSERT OR IGNORE INTO extraction_trace_samples (
          device_id, extraction_id, boot_id, sequence, uptime_ms, elapsed_ms,
          extraction_elapsed_ms, phase, boiler_temperature_c, active_target_c,
          heater_active, net_weight_decigrams, scale_availability, pump_command,
          derived_flow_g_per_s, gap_status
        ) SELECT device_id, extraction_id, boot_id, sequence, uptime_ms,
                 elapsed_ms, MIN(elapsed_ms, 60000), phase,
                 boiler_temperature_c, active_target_c, NULL,
                 net_weight_decigrams, scale_availability, pump_command,
                 derived_flow_g_per_s, gap_status
            FROM weighted_shot_trace_samples;
        DELETE FROM extraction_trace_samples
         WHERE (device_id, extraction_id, boot_id) NOT IN (
           SELECT device_id, extraction_id, boot_id FROM extraction_traces
         );
      `);
    });
    return database;
  }
}

function normalizeSummary(
  summary: ExtractionSummary | WeightedShotSummary,
): ExtractionSummary {
  if ("controlMode" in summary) return summary;
  return {
    ...summary,
    bootId: null,
    controlMode: "weight",
    outcome:
      summary.outcome === "stopped"
        ? "stopped"
        : summary.outcome === "safety-cutoff"
          ? "failed"
          : "completed",
    selection: {
      kind: "profile",
      profileId: summary.profileId,
      profile: {
        name: "Legacy",
        preInfusionSeconds: 0,
        soakSeconds: 0,
        mainExtractionSeconds: 60,
      },
    },
    recordStatus: "complete",
  };
}

function storedSelection(row: Record<string, unknown>): ExtractionSummary["selection"] {
  if (row.selection_kind === "manual") return { kind: "manual" };
  const profileId = String(row.profile_id) as ProfileSlotId;
  if (typeof row.selection_profile_json === "string") {
    try {
      const parsed = ExtractionSelectionSchema.safeParse({
        kind: "profile",
        profileId,
        profile: JSON.parse(row.selection_profile_json),
      });
      if (parsed.success) return parsed.data;
    } catch {
      // Older rows did not retain an executed profile snapshot.
    }
  }
  return {
    kind: "profile",
    profileId,
    profile: {
      name: "Legacy",
      preInfusionSeconds: 0,
      soakSeconds: 0,
      mainExtractionSeconds: 60,
    },
  };
}

function storedRecordStatus(value: unknown): ExtractionSummary["recordStatus"] {
  return value === "running" || value === "incomplete" ? value : "complete";
}

async function ensureColumn(
  database: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const columns = await database.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`,
  );
  if (!columns.some((item) => item.name === column)) {
    await database.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function migrateExtractionHistory(
  database: SQLite.SQLiteDatabase,
): Promise<void> {
  const columns = await database.getAllAsync<{ name: string; notnull: number }>(
    "PRAGMA table_info(extraction_history)",
  );
  const hasProfile = columns.some((item) => item.name === "selection_profile_json");
  const hasStatus = columns.some((item) => item.name === "record_status");
  const outcome = columns.find((item) => item.name === "outcome");
  if (hasProfile && hasStatus && outcome?.notnull === 0) return;

  await database.execAsync(`
    CREATE TABLE extraction_history_v2 (
      device_id TEXT NOT NULL,
      boot_id TEXT NOT NULL,
      extraction_id TEXT NOT NULL,
      recorded_at_ms INTEGER NOT NULL,
      control_mode TEXT NOT NULL,
      selection_kind TEXT NOT NULL,
      profile_id TEXT,
      selection_profile_json TEXT,
      record_status TEXT NOT NULL,
      target_decigrams INTEGER,
      compensation_decigrams INTEGER,
      cutoff_decigrams INTEGER,
      final_weight_decigrams INTEGER,
      settled INTEGER,
      duration_ms INTEGER,
      outcome TEXT,
      fallback_occurred INTEGER,
      PRIMARY KEY(device_id, boot_id, extraction_id)
    );
    INSERT INTO extraction_history_v2 (
      device_id, boot_id, extraction_id, recorded_at_ms, control_mode,
      selection_kind, profile_id, selection_profile_json, record_status,
      target_decigrams, compensation_decigrams, cutoff_decigrams,
      final_weight_decigrams, settled, duration_ms, outcome, fallback_occurred
    ) SELECT device_id, boot_id, extraction_id, recorded_at_ms, control_mode,
      selection_kind, profile_id,
      ${hasProfile ? "selection_profile_json" : "NULL"},
      ${hasStatus ? "record_status" : "'complete'"},
      target_decigrams, compensation_decigrams, cutoff_decigrams,
      final_weight_decigrams, settled, duration_ms, outcome, fallback_occurred
      FROM extraction_history;
    DROP TABLE extraction_history;
    ALTER TABLE extraction_history_v2 RENAME TO extraction_history;
  `);
}

function nullableBoolean(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

function nullableStoredBoolean(value: unknown): boolean | null {
  return value === null ? null : Number(value) === 1;
}

function nullableNumber(value: unknown): number | null {
  return value === null ? null : Number(value);
}

export const shotHistoryRepository = new SQLiteShotHistoryRepository();
