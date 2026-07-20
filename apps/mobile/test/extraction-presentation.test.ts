import { describe, expect, test } from "bun:test";
import type { ExtractionState } from "@philcoino/protocol";

import { extractionPresentation } from "../src/dashboard/extraction-presentation";

describe("extraction presentation", () => {
  test("distinguishes pristine idle from terminal outcomes", () => {
    const idle: ExtractionState = {
      elapsedMs: 0,
      extractionId: null,
      phase: "idle",
      pumpCommand: "off",
      remainingMs: null,
      selection: null,
      status: "idle",
    };
    const stopped: ExtractionState = {
      elapsedMs: 42_000,
      extractionId: "run-42",
      outcome: "stopped",
      phase: "idle",
      pumpCommand: "off",
      remainingMs: null,
      selection: { kind: "manual" },
      status: "idle",
    };
    const failed: ExtractionState = {
      ...stopped,
      outcome: "failed",
      pumpCommand: "running",
    };
    const completed: ExtractionState = { ...stopped, outcome: "completed" };

    expect(extractionPresentation(idle)).toEqual({
      pumpCommand: "off",
      title: "idle",
    });
    expect(extractionPresentation(stopped)).toEqual({
      pumpCommand: "off",
      title: "stopped",
    });
    expect(extractionPresentation(completed)).toEqual({
      pumpCommand: "off",
      title: "completed",
    });
    expect(extractionPresentation(failed)).toEqual({
      pumpCommand: "running",
      title: "failed",
    });
  });
});
