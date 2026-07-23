import { describe, expect, test } from "bun:test";

import {
  shotSummaryFromTerminal,
  weightedShotHistoryToCsv,
} from "../src/history/shot-history";
import { InMemoryShotHistoryRepository } from "../src/history/shot-history-repository";

describe("weighted shot history", () => {
  test("deduplicates by device and extraction, prunes at 90 days, and exports stable decimal CSV", async () => {
    const repository = new InMemoryShotHistoryRepository();
    const now = Date.UTC(2026, 6, 23);
    const terminal = {
      extractionId: "run-1",
      targetWeightDecigrams: 350,
      compensationDecigrams: 10,
      cutoffWeightDecigrams: 340,
      finalWeightDecigrams: 356,
      settled: true,
      completionReason: "weight-reached" as const,
      fallbackOccurred: false,
    };
    const summary = shotSummaryFromTerminal(
      "machine-1",
      "profile-1",
      terminal,
      28_500,
      now,
    );
    await repository.append(summary);
    await repository.append({ ...summary, finalWeightDecigrams: 357 });
    await repository.append({
      ...summary,
      extractionId: "old-run",
      recordedAtMs: now - 91 * 24 * 60 * 60 * 1000,
    });

    const stored = await repository.load("machine-1", now);
    expect(stored).toHaveLength(1);
    expect(stored[0].finalWeightDecigrams).toBe(357);
    expect(weightedShotHistoryToCsv(stored)).toContain(
      "35.0,1.0,34.0,35.7,true,28500,weight-reached,false",
    );
  });
});
