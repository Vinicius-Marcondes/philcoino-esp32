import {
  localDayRange,
  type TemperatureHistorySample,
} from "./temperature-history";
import type { HistoryCursor } from "@philcoino/protocol";

export interface RecoveredHistoryPage {
  cursor: HistoryCursor;
  samples: TemperatureHistorySample[];
}

export interface TemperatureHistoryRepository {
  append(sample: TemperatureHistorySample): Promise<void>;
  clearDevice(deviceId: string): Promise<void>;
  initialize(nowMs?: number): Promise<void>;
  loadSyncCursor(deviceId: string): Promise<HistoryCursor | null>;
  iterateToday(
    deviceId: string,
    nowMs?: number,
  ): AsyncIterable<TemperatureHistorySample>;
  loadToday(deviceId: string, nowMs?: number): Promise<TemperatureHistorySample[]>;
  prune(nowMs?: number): Promise<void>;
  storeRecoveredPage(
    deviceId: string,
    page: RecoveredHistoryPage,
  ): Promise<void>;
}

export class InMemoryTemperatureHistoryRepository
  implements TemperatureHistoryRepository
{
  private samples: TemperatureHistorySample[] = [];
  private readonly cursors = new Map<string, HistoryCursor>();

  async append(sample: TemperatureHistorySample): Promise<void> {
    const duplicateIndex = this.samples.findIndex(
      (current) =>
        current.deviceId === sample.deviceId &&
        current.recordedAtMs === sample.recordedAtMs,
    );
    if (duplicateIndex >= 0) {
      this.samples[duplicateIndex] = sample;
    } else {
      this.samples.push(sample);
    }
    await this.prune(sample.recordedAtMs);
  }

  async clearDevice(deviceId: string): Promise<void> {
    this.samples = this.samples.filter((sample) => sample.deviceId !== deviceId);
    this.cursors.delete(deviceId);
  }

  async loadSyncCursor(deviceId: string): Promise<HistoryCursor | null> {
    return this.cursors.get(deviceId) ?? null;
  }

  async initialize(nowMs = Date.now()): Promise<void> {
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
    return this.samples
      .filter((sample) => sample.deviceId === deviceId)
      .sort((left, right) => left.recordedAtMs - right.recordedAtMs);
  }

  async prune(nowMs = Date.now()): Promise<void> {
    const range = localDayRange(nowMs);
    this.samples = this.samples.filter(
      (sample) =>
        sample.recordedAtMs >= range.startMs && sample.recordedAtMs < range.endMs,
    );
  }

  async storeRecoveredPage(
    deviceId: string,
    page: RecoveredHistoryPage,
  ): Promise<void> {
    const recovered = page.samples;
    if (recovered.length > 0) {
      const first = recovered[0];
      const last = recovered.at(-1)!;
      this.samples = this.samples.filter(
        (sample) =>
          sample.deviceId !== deviceId ||
          sample.sourceSequence !== null ||
          sample.uptimeMs < first.uptimeMs ||
          sample.uptimeMs > last.uptimeMs ||
          sample.recordedAtMs < first.recordedAtMs - 5_000 ||
          sample.recordedAtMs > last.recordedAtMs + 5_000,
      );
      const keys = new Set(
        recovered.map(
          (sample) => `${sample.sourceBootId}:${sample.sourceSequence}`,
        ),
      );
      this.samples = this.samples.filter(
        (sample) =>
          sample.deviceId !== deviceId ||
          sample.sourceSequence === null ||
          !keys.has(`${sample.sourceBootId}:${sample.sourceSequence}`),
      );
      this.samples.push(...recovered);
      await this.prune(recovered.at(-1)!.recordedAtMs);
    }
    this.cursors.set(deviceId, page.cursor);
  }
}

export const temperatureHistoryRepository =
  new InMemoryTemperatureHistoryRepository();
