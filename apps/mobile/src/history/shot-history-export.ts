import type { WeightedShotSummary } from "./shot-history";

export interface ShotHistoryExporter {
  share(samples: WeightedShotSummary[]): Promise<void>;
}

export const shotHistoryExporter: ShotHistoryExporter = {
  async share(): Promise<void> {
    throw new Error("Shot-history export is unavailable on this platform.");
  },
};
