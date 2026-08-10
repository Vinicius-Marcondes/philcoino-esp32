import type {
  ExtractionTelemetryCursor,
  ExtractionTelemetryPage,
} from "@philcoino/protocol";

import type { ShotHistoryRepository } from "../history/shot-history-repository";
import type { StoredExtractionTrace } from "../history/extraction-trace";
import { extractionSummaryFromPage } from "../history/shot-history";
import { ApiClientError } from "../networking/api-client-error";

const RETRY_DELAYS_MS = [250, 500, 1_000, 2_000] as const;

export type ExtractionStreamStatus =
  | "idle"
  | "connecting"
  | "live"
  | "stale"
  | "unsupported";

export interface ExtractionStreamClient {
  streamExtractionTelemetry(
    cursor: ExtractionTelemetryCursor | undefined,
    options: {
      onPage(page: ExtractionTelemetryPage): Promise<void> | void;
      signal?: AbortSignal;
    },
  ): Promise<void>;
}

interface Scheduler {
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
}

const systemScheduler: Scheduler = {
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
};

export class ExtractionStreamSession {
  private abort: AbortController | null = null;
  private armed = false;
  private cursor: ExtractionTelemetryCursor | undefined;
  private cursorReady = true;
  private expectedExtractionId: string | null = null;
  private foreground = false;
  private generation = 0;
  private retryIndex = 0;
  private timer: unknown | null = null;
  private unsupported = false;

  constructor(
    private readonly options: {
      client: ExtractionStreamClient;
      deviceId: string;
      onStatus(status: ExtractionStreamStatus): void;
      onSupportChanged(supported: boolean): void;
      onTrace(trace: StoredExtractionTrace | null): void;
      repository: ShotHistoryRepository;
      scheduler?: Scheduler;
    },
  ) {}

  observeExtraction(extractionId: string | null): void {
    if (extractionId === null) return;
    if (this.expectedExtractionId !== extractionId) {
      this.abort?.abort();
      this.abort = null;
      this.expectedExtractionId = extractionId;
      this.cursor = undefined;
      this.cursorReady = false;
      this.armed = true;
      this.retryIndex = 0;
      void this.options.repository
        .loadTrace(this.options.deviceId, extractionId)
        .then((trace) => {
          if (this.expectedExtractionId !== extractionId) return;
          const lastSample = trace?.samples.at(-1);
          if (trace !== null && lastSample !== undefined) {
            this.cursor = {
              afterSequence: lastSample.sequence,
              bootId: trace.bootId,
              extractionId,
            };
          }
        })
        .catch(() => {
          // A failed cursor restore starts from the oldest retained stream page.
        })
        .finally(() => {
          if (this.expectedExtractionId !== extractionId) return;
          this.cursorReady = true;
          if (this.foreground && !this.unsupported) this.ensureConnected();
        });
    }
    if (this.foreground && this.cursorReady && !this.unsupported) {
      this.ensureConnected();
    }
  }

  start(): void {
    if (this.foreground) return;
    this.foreground = true;
    this.generation += 1;
    if (this.armed && this.cursorReady && !this.unsupported) {
      this.connect(this.generation);
    }
  }

  stop(): void {
    this.foreground = false;
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
    if (!this.unsupported) this.options.onStatus("idle");
  }

  private get scheduler(): Scheduler {
    return this.options.scheduler ?? systemScheduler;
  }

  private ensureConnected(): void {
    if (!this.cursorReady || this.abort !== null || this.timer !== null) return;
    this.generation += 1;
    this.connect(this.generation);
  }

  private connect(generation: number): void {
    if (!this.isCurrent(generation) || !this.armed) return;
    const controller = new AbortController();
    this.abort = controller;
    this.options.onStatus("connecting");
    void this.options.client
      .streamExtractionTelemetry(this.cursor, {
        signal: controller.signal,
        onPage: async (page) => {
          if (!this.isCurrent(generation)) return;
          if (page.deviceId !== this.options.deviceId) {
            throw new ApiClientError(
              "protocol",
              "The telemetry stream changed device identity.",
            );
          }
          const trace = await this.options.repository.commitExtractionTracePage(
            this.options.deviceId,
            page,
          );
          if (page.status === "terminal") {
            const summary = extractionSummaryFromPage(this.options.deviceId, page);
            await this.options.repository.append({
              ...summary,
              recordStatus:
                trace.completeness === "complete" ? "complete" : "incomplete",
              traceCompleteness: trace.completeness,
              traceSampleCount: trace.samples.length,
            });
          }
          if (!this.isCurrent(generation)) return;
          this.cursor = page.nextCursor;
          this.retryIndex = 0;
          this.options.onSupportChanged(true);
          this.options.onStatus("live");
          this.options.onTrace(trace);
          if (page.status === "terminal") {
            this.armed = false;
            this.options.onStatus("idle");
          }
        },
      })
      .then(() => {
        if (!this.isCurrent(generation) || !this.armed) return;
        this.options.onStatus("stale");
        this.scheduleRetry(generation);
      })
      .catch((error: unknown) => {
        if (!this.isCurrent(generation)) return;
        if (error instanceof ApiClientError && error.kind === "not-found") {
          this.unsupported = true;
          this.armed = false;
          this.options.onSupportChanged(false);
          this.options.onStatus("unsupported");
          return;
        }
        if (error instanceof ApiClientError && error.kind === "cancelled") {
          return;
        }
        this.options.onStatus("stale");
        this.scheduleRetry(generation);
      })
      .finally(() => {
        if (this.abort === controller) this.abort = null;
      });
  }

  private scheduleRetry(generation: number): void {
    if (!this.isCurrent(generation) || !this.armed || this.timer !== null) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.retryIndex, RETRY_DELAYS_MS.length - 1)];
    this.retryIndex += 1;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      if (!this.isCurrent(generation)) return;
      this.generation += 1;
      this.connect(this.generation);
    }, delay);
  }

  private isCurrent(generation: number): boolean {
    return this.foreground && this.generation === generation && !this.unsupported;
  }
}
