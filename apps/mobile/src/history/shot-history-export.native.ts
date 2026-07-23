import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { weightedShotHistoryToCsv } from "./shot-history";
import type { ShotHistoryExporter } from "./shot-history-export";

export const shotHistoryExporter: ShotHistoryExporter = {
  async share(samples) {
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error("Sharing is unavailable.");
    }
    const file = new File(Paths.cache, "philcoino-weighted-shots.csv");
    try {
      file.create({ overwrite: true });
      file.write(weightedShotHistoryToCsv(samples));
      await Sharing.shareAsync(file.uri, {
        dialogTitle: "Export Philcoino weighted shots",
        mimeType: "text/csv",
        UTI: "public.comma-separated-values-text",
      });
    } finally {
      if (file.exists) {
        file.delete();
      }
    }
  },
};
