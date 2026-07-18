import {
  localDayRange,
  type TemperatureHistorySample,
} from "./temperature-history";

export interface TemperatureHistoryRepository {
  append(sample: TemperatureHistorySample): Promise<void>;
  clearDevice(deviceId: string): Promise<void>;
  initialize(nowMs?: number): Promise<void>;
  iterateToday(
    deviceId: string,
    nowMs?: number,
  ): AsyncIterable<TemperatureHistorySample>;
  loadToday(deviceId: string, nowMs?: number): Promise<TemperatureHistorySample[]>;
  prune(nowMs?: number): Promise<void>;
}

export class InMemoryTemperatureHistoryRepository
  implements TemperatureHistoryRepository
{
  private samples: TemperatureHistorySample[] = [];

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
}

export const temperatureHistoryRepository =
  new InMemoryTemperatureHistoryRepository();
