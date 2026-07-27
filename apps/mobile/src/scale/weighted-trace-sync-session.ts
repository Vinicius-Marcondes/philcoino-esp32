import type {
  ScaleTraceResponse,
  WeightedExtractionTraceCursor,
} from "@philcoino/protocol";

import type { ShotHistoryRepository } from "../history/shot-history-repository";
import type { StoredWeightedShotTrace } from "../history/weighted-shot-trace";
import { ApiClientError } from "../networking/api-client-error";

export interface WeightedTraceClient {
  getScaleTrace(
    cursor?: WeightedExtractionTraceCursor,
    options?: { signal?: AbortSignal },
  ): Promise<ScaleTraceResponse>;
}

export class WeightedTraceSyncSession {
  private abort: AbortController | null = null;
  private cursor: WeightedExtractionTraceCursor | undefined;
  private generation = 0;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly options: {
      client: WeightedTraceClient;
      deviceId: string;
      onSupportChanged(supported: boolean): void;
      onTrace(trace: StoredWeightedShotTrace | null): void;
      repository: ShotHistoryRepository;
    },
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    void this.poll(this.generation);
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private async poll(generation: number): Promise<void> {
    if (!this.running || generation !== this.generation) return;
    this.abort = new AbortController();
    try {
      const response = await this.options.client.getScaleTrace(this.cursor, {
        signal: this.abort.signal,
      });
      if (!this.running || generation !== this.generation) return;
      this.options.onSupportChanged(true);
      if (response.trace === null) {
        this.cursor = undefined;
        this.options.onTrace(null);
        this.schedule(generation, 1_000);
        return;
      }
      const stored = await this.options.repository.commitTracePage(
        this.options.deviceId,
        response.trace,
      );
      if (!this.running || generation !== this.generation) return;
      this.cursor = response.trace.nextCursor;
      this.options.onTrace(stored);
      this.schedule(
        generation,
        response.trace.hasMore
          ? 0
          : response.trace.status === "terminal"
            ? 1_000
            : 250,
      );
    } catch (error) {
      if (!this.running || generation !== this.generation) return;
      if (error instanceof ApiClientError && error.kind === "not-found") {
        this.options.onSupportChanged(false);
        this.stop();
        return;
      }
      if (!(error instanceof ApiClientError && error.kind === "cancelled")) {
        this.schedule(generation, 1_000);
      }
    } finally {
      this.abort = null;
    }
  }

  private schedule(generation: number, delayMs: number): void {
    if (!this.running || generation !== this.generation) return;
    this.timer = setTimeout(() => void this.poll(generation), delayMs);
  }
}
