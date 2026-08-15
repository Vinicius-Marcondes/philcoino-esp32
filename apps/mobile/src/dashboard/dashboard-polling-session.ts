import type { MachineStateV4 } from "@philcoino/protocol";

import {
  connectingState,
  connectionStateFromError,
  onlineState,
  type ConnectionState,
} from "../networking/connection-state";

export const DASHBOARD_POLL_INTERVAL_MS = 1_000;
export const DASHBOARD_TRANSIENT_RETRY_DELAY_MS = 100;

export interface DashboardStateClient {
  getState(options?: { signal?: AbortSignal }): Promise<MachineStateV4>;
}

interface PollingScheduler {
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
}

interface DashboardPollingSessionOptions {
  client: DashboardStateClient;
  intervalMs?: number;
  onConnectionChange: (connection: ConnectionState) => void;
  onDeviceRestart?: () => void;
  onSnapshotChange: (snapshot: MachineStateV4 | null) => void;
  scheduler?: PollingScheduler;
}

const systemScheduler: PollingScheduler = {
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
};

export class DashboardPollingSession {
  private readonly client: DashboardStateClient;
  private readonly intervalMs: number;
  private readonly onConnectionChange: (connection: ConnectionState) => void;
  private readonly onDeviceRestart: () => void;
  private readonly onSnapshotChange: (
    snapshot: MachineStateV4 | null,
  ) => void;
  private readonly scheduler: PollingScheduler;

  private activeController: AbortController | null = null;
  private generation = 0;
  private paused = false;
  private running = false;
  private timer: unknown | null = null;
  private lastBootId: string | null = null;
  private lastRevision = -1;

  constructor(options: DashboardPollingSessionOptions) {
    this.client = options.client;
    this.intervalMs = options.intervalMs ?? DASHBOARD_POLL_INTERVAL_MS;
    this.onConnectionChange = options.onConnectionChange;
    this.onDeviceRestart = options.onDeviceRestart ?? (() => undefined);
    this.onSnapshotChange = options.onSnapshotChange;
    this.scheduler = options.scheduler ?? systemScheduler;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.paused = false;
    const generation = ++this.generation;
    this.onSnapshotChange(null);
    this.onConnectionChange(connectingState);
    void this.poll(generation);
  }

  pause(): void {
    if (!this.running || this.paused) {
      return;
    }

    this.paused = true;
    this.generation += 1;
    this.cancelScheduledWork();
  }

  pauseForMutation(): void {
    if (!this.running || this.paused) {
      return;
    }

    this.paused = true;
    this.generation += 1;
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    // Let an already-written poll finish on the persistent native connection.
    // Cancelling it can close the socket and force the command to perform a
    // multi-second TLS handshake. Its stale result is ignored by generation.
  }

  resume(): void {
    if (!this.running || !this.paused) {
      return;
    }

    this.paused = false;
    const generation = ++this.generation;
    void this.poll(generation);
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    this.generation += 1;

    this.cancelScheduledWork();
  }

  private cancelScheduledWork(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }

    this.activeController?.abort();
    this.activeController = null;
  }

  private async poll(generation: number, transientAttempt = 0): Promise<void> {
    const controller = new AbortController();
    this.activeController = controller;
    let nextDelayMs = this.intervalMs;
    let nextTransientAttempt = 0;

    try {
      const snapshot = await this.client.getState({
        signal: controller.signal,
      });
      if (!this.isCurrent(generation)) {
        return;
      }
      if (this.lastBootId !== null && snapshot.bootId !== this.lastBootId) {
        this.onDeviceRestart();
        this.lastRevision = -1;
      }
      if (
        snapshot.bootId === this.lastBootId &&
        snapshot.revision <= this.lastRevision
      ) {
        return;
      }
      this.lastBootId = snapshot.bootId;
      this.lastRevision = snapshot.revision;
      this.onSnapshotChange(snapshot);
      this.onConnectionChange(onlineState);
    } catch (error) {
      if (!this.isCurrent(generation)) {
        return;
      }
      const connection = connectionStateFromError(error);
      if (connection !== null) {
        if (connection.status === "offline" && transientAttempt === 0) {
          // A single lost local packet should not blank the dashboard for a
          // full poll interval. Retry once immediately; a repeated failure is
          // surfaced and clears the snapshot normally.
          nextDelayMs = DASHBOARD_TRANSIENT_RETRY_DELAY_MS;
          nextTransientAttempt = 1;
        } else {
          this.onSnapshotChange(null);
          this.onConnectionChange(connection);
        }
      }
    } finally {
      if (this.activeController === controller) {
        this.activeController = null;
      }
      if (this.isCurrent(generation)) {
        this.timer = this.scheduler.setTimeout(() => {
          this.timer = null;
          void this.poll(generation, nextTransientAttempt);
        }, nextDelayMs);
      }
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.paused && this.running && this.generation === generation;
  }
}
