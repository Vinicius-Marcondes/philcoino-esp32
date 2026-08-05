import type { ExtractionSummary } from "./shot-history";
import type { StoredExtractionTrace } from "./extraction-trace";

export interface ShotHistoryExporter {
  share(samples: ExtractionSummary[]): Promise<void>;
  shareTrace(trace: StoredExtractionTrace): Promise<void>;
}

export const shotHistoryExporter: ShotHistoryExporter = {
  async share(): Promise<void> {
    throw new Error("Shot-history export is unavailable on this platform.");
  },
  async shareTrace(): Promise<void> {
    throw new Error("Shot-trace export is unavailable on this platform.");
  },
};
