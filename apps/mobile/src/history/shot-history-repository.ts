import type { WeightedShotSummary } from "./shot-history";
import type { WeightedExtractionTracePage } from "@philcoino/protocol";
import {
  mergeTracePage,
  type StoredWeightedShotTrace,
} from "./weighted-shot-trace";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface ShotHistoryRepository {
  append(summary: WeightedShotSummary): Promise<void>;
  commitTracePage(
    deviceId: string,
    page: WeightedExtractionTracePage,
  ): Promise<StoredWeightedShotTrace>;
  clearDevice(deviceId: string): Promise<void>;
  load(deviceId: string, nowMs?: number): Promise<WeightedShotSummary[]>;
  loadTrace(
    deviceId: string,
    extractionId: string,
  ): Promise<StoredWeightedShotTrace | null>;
  prune(nowMs?: number): Promise<void>;
}

export class InMemoryShotHistoryRepository implements ShotHistoryRepository {
  private records: WeightedShotSummary[] = [];
  private traces = new Map<string, StoredWeightedShotTrace>();

  async append(summary: WeightedShotSummary): Promise<void> {
    const index = this.records.findIndex(
      (record) =>
        record.deviceId === summary.deviceId &&
        record.extractionId === summary.extractionId,
    );
    if (index >= 0) {
      this.records[index] = summary;
    } else {
      this.records.push(summary);
    }
    await this.prune(summary.recordedAtMs);
  }

  async clearDevice(deviceId: string): Promise<void> {
    this.records = this.records.filter((record) => record.deviceId !== deviceId);
    for (const [key, trace] of this.traces) {
      if (trace.deviceId === deviceId) this.traces.delete(key);
    }
  }

  async commitTracePage(
    deviceId: string,
    page: WeightedExtractionTracePage,
  ): Promise<StoredWeightedShotTrace> {
    const key = traceKey(deviceId, page.extractionId);
    const trace = mergeTracePage(this.traces.get(key) ?? null, deviceId, page);
    this.traces.set(key, trace);
    return trace;
  }

  async load(
    deviceId: string,
    nowMs = Date.now(),
  ): Promise<WeightedShotSummary[]> {
    await this.prune(nowMs);
    return this.records
      .filter((record) => record.deviceId === deviceId)
      .map((record) => {
        const trace = this.traces.get(traceKey(deviceId, record.extractionId));
        return {
          ...record,
          traceCompleteness: trace?.completeness ?? null,
          traceSampleCount: trace?.samples.length ?? 0,
        };
      })
      .sort((left, right) => right.recordedAtMs - left.recordedAtMs);
  }

  async prune(nowMs = Date.now()): Promise<void> {
    const cutoff = nowMs - RETENTION_MS;
    this.records = this.records.filter(
      (record) => record.recordedAtMs >= cutoff,
    );
    const retained = new Set(
      this.records.map((record) => traceKey(record.deviceId, record.extractionId)),
    );
    for (const key of this.traces.keys()) {
      if (!retained.has(key)) this.traces.delete(key);
    }
  }

  async loadTrace(
    deviceId: string,
    extractionId: string,
  ): Promise<StoredWeightedShotTrace | null> {
    return this.traces.get(traceKey(deviceId, extractionId)) ?? null;
  }
}

function traceKey(deviceId: string, extractionId: string): string {
  return `${deviceId}\u0000${extractionId}`;
}

export const shotHistoryRepository = new InMemoryShotHistoryRepository();
