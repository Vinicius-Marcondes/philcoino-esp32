import { describe, expect, test } from "bun:test";

import {
  type ExtractionSummary,
  extractionHistoryToCsv,
  shotSummaryFromTerminal,
  weightedShotHistoryToCsv,
} from "../src/history/shot-history";
import { InMemoryShotHistoryRepository } from "../src/history/shot-history-repository";

describe("extraction history", () => {
  test("persists Start immediately then upgrades the same shot after terminal replay", async () => {
    const repository = new InMemoryShotHistoryRepository();
    const profile = {
      name: "Classic30",
      preInfusionSeconds: 0,
      soakSeconds: 0,
      mainExtractionSeconds: 30,
    };
    const running: ExtractionSummary = {
      bootId: null,
      compensationDecigrams: null,
      controlMode: "timed",
      cutoffDecigrams: null,
      deviceId: "machine-1",
      durationMs: 0,
      extractionId: "run-1",
      fallbackOccurred: null,
      finalWeightDecigrams: null,
      outcome: null,
      profileId: "profile-1",
      recordedAtMs: 100,
      recordStatus: "running",
      selection: { kind: "profile", profileId: "profile-1", profile },
      settled: null,
      targetDecigrams: null,
    };
    await repository.append(running);
    await repository.append({
      ...running,
      bootId: "00000000000000000000000000000001",
      durationMs: 30_000,
      outcome: "completed",
      recordedAtMs: 500,
      recordStatus: "complete",
    });

    const stored = await repository.load("machine-1");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      recordedAtMs: 100,
      recordStatus: "complete",
      selection: { profile },
    });
    const csv = extractionHistoryToCsv(stored);
    expect(csv).toContain(
      "profile_name,pre_infusion_seconds,soak_seconds,main_extraction_seconds",
    );
    expect(csv).toContain("profile-1,Classic30,0,0,30,30000,completed,complete");
  });

  test("marks an unreconciled running shot incomplete without dropping it", async () => {
    const repository = new InMemoryShotHistoryRepository();
    const summary: ExtractionSummary = {
      bootId: null,
      compensationDecigrams: null,
      controlMode: "manual",
      cutoffDecigrams: null,
      deviceId: "machine-1",
      durationMs: 500,
      extractionId: "lost-run",
      fallbackOccurred: null,
      finalWeightDecigrams: null,
      outcome: null,
      profileId: null,
      recordedAtMs: 100,
      recordStatus: "running",
      selection: { kind: "manual" },
      settled: null,
      targetDecigrams: null,
    };
    await repository.append(summary);
    await repository.markUnfinishedIncomplete("machine-1", null);
    expect(await repository.load("machine-1")).toMatchObject([
      { extractionId: "lost-run", outcome: null, recordStatus: "incomplete" },
    ]);
  });

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
