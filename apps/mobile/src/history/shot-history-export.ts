import type { WeightedShotSummary } from "./shot-history";
import type { StoredWeightedShotTrace } from "./weighted-shot-trace";

export interface ShotHistoryExporter {
  share(samples: WeightedShotSummary[]): Promise<void>;
  shareTrace(trace: StoredWeightedShotTrace): Promise<void>;
}

export const shotHistoryExporter: ShotHistoryExporter = {
  async share(): Promise<void> {
    throw new Error("Shot-history export is unavailable on this platform.");
  },
  async shareTrace(): Promise<void> {
    throw new Error("Shot-trace export is unavailable on this platform.");
  },
};
