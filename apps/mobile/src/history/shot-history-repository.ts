import type { ExtractionSummary, WeightedShotSummary } from "./shot-history";
import type {
  ExtractionTelemetryPage,
  WeightedExtractionTracePage,
} from "@philcoino/protocol";
import {
  mergeExtractionTracePage,
  type StoredExtractionTrace,
} from "./extraction-trace";
import {
  mergeTracePage,
  type StoredWeightedShotTrace,
} from "./weighted-shot-trace";

export interface ShotHistoryRepository {
  append(summary: ExtractionSummary | WeightedShotSummary): Promise<void>;
  commitExtractionTracePage(
    deviceId: string,
    page: ExtractionTelemetryPage,
  ): Promise<StoredExtractionTrace>;
  commitTracePage(
    deviceId: string,
    page: WeightedExtractionTracePage,
  ): Promise<StoredWeightedShotTrace>;
  clearDevice(deviceId: string): Promise<void>;
  load(deviceId: string, nowMs?: number): Promise<ExtractionSummary[]>;
  loadTrace(
    deviceId: string,
    extractionId: string,
    bootId?: string | null,
  ): Promise<StoredExtractionTrace | null>;
  prune(nowMs?: number): Promise<void>;
}

export class InMemoryShotHistoryRepository implements ShotHistoryRepository {
  private records: ExtractionSummary[] = [];
  private traces = new Map<string, StoredExtractionTrace>();

  async append(summary: ExtractionSummary | WeightedShotSummary): Promise<void> {
    const normalized = normalizeSummary(summary);
    const index = this.records.findIndex(
      (record) =>
        record.deviceId === normalized.deviceId &&
        record.extractionId === normalized.extractionId &&
        record.bootId === normalized.bootId,
    );
    if (index >= 0) {
      this.records[index] = normalized;
    } else {
      this.records.push(normalized);
    }
  }

  async commitExtractionTracePage(
    deviceId: string,
    page: ExtractionTelemetryPage,
  ): Promise<StoredExtractionTrace> {
    const key = traceKey(deviceId, page.extractionId, page.bootId);
    const trace = mergeExtractionTracePage(
      this.traces.get(key) ?? null,
      deviceId,
      page,
    );
    this.traces.set(key, trace);
    return trace;
  }

  async clearDevice(deviceId: string): Promise<void> {
    this.records = this.records.filter((record) => record.deviceId !== deviceId);
    for (const [key, trace] of this.traces) {
      if (trace.deviceId === deviceId) this.traces.delete(key);
    }
  }

  async commitTracePage(
    deviceId: string,
    page: WeightedExtractionTracePage,
  ): Promise<StoredWeightedShotTrace> {
    const key = traceKey(deviceId, page.extractionId, page.bootId);
    const previous = this.traces.get(key);
    const trace = mergeTracePage(
      previous === undefined ? null : legacyTrace(previous),
      deviceId,
      page,
    );
    this.traces.set(key, trace);
    return trace;
  }

  async load(
    deviceId: string,
    nowMs = Date.now(),
  ): Promise<ExtractionSummary[]> {
    void nowMs;
    return this.records
      .filter((record) => record.deviceId === deviceId)
      .map((record) => {
        const trace = this.traces.get(
          traceKey(deviceId, record.extractionId, record.bootId),
        );
        return {
          ...record,
          traceCompleteness: trace?.completeness ?? null,
          traceSampleCount: trace?.samples.length ?? 0,
        };
      })
      .sort((left, right) => right.recordedAtMs - left.recordedAtMs);
  }

  async prune(nowMs = Date.now()): Promise<void> {
    void nowMs;
  }

  async loadTrace(
    deviceId: string,
    extractionId: string,
    bootId?: string | null,
  ): Promise<StoredExtractionTrace | null> {
    if (bootId !== undefined) {
      return this.traces.get(traceKey(deviceId, extractionId, bootId)) ?? null;
    }
    const traces = [...this.traces.values()];
    for (let index = traces.length - 1; index >= 0; index -= 1) {
      const trace = traces[index];
      if (trace.deviceId === deviceId && trace.extractionId === extractionId) {
        return trace;
      }
    }
    return null;
  }
}

function normalizeSummary(
  summary: ExtractionSummary | WeightedShotSummary,
): ExtractionSummary {
  if ("controlMode" in summary) return summary;
  return {
    ...summary,
    bootId: null,
    controlMode: "weight",
    outcome:
      summary.outcome === "stopped"
        ? "stopped"
        : summary.outcome === "safety-cutoff"
          ? "failed"
          : "completed",
    selection: { kind: "profile", profileId: summary.profileId },
  };
}

function legacyTrace(trace: StoredExtractionTrace): StoredWeightedShotTrace {
  return {
    bootId: trace.bootId,
    completeness: trace.completeness,
    deviceId: trace.deviceId,
    extractionId: trace.extractionId,
    samples: trace.samples
      .filter(
        (sample): sample is typeof sample & {
          phase: Exclude<typeof sample.phase, "manual">;
        } => sample.phase !== "manual",
      )
      .map((sample) => ({
        activeTargetC: sample.activeTargetC,
        boilerTemperatureC: sample.boilerTemperatureC,
        derivedFlowGPerS: sample.derivedFlowGPerS,
        elapsedMs: sample.elapsedMs,
        gapStatus: sample.gapStatus,
        netWeightDecigrams: sample.netWeightDecigrams,
        phase: sample.phase,
        pumpCommand: sample.pumpCommand,
        scaleAvailability: sample.scaleAvailability,
        sequence: sample.sequence,
        uptimeMs: sample.uptimeMs,
      })),
  };
}

function traceKey(
  deviceId: string,
  extractionId: string,
  bootId: string | null,
): string {
  return `${deviceId}\u0000${bootId ?? "legacy"}\u0000${extractionId}`;
}

export const shotHistoryRepository = new InMemoryShotHistoryRepository();
