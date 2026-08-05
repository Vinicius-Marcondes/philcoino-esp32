import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { extractionHistoryToCsv } from "./shot-history";
import { extractionTraceToCsv } from "./extraction-trace";
import type { ShotHistoryExporter } from "./shot-history-export";

export const shotHistoryExporter: ShotHistoryExporter = {
  async share(samples) {
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error("Sharing is unavailable.");
    }
    const file = new File(Paths.cache, "philcoino-extractions.csv");
    try {
      file.create({ overwrite: true });
      file.write(extractionHistoryToCsv(samples));
      await Sharing.shareAsync(file.uri, {
        dialogTitle: "Export Philcoino extractions",
        mimeType: "text/csv",
        UTI: "public.comma-separated-values-text",
      });
    } finally {
      if (file.exists) {
        file.delete();
      }
    }
  },
  async shareTrace(trace) {
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error("Sharing is unavailable.");
    }
    const file = new File(
      Paths.cache,
      `philcoino-${trace.extractionId}-trace.csv`,
    );
    try {
      file.create({ overwrite: true });
      file.write(extractionTraceToCsv(trace));
      await Sharing.shareAsync(file.uri, {
        dialogTitle: "Export Philcoino extraction trace",
        mimeType: "text/csv",
        UTI: "public.comma-separated-values-text",
      });
    } finally {
      if (file.exists) file.delete();
    }
  },
};
