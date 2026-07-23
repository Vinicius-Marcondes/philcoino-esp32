import { weightedShotHistoryToCsv } from "./shot-history";
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
};
