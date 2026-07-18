import { temperatureHistoryToCsv } from "./temperature-history-csv";
import type { TemperatureHistorySample } from "./temperature-history";

export interface TemporaryCsvFile {
  remove: () => Promise<void> | void;
  uri: string;
  write: (contents: string) => Promise<void> | void;
}

export interface TemperatureHistoryShareDependencies {
  createTemporaryFile: (filename: string) => TemporaryCsvFile;
  isSharingAvailable: () => Promise<boolean>;
  shareFile: (uri: string) => Promise<void>;
}

export async function shareTemperatureHistoryCsv(
  samples: TemperatureHistorySample[],
  dependencies: TemperatureHistoryShareDependencies,
): Promise<void> {
  if (samples.length === 0 || !(await dependencies.isSharingAvailable())) {
    throw new Error("Temperature history sharing is unavailable.");
  }

  const file = dependencies.createTemporaryFile(exportFilename(samples[0]));
  try {
    await file.write(temperatureHistoryToCsv(samples));
    await dependencies.shareFile(file.uri);
  } finally {
    await file.remove();
  }
}

function exportFilename(sample: TemperatureHistorySample): string {
  const date = new Date(sample.recordedAtMs);
  const localDate = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  const safeDeviceId = sample.deviceId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  return `philcoino-${safeDeviceId}-${localDate}.csv`;
}
