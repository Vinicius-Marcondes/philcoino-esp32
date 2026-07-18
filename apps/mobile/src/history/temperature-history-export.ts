import type { TemperatureHistorySample } from "./temperature-history";

export interface TemperatureHistoryExporter {
  share(samples: TemperatureHistorySample[]): Promise<void>;
}

class UnsupportedTemperatureHistoryExporter
  implements TemperatureHistoryExporter
{
  async share(): Promise<void> {
    throw new Error("Temperature history sharing is unavailable on this platform.");
  }
}

export const temperatureHistoryExporter =
  new UnsupportedTemperatureHistoryExporter();
