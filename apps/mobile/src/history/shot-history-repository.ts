import type { ExtractionSummary, WeightedShotSummary } from "./shot-history";
import type { ExtractionTelemetryPage } from "@philcoino/protocol";
import {
  mergeExtractionTracePage,
  type StoredExtractionTrace,
} from "./extraction-trace";

export interface ShotHistoryRepository {
  append(summary: ExtractionSummary | WeightedShotSummary): Promise<void>;
  commitExtractionTracePage(
    deviceId: string,
    page: ExtractionTelemetryPage,
  ): Promise<StoredExtractionTrace>;
  clearDevice(deviceId: string): Promise<void>;
  load(deviceId: string, nowMs?: number): Promise<ExtractionSummary[]>;
  loadTrace(
    deviceId: string,
    extractionId: string,
    bootId?: string | null,
  ): Promise<StoredExtractionTrace | null>;
  markUnfinishedIncomplete(
    deviceId: string,
    retainedExtractionId?: string | null,
  ): Promise<void>;
  prune(nowMs?: number): Promise<void>;
}

export class InMemoryShotHistoryRepository implements ShotHistoryRepository {
  private records: ExtractionSummary[] = [];
  private traces = new Map<string, StoredExtractionTrace>();

  async append(summary: ExtractionSummary | WeightedShotSummary): Promise<void> {
    const normalized = normalizeSummary(summary);
    let index = this.records.findIndex(
      (record) =>
        record.deviceId === normalized.deviceId &&
        record.extractionId === normalized.extractionId &&
        record.bootId === normalized.bootId,
    );
    if (index < 0 && normalized.bootId !== null) {
      index = this.records.findIndex(
        (record) =>
          record.deviceId === normalized.deviceId &&
          record.extractionId === normalized.extractionId &&
          record.bootId === null &&
          record.recordStatus === "running",
      );
    }
    if (index >= 0) {
      this.records[index] = {
        ...normalized,
        recordedAtMs: Math.min(
          this.records[index].recordedAtMs,
          normalized.recordedAtMs,
        ),
      };
    } else {
      this.records.push(normalized);
    }
  }

  async commitExtractionTracePage(
    deviceId: string,
    page: ExtractionTelemetryPage,
  ): Promise<StoredExtractionTrace> {
    const key = traceKey(deviceId, page.extractionId, page.bootId);
    const trace = mergeExtractionTracePage(
      this.traces.get(key) ?? null,
      deviceId,
      page,
    );
    this.traces.set(key, trace);
    return trace;
  }

  async clearDevice(deviceId: string): Promise<void> {
    this.records = this.records.filter((record) => record.deviceId !== deviceId);
    for (const [key, trace] of this.traces) {
      if (trace.deviceId === deviceId) this.traces.delete(key);
    }
  }

  async load(
    deviceId: string,
    nowMs = Date.now(),
  ): Promise<ExtractionSummary[]> {
    void nowMs;
    return this.records
      .filter((record) => record.deviceId === deviceId)
      .map((record) => {
        const trace = this.traces.get(
          traceKey(deviceId, record.extractionId, record.bootId),
        );
        return {
          ...record,
          traceCompleteness: trace?.completeness ?? null,
          traceSampleCount: trace?.samples.length ?? 0,
        };
      })
      .sort((left, right) => right.recordedAtMs - left.recordedAtMs);
  }

  async prune(nowMs = Date.now()): Promise<void> {
    void nowMs;
  }

  async loadTrace(
    deviceId: string,
    extractionId: string,
    bootId?: string | null,
  ): Promise<StoredExtractionTrace | null> {
    if (bootId !== undefined) {
      return this.traces.get(traceKey(deviceId, extractionId, bootId)) ?? null;
    }
    const traces = [...this.traces.values()];
    for (let index = traces.length - 1; index >= 0; index -= 1) {
      const trace = traces[index];
      if (trace.deviceId === deviceId && trace.extractionId === extractionId) {
        return trace;
      }
    }
    return null;
  }

  async markUnfinishedIncomplete(
    deviceId: string,
    retainedExtractionId?: string | null,
  ): Promise<void> {
    this.records = this.records.map((record) =>
      record.deviceId === deviceId &&
      record.recordStatus === "running" &&
      record.extractionId !== retainedExtractionId
        ? { ...record, recordStatus: "incomplete", outcome: null }
        : record,
    );
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

function traceKey(
  deviceId: string,
  extractionId: string,
  bootId: string | null,
): string {
  return `${deviceId}\u0000${bootId ?? "legacy"}\u0000${extractionId}`;
}

export const shotHistoryRepository = new InMemoryShotHistoryRepository();
