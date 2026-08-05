import { describe, expect, test } from "bun:test";
import type {
  ExtractionTelemetryCursor,
  ExtractionTelemetryPage,
} from "@philcoino/protocol";

import { InMemoryShotHistoryRepository } from "../src/history/shot-history-repository";
import {
  extractionTraceToCsv,
  mergeExtractionTracePage,
} from "../src/history/extraction-trace";
import { ApiClientError } from "../src/networking/api-client-error";
import { DeviceApiClient } from "../src/networking/device-api-client";
import {
  ExtractionSseParser,
  ExtractionSseProtocolError,
} from "../src/telemetry/extraction-sse-parser";
import {
  ExtractionStreamSession,
  type ExtractionStreamClient,
} from "../src/telemetry/extraction-stream-session";
import {
  createSimulator,
  DEFAULT_SIMULATOR_TOKEN,
} from "../../../tools/device-simulator/src/app";

describe("incremental extraction SSE parser", () => {
  test("accepts arbitrary fragmentation, comments, and multiple events", () => {
    const first = telemetryPage(1, "running");
    const second = telemetryPage(2, "running");
    const wire = `: heartbeat\r\n\r\nevent: telemetry\r\ndata: ${JSON.stringify(first)}\r\n\r\nevent: telemetry\ndata: ${JSON.stringify(second)}\n\n`;
    const bytes = new TextEncoder().encode(wire);
    const parser = new ExtractionSseParser();
    const pages: ExtractionTelemetryPage[] = [];
    for (const byte of bytes) pages.push(...parser.push(Uint8Array.of(byte)));
    pages.push(...parser.finish());
    expect(pages.map((page) => page.nextCursor.afterSequence)).toEqual([1, 2]);
  });

  test("rejects malformed and unknown events without committing data", () => {
    const parser = new ExtractionSseParser();
    expect(() =>
      parser.push(new TextEncoder().encode("event: telemetry\ndata: nope\n\n")),
    ).toThrow(ExtractionSseProtocolError);
    expect(() =>
      new ExtractionSseParser().push(
        new TextEncoder().encode("event: command\ndata: {}\n\n"),
      ),
    ).toThrow(ExtractionSseProtocolError);
  });

  test("accepts a large chunk containing many individually bounded events", () => {
    const wire = Array.from({ length: 100 }, (_, index) => {
      const page = telemetryPage(index + 1, "running");
      return `event: telemetry\ndata: ${JSON.stringify(page)}\n\n`;
    }).join("");
    const parser = new ExtractionSseParser();
    expect(parser.push(new TextEncoder().encode(wire))).toHaveLength(100);
    expect(parser.finish()).toEqual([]);
  });
});

