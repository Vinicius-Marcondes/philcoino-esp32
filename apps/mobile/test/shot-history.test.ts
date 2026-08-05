import { describe, expect, test } from "bun:test";

import {
  type ExtractionSummary,
  shotSummaryFromTerminal,
  weightedShotHistoryToCsv,
} from "../src/history/shot-history";
import { InMemoryShotHistoryRepository } from "../src/history/shot-history-repository";

describe("extraction history", () => {
  test("keeps reused extraction IDs from different firmware boots", async () => {
    const repository = new InMemoryShotHistoryRepository();
    const summary: ExtractionSummary = {
      bootId: "00000000000000000000000000000001",
      compensationDecigrams: null,
      controlMode: "manual",
      cutoffDecigrams: null,
      deviceId: "machine-1",
      durationMs: 1_000,
      extractionId: "run-1",
      fallbackOccurred: null,
      finalWeightDecigrams: null,
      outcome: "stopped",
      profileId: null,
      recordedAtMs: 1,
      selection: { kind: "manual" },
      settled: null,
      targetDecigrams: null,
    };
    await repository.append(summary);
    await repository.append({
      ...summary,
      bootId: "00000000000000000000000000000002",
      recordedAtMs: 2,
    });
    expect(await repository.load("machine-1")).toHaveLength(2);
  });

  test("deduplicates by device and extraction, retains old records, and exports stable decimal CSV", async () => {
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
    expect(stored).toHaveLength(2);
    expect(stored[0].finalWeightDecigrams).toBe(357);
    expect(weightedShotHistoryToCsv(stored)).toContain(
      "35.0,1.0,34.0,35.7,true,28500,completed,false",
    );
  });
});
