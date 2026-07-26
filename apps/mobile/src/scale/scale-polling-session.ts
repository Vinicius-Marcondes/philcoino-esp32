import type { ScaleState } from "@philcoino/protocol";

export const SCALE_FAST_POLL_INTERVAL_MS = 250;
export const SCALE_IDLE_POLL_INTERVAL_MS = 1_000;

export interface ScalePollingClient {
  getScale(options?: { signal?: AbortSignal }): Promise<ScaleState>;
}

interface PollingScheduler {
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
}

interface ScalePollingSessionOptions {
  client: ScalePollingClient;
  onError: (error: unknown) => void;
  onSnapshot: (snapshot: ScaleState) => Promise<void> | void;
  scalePageVisible: boolean;
  scheduler?: PollingScheduler;
}

const systemScheduler: PollingScheduler = {
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
};

export class ScalePollingSession {
  private readonly client: ScalePollingClient;
  private readonly onError: (error: unknown) => void;
  private readonly onSnapshot: (
    snapshot: ScaleState,
  ) => Promise<void> | void;
  private readonly scheduler: PollingScheduler;

  private activeController: AbortController | null = null;
  private generation = 0;
  private lastWeightedActive = false;
  private running = false;
  private scalePageVisible: boolean;
  private timer: unknown | null = null;

  constructor(options: ScalePollingSessionOptions) {
    this.client = options.client;
    this.onError = options.onError;
    this.onSnapshot = options.onSnapshot;
    this.scalePageVisible = options.scalePageVisible;
    this.scheduler = options.scheduler ?? systemScheduler;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    void this.poll(generation);
  }

  setScalePageVisible(visible: boolean): void {
    if (this.scalePageVisible === visible) return;
    this.scalePageVisible = visible;
    if (!this.running || this.activeController !== null || this.timer === null) {
      return;
    }
    this.scheduler.clearTimeout(this.timer);
    this.timer = null;
    this.schedule(this.generation);
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    this.activeController?.abort();
    this.activeController = null;
  }

  private async poll(generation: number): Promise<void> {
    const controller = new AbortController();
    this.activeController = controller;

    try {
      const snapshot = await this.client.getScale({
        signal: controller.signal,
      });
      if (!this.isCurrent(generation)) return;
      this.lastWeightedActive = snapshot.activeExtraction !== null;
      await this.onSnapshot(snapshot);
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.lastWeightedActive = false;
      this.onError(error);
    } finally {
      if (this.activeController === controller) {
        this.activeController = null;
      }
      if (this.isCurrent(generation)) {
        this.schedule(generation);
      }
    }
  }

  private schedule(generation: number): void {
    const delayMs =
      this.scalePageVisible || this.lastWeightedActive
        ? SCALE_FAST_POLL_INTERVAL_MS
        : SCALE_IDLE_POLL_INTERVAL_MS;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      void this.poll(generation);
    }, delayMs);
  }

  private isCurrent(generation: number): boolean {
    return this.running && this.generation === generation;
  }
}
