import { describe, expect, test } from "bun:test";
import type {
  WeightedExtractionTracePage,
  WeightedExtractionTraceSample,
} from "@philcoino/protocol";

import { InMemoryShotHistoryRepository } from "../src/history/shot-history-repository";
import {
  deriveBeverageFlow,
  weightedShotTraceToCsv,
} from "../src/history/weighted-shot-trace";

describe("weighted shot trace", () => {
  test("fits causal one-second flow and keeps flat/noisy weight at zero", () => {
    const ramp = deriveBeverageFlow([
      sample(1, 0, 0),
      sample(2, 250, 5),
      sample(3, 500, 10),
      sample(4, 750, 15),
      sample(5, 1_000, 20),
    ]);
    expect(ramp[0].derivedFlowGPerS).toBeNull();
    expect(ramp[2].derivedFlowGPerS).toBeCloseTo(2);
    expect(ramp[4].derivedFlowGPerS).toBeCloseTo(2);

    const noise = deriveBeverageFlow([
      sample(1, 0, 100),
      sample(2, 250, 100),
      sample(3, 500, 99),
    ]);
    expect(noise[2].derivedFlowGPerS).toBe(0);
  });

  test("resets across gaps, nulls, availability changes, and large drops", () => {
    const values = deriveBeverageFlow([
      sample(1, 0, 0),
      sample(2, 250, 5),
      sample(4, 500, 10),
      sample(5, 750, null),
      sample(6, 1_000, 20, "unavailable"),
      sample(7, 1_250, 20),
      sample(8, 1_500, 10),
      sample(9, 1_750, 0),
    ]);
    expect(values[2].gapStatus).toBe("gap");
    expect(values[3].gapStatus).toBe("gap");
    expect(values[4].derivedFlowGPerS).toBeNull();
    expect(values[7]).toMatchObject({
      derivedFlowGPerS: null,
      gapStatus: "gap",
      netWeightDecigrams: 0,
    });
  });

  test("commits pages incrementally, deduplicates, and promotes live to complete", async () => {
    const repository = new InMemoryShotHistoryRepository();
    const first = page("running", [sample(1, 0, 0), sample(2, 250, 5)]);
    let stored = await repository.commitTracePage("machine-1", first);
    expect(stored.completeness).toBe("live");

    const terminal = page(
      "terminal",
      [sample(2, 250, 5), sample(3, 500, 10)],
      2,
    );
    stored = await repository.commitTracePage("machine-1", terminal);
    expect(stored.completeness).toBe("complete");
    expect(stored.samples.map((value) => value.sequence)).toEqual([1, 2, 3]);
    expect(weightedShotTraceToCsv(stored)).toContain(
      "500,1500,93,93,1.0,2.00,main-extraction,running,continuous",
    );
  });

  test("discards a retained trace when the device reuses the same identity", async () => {
    const repository = new InMemoryShotHistoryRepository();
    await repository.commitTracePage(
      "machine-1",
      page("terminal", [
        sample(1, 0, 0),
        sample(2, 250, 5),
        sample(3, 500, 10),
        sample(4, 750, 15),
        sample(5, 1_000, 20),
      ]),
    );

    const restarted = page("running", [
      { ...sample(1, 0, 0), uptimeMs: 500_000 },
      { ...sample(2, 250, 4), uptimeMs: 500_250 },
    ]);
    const stored = await repository.commitTracePage("machine-1", restarted);
    expect(stored.samples.map((value) => value.sequence)).toEqual([1, 2]);
    expect(stored.samples.map((value) => value.uptimeMs)).toEqual([
      500_000, 500_250,
    ]);
  });

  test("trims sequences above the device high-water mark but keeps overwritten history", async () => {
    const repository = new InMemoryShotHistoryRepository();
    await repository.commitTracePage(
      "machine-1",
      page("running", [sample(1, 0, 0), sample(2, 250, 5), sample(3, 500, 10)]),
    );

    const truncated: WeightedExtractionTracePage = {
      ...page("running", [sample(2, 250, 5)], 1),
      continuity: "truncated",
      latestSequence: 2,
      oldestSequence: 2,
    };
    const stored = await repository.commitTracePage("machine-1", truncated);
    // Sequence 1 left the device ring but stays durable; sequence 3 cannot
    // belong to this trace because the device never reached it.
    expect(stored.samples.map((value) => value.sequence)).toEqual([1, 2]);
  });
});

function sample(
  sequence: number,
  elapsedMs: number,
  netWeightDecigrams: number | null,
  scaleAvailability: WeightedExtractionTraceSample["scaleAvailability"] = "ready",
): WeightedExtractionTraceSample {
  return {
    activeTargetC: 93,
    boilerTemperatureC: 93,
    elapsedMs,
    netWeightDecigrams,
    phase: "main-extraction",
    pumpCommand: "running",
    scaleAvailability,
    sequence,
    uptimeMs: 1_000 + elapsedMs,
  };
}

function page(
  status: WeightedExtractionTracePage["status"],
  samples: WeightedExtractionTraceSample[],
  afterSequence = 0,
): WeightedExtractionTracePage {
  return {
    bootId: "0123456789abcdef0123456789abcdef",
    capturedAtUptimeMs: 2_000,
    continuity: afterSequence === 0 ? "initial" : "continuous",
    deviceId: "machine-1",
    extractionId: "run-1",
    hasMore: false,
    latestSequence: samples.at(-1)!.sequence,
    nextCursor: {
      afterSequence: samples.at(-1)!.sequence,
      bootId: "0123456789abcdef0123456789abcdef",
      extractionId: "run-1",
    },
    oldestSequence: 1,
    samples,
    status,
  };
}
