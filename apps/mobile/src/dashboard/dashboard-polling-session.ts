import type {
  MachineStateWithPredictionV2,
  ProfileSet,
} from "@philcoino/protocol";

import {
  connectingState,
  connectionStateFromError,
  onlineState,
  type ConnectionState,
} from "../networking/connection-state";

export const DASHBOARD_POLL_INTERVAL_MS = 1_000;

export interface DashboardStateClient {
  getProfiles(options?: { signal?: AbortSignal }): Promise<ProfileSet>;
  getLiveStateV2(
    options?: { signal?: AbortSignal },
  ): Promise<MachineStateWithPredictionV2>;
  resetLiveStateCapabilities?(): void;
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
  onSnapshotChange: (snapshot: MachineStateWithPredictionV2 | null) => void;
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
    snapshot: MachineStateWithPredictionV2 | null,
  ) => void;
  private readonly scheduler: PollingScheduler;

  private activeController: AbortController | null = null;
  private generation = 0;
  private paused = false;
  private running = false;
  private timer: unknown | null = null;
  private lastUptimeMs: number | null = null;

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

  private async poll(generation: number): Promise<void> {
    const controller = new AbortController();
    this.activeController = controller;

    try {
      const snapshot = await this.client.getLiveStateV2({
        signal: controller.signal,
      });
      if (!this.isCurrent(generation)) {
        return;
      }
      if (
        this.lastUptimeMs !== null &&
        snapshot.machine.uptimeMs < this.lastUptimeMs
      ) {
        this.client.resetLiveStateCapabilities?.();
        this.onDeviceRestart();
      }
      this.lastUptimeMs = snapshot.machine.uptimeMs;
      this.onSnapshotChange(snapshot);
      this.onConnectionChange(onlineState);
    } catch (error) {
      if (!this.isCurrent(generation)) {
        return;
      }
      const connection = connectionStateFromError(error);
      if (connection !== null) {
        if (
          connection.status === "offline" ||
          connection.status === "not-found"
        ) {
          this.client.resetLiveStateCapabilities?.();
        }
        this.onSnapshotChange(null);
        this.onConnectionChange(connection);
      }
    } finally {
      if (this.activeController === controller) {
        this.activeController = null;
      }
      if (this.isCurrent(generation)) {
        this.timer = this.scheduler.setTimeout(() => {
          this.timer = null;
          void this.poll(generation);
        }, this.intervalMs);
      }
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.paused && this.running && this.generation === generation;
  }
}
