import type { ExtractionState } from "@philcoino/protocol";

export type ExtractionPresentationTitle =
  | "completed"
  | "failed"
  | "idle"
  | "running"
  | "stopped";

export interface ExtractionPresentation {
  pumpCommand: "off" | "running";
  title: ExtractionPresentationTitle;
}

export function extractionPresentation(
  extraction: ExtractionState,
): ExtractionPresentation {
  if (extraction.status === "running") {
    return { pumpCommand: extraction.pumpCommand, title: "running" };
  }
  if ("outcome" in extraction) {
    return {
      pumpCommand: extraction.pumpCommand,
      title: extraction.outcome,
    };
  }
  return { pumpCommand: extraction.pumpCommand, title: "idle" };
}
