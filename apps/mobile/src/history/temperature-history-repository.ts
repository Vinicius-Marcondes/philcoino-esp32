import {
  localDayRange,
  type TemperatureHistorySample,
} from "./temperature-history";

export interface TemperatureHistoryRepository {
  append(sample: TemperatureHistorySample): Promise<void>;
  clearDevice(deviceId: string): Promise<void>;
  initialize(): Promise<void>;
  iterateAll(deviceId: string): AsyncIterable<TemperatureHistorySample>;
  loadToday(deviceId: string, nowMs?: number): Promise<TemperatureHistorySample[]>;
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
    if (duplicateIndex >= 0) this.samples[duplicateIndex] = sample;
    else this.samples.push(sample);
  }

  async clearDevice(deviceId: string): Promise<void> {
    this.samples = this.samples.filter((sample) => sample.deviceId !== deviceId);
  }

  async initialize(): Promise<void> {}

  async *iterateAll(deviceId: string): AsyncIterable<TemperatureHistorySample> {
    const stored = this.samples
      .filter((sample) => sample.deviceId === deviceId)
      .sort((left, right) => left.recordedAtMs - right.recordedAtMs);
    for (const sample of stored) yield sample;
  }

  async loadToday(
    deviceId: string,
    nowMs = Date.now(),
  ): Promise<TemperatureHistorySample[]> {
    const range = localDayRange(nowMs);
    return this.samples
      .filter(
        (sample) =>
          sample.deviceId === deviceId &&
          sample.recordedAtMs >= range.startMs &&
          sample.recordedAtMs < range.endMs,
      )
      .sort((left, right) => left.recordedAtMs - right.recordedAtMs);
  }
}

export const temperatureHistoryRepository =
  new InMemoryTemperatureHistoryRepository();
