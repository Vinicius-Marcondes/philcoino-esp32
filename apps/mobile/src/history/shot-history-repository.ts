import type { WeightedShotSummary } from "./shot-history";

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface ShotHistoryRepository {
  append(summary: WeightedShotSummary): Promise<void>;
  clearDevice(deviceId: string): Promise<void>;
  load(deviceId: string, nowMs?: number): Promise<WeightedShotSummary[]>;
  prune(nowMs?: number): Promise<void>;
}

export class InMemoryShotHistoryRepository implements ShotHistoryRepository {
  private records: WeightedShotSummary[] = [];

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
  }

  async load(
    deviceId: string,
    nowMs = Date.now(),
  ): Promise<WeightedShotSummary[]> {
    await this.prune(nowMs);
    return this.records
      .filter((record) => record.deviceId === deviceId)
      .sort((left, right) => right.recordedAtMs - left.recordedAtMs);
  }

  async prune(nowMs = Date.now()): Promise<void> {
    const cutoff = nowMs - RETENTION_MS;
    this.records = this.records.filter(
      (record) => record.recordedAtMs >= cutoff,
    );
  }
}

export const shotHistoryRepository = new InMemoryShotHistoryRepository();
