import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { TemperatureHistoryExporter } from "./temperature-history-export";
import {
  TEMPERATURE_HISTORY_CSV_HEADER,
  temperatureHistoryCsvRow,
} from "./temperature-history-csv";

class NativeTemperatureHistoryExporter implements TemperatureHistoryExporter {
  async share(samples: Parameters<TemperatureHistoryExporter["share"]>[0]) {
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error("Temperature history sharing is unavailable.");
    }
    const file = new File(Paths.cache, `philcoino-status-${Date.now()}.csv`);
    file.create({ overwrite: true });
    const handle = file.open();
    const encoder = new TextEncoder();
    let count = 0;
    try {
      handle.writeBytes(encoder.encode(`${TEMPERATURE_HISTORY_CSV_HEADER}\r\n`));
      for await (const sample of samples) {
        handle.writeBytes(encoder.encode(`${temperatureHistoryCsvRow(sample)}\r\n`));
        count += 1;
      }
      handle.close();
      if (count === 0) throw new Error("Temperature history is empty.");
      await Sharing.shareAsync(file.uri, {
        dialogTitle: "Export Philcoino status history",
        mimeType: "text/csv",
        UTI: "public.comma-separated-values-text",
      });
    } finally {
      if (handle.offset !== null) handle.close();
      if (file.exists) file.delete();
    }
  }
}

export const temperatureHistoryExporter =
  new NativeTemperatureHistoryExporter();