describe("extraction stream session", () => {
  test("exports command state and nullable weight-control trace columns", () => {
    const page: ExtractionTelemetryPage = {
      ...telemetryPage(1, "terminal"),
      baselineWeightDecigrams: 800,
      controlMode: "weight",
      selection: { kind: "profile", profileId: "profile-1" },
      terminalWeight: {
        compensationDecigrams: 10,
        completionReason: "stopped",
        cutoffWeightDecigrams: 340,
        extractionId: "sim-run-1",
        fallbackOccurred: false,
        finalWeightDecigrams: 42,
        settled: true,
        targetWeightDecigrams: 350,
      },
      weightControl: {
        compensationDecigrams: 10,
        targetWeightDecigrams: 350,
      },
    };
    const csv = extractionTraceToCsv(
      mergeExtractionTracePage(null, "philcoino-simulator", page),
    );
    expect(csv).toContain(
      "baseline_weight_g,weight_g,target_weight_g,compensation_g,cutoff_weight_g,terminal_weight_g,terminal_settled,weight_completion_reason,weight_fallback_occurred",
    );
    expect(csv).toContain(",on,off,unavailable,");
  });

  test("the mobile runtime does not instantiate the legacy trace poller", async () => {
    const source = await Bun.file(
      new URL("../hooks/use-scale.ts", import.meta.url),
    ).text();
    expect(source).not.toContain("WeightedTraceSyncSession");
    expect(source).toContain("pollingRef.current?.stop()");
  });

  test("streams simulator pages through the authenticated device client", async () => {
    const simulator = createSimulator();
    simulator.machine.startExtraction("mobile-stream-0001", { kind: "manual" });
    const client = new DeviceApiClient({
      address: "http://127.0.0.1:3000",
      token: DEFAULT_SIMULATOR_TOKEN,
      fetch: (url, init) =>
        Promise.resolve(
          simulator.app.request(url, {
            headers: init.headers,
            method: init.method,
            signal: init.signal,
          }),
        ),
    });
    const pages: ExtractionTelemetryPage[] = [];
    const streaming = client.streamExtractionTelemetry(undefined, {
      onPage: (page) => {
        pages.push(page);
      },
    });
    await settle();
    simulator.machine.advance(500);
    simulator.machine.stopExtraction();
    simulator.machine.advance(10_000);
    await streaming;
    expect(pages[0]).toMatchObject({ controlMode: "manual", status: "running" });
    expect(pages.at(-1)).toMatchObject({ status: "terminal", outcome: "stopped" });
  });

  test("commits pages before advancing the durable cursor and retries 250/500/1000/2000", async () => {
    const scheduler = new ManualScheduler();
    const repository = new InMemoryShotHistoryRepository();
    const cursors: Array<ExtractionTelemetryCursor | undefined> = [];
    const delays: number[] = [];
    const client: ExtractionStreamClient = {
      async streamExtractionTelemetry(cursor, options) {
        cursors.push(cursor);
        if (cursors.length === 1) await options.onPage(telemetryPage(1, "running"));
        throw new ApiClientError("offline", "disconnected");
      },
    };
    const session = new ExtractionStreamSession({
      client,
      deviceId: "philcoino-simulator",
      onStatus: () => {},
      onSupportChanged: () => {},
      onTrace: () => {},
      repository,
      scheduler: {
        clearTimeout: (handle) => scheduler.clearTimeout(handle),
        setTimeout: (callback, delay) => {
          delays.push(delay);
          return scheduler.setTimeout(callback, delay);
        },
      },
    });
    session.observeExtraction("sim-run-1");
    session.start();
    await settle();
    expect(await repository.loadTrace("philcoino-simulator", "sim-run-1")).not.toBeNull();
    expect(delays).toEqual([250]);
    scheduler.runNext();
    await settle();
    expect(cursors[1]).toEqual(telemetryPage(1, "running").nextCursor);
    expect(delays).toEqual([250, 500]);
    scheduler.runNext();
    await settle();
    scheduler.runNext();
    await settle();
    scheduler.runNext();
    await settle();
    expect(delays).toEqual([250, 500, 1_000, 2_000, 2_000]);
    session.stop();
  });

  test("restores the last durably committed cursor before reconnecting", async () => {
    const repository = new InMemoryShotHistoryRepository();
    const retainedPage = telemetryPage(7, "running");
    await repository.commitExtractionTracePage(
      "philcoino-simulator",
      retainedPage,
    );
    let receivedCursor: ExtractionTelemetryCursor | undefined;
    const session = new ExtractionStreamSession({
      client: {
        async streamExtractionTelemetry(cursor) {
          receivedCursor = cursor;
          throw new ApiClientError("offline", "disconnected");
        },
      },
      deviceId: "philcoino-simulator",
      onStatus: () => {},
      onSupportChanged: () => {},
      onTrace: () => {},
      repository,
    });
    session.observeExtraction("sim-run-1");
    session.start();
    await settle();
    expect(receivedCursor).toEqual(retainedPage.nextCursor);
    session.stop();
  });

  test("marks 404 unsupported and does not provide a polling fallback", async () => {
    const statuses: string[] = [];
    const support: boolean[] = [];
    const session = new ExtractionStreamSession({
      client: {
        async streamExtractionTelemetry() {
          throw new ApiClientError("not-found", "missing", { status: 404 });
        },
      },
      deviceId: "philcoino-simulator",
      onStatus: (status) => statuses.push(status),
      onSupportChanged: (value) => support.push(value),
      onTrace: () => {},
      repository: new InMemoryShotHistoryRepository(),
    });
    session.observeExtraction("sim-run-1");
    session.start();
    await settle();
    expect(support).toEqual([false]);
    expect(statuses.at(-1)).toBe("unsupported");
  });

  test("aborts immediately when the app backgrounds", async () => {
    let aborted = false;
    const session = new ExtractionStreamSession({
      client: {
        async streamExtractionTelemetry(_cursor, options) {
          await new Promise<void>((resolve) => {
            options.signal?.addEventListener("abort", () => {
              aborted = true;
              resolve();
            });
          });
        },
      },
      deviceId: "philcoino-simulator",
      onStatus: () => {},
      onSupportChanged: () => {},
      onTrace: () => {},
      repository: new InMemoryShotHistoryRepository(),
    });
    session.observeExtraction("sim-run-1");
    session.start();
    await settle();
    session.stop();
    await settle();
    expect(aborted).toBe(true);
  });
});

class ManualScheduler {
  private callbacks: Array<() => void> = [];

  clearTimeout(handle: unknown): void {
    const callback = handle as () => void;
    this.callbacks = this.callbacks.filter((candidate) => candidate !== callback);
  }

  setTimeout(callback: () => void, _delay: number): unknown {
    this.callbacks.push(callback);
    return callback;
  }

  runNext(): void {
    this.callbacks.shift()?.();
  }
}

function telemetryPage(
  sequence: number,
  status: "running" | "terminal",
): ExtractionTelemetryPage {
  return {
    baselineWeightDecigrams: null,
    bootId: "00000000000000000000000000000001",
    capturedAtUptimeMs: sequence * 250,
    continuity: sequence === 1 ? "initial" : "continuous",
    controlMode: "manual",
    deviceId: "philcoino-simulator",
    extractionId: "sim-run-1",
    hasMore: false,
    latestSequence: sequence,
    nextCursor: {
      afterSequence: sequence,
      bootId: "00000000000000000000000000000001",
      extractionId: "sim-run-1",
    },
    oldestSequence: 1,
    outcome: status === "terminal" ? "stopped" : null,
    samples: [
      {
        activeTargetC: 93,
        boilerTemperatureC: 92.5,
        elapsedMs: sequence * 250,
        extractionElapsedMs: sequence * 250,
        heaterActive: true,
        netWeightDecigrams: null,
        phase: status === "terminal" ? "settling" : "manual",
        pumpCommand: status === "terminal" ? "off" : "running",
        scaleAvailability: "unavailable",
        sequence,
        uptimeMs: sequence * 250,
      },
    ],
    selection: { kind: "manual" },
    status,
    terminalWeight: null,
    version: 1,
    weightControl: null,
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
