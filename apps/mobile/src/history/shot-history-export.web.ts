import { weightedShotHistoryToCsv } from "./shot-history";
import { weightedShotTraceToCsv } from "./weighted-shot-trace";
import type { ShotHistoryExporter } from "./shot-history-export";

export const shotHistoryExporter: ShotHistoryExporter = {
  async share(samples) {
    const blob = new Blob([weightedShotHistoryToCsv(samples)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "philcoino-weighted-shots.csv";
    link.click();
    URL.revokeObjectURL(url);
  },
  async shareTrace(trace) {
    const blob = new Blob([weightedShotTraceToCsv(trace)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `philcoino-${trace.extractionId}-trace.csv`;
    link.click();
    URL.revokeObjectURL(url);
  },
};
