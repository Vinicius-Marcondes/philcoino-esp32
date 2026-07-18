import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { TemperatureHistoryExporter } from "./temperature-history-export";
import { shareTemperatureHistoryCsv } from "./temperature-history-share-service";

class NativeTemperatureHistoryExporter implements TemperatureHistoryExporter {
  async share(samples: Parameters<TemperatureHistoryExporter["share"]>[0]) {
    await shareTemperatureHistoryCsv(samples, {
      createTemporaryFile(filename) {
        const file = new File(Paths.cache, filename);
        return {
          remove() {
            if (file.exists) {
              file.delete();
            }
          },
          uri: file.uri,
          write(contents) {
            file.create({ overwrite: true });
            file.write(contents);
          },
        };
      },
      isSharingAvailable: Sharing.isAvailableAsync,
      shareFile(uri) {
        return Sharing.shareAsync(uri, {
          dialogTitle: "Export Philcoino temperature history",
          mimeType: "text/csv",
          UTI: "public.comma-separated-values-text",
        });
      },
    });
  }
}

export const temperatureHistoryExporter =
  new NativeTemperatureHistoryExporter();
