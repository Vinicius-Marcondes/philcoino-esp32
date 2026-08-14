import { describe, expect, it } from "bun:test";
import type { ExtractionTelemetryPage } from "@philcoino/protocol";

import {
  ExtractionSseParser,
  ExtractionSseProtocolError,
} from "../src/telemetry/extraction-sse-parser";

const page: ExtractionTelemetryPage = {
  version: 1,
  deviceId: "philcoino-test",
  extractionId: "extraction-0001",
  bootId: "00000000000000000000000000000001",
  capturedAtUptimeMs: 250,
  selection: { kind: "manual" },
  controlMode: "manual",
  weightControl: null,
  baselineWeightDecigrams: null,
  status: "running",
  outcome: null,
  terminalWeight: null,
  oldestSequence: 1,
  latestSequence: 1,
  nextCursor: {
    extractionId: "extraction-0001",
    bootId: "00000000000000000000000000000001",
    afterSequence: 1,
  },
  hasMore: false,
  continuity: "initial",
  samples: [{
    sequence: 1,
    uptimeMs: 250,
    elapsedMs: 250,
    extractionElapsedMs: 250,
    phase: "manual",
    boilerTemperatureC: null,
    activeTargetC: 93,
    heaterActive: false,
    pumpCommand: "running",
    scaleAvailability: "unavailable",
    netWeightDecigrams: null,
  }],
};

const encoder = new TextEncoder();

function frame(eventId = `${page.bootId}.${page.extractionId}.1`): string {
  return `id: ${eventId}\nevent: telemetry\ndata: ${JSON.stringify(page)}\n\n`;
}

describe("strict extraction SSE parser", () => {
  it("accepts fragmented telemetry only when the event ID matches its cursor", () => {
    const parser = new ExtractionSseParser();
    const value = frame();
    expect(parser.push(encoder.encode(value.slice(0, 37)))).toEqual([]);
    expect(parser.push(encoder.encode(value.slice(37)))).toEqual([page]);
    expect(parser.finish()).toEqual([]);
  });

  it("rejects missing, repeated, and cursor-mismatched event IDs", () => {
    expect(() => new ExtractionSseParser().push(encoder.encode(
      `event: telemetry\ndata: ${JSON.stringify(page)}\n\n`,
    ))).toThrow(ExtractionSseProtocolError);
    expect(() => new ExtractionSseParser().push(encoder.encode(
      `id: first\nid: second\nevent: telemetry\ndata: ${JSON.stringify(page)}\n\n`,
    ))).toThrow(ExtractionSseProtocolError);
    expect(() => new ExtractionSseParser().push(
      encoder.encode(frame(`${page.bootId}.${page.extractionId}.2`)),
    )).toThrow(ExtractionSseProtocolError);
  });

  it("ignores heartbeat comments without advancing a cursor", () => {
    const parser = new ExtractionSseParser();
    expect(parser.push(encoder.encode(": heartbeat\n\n"))).toEqual([]);
    expect(parser.push(encoder.encode(frame()))).toEqual([page]);
  });
});
