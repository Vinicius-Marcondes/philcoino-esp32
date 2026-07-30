import type {
  ApiV2ErrorCode,
  ErrorCode,
  TemperatureCalibrationState,
} from "@philcoino/protocol";

import {
  ApiClientError,
  type ApiClientErrorKind,
} from "../networking/api-client-error";
import {
  connectionStateFromError,
  type ConnectionState,
} from "../networking/connection-state";

export const TEMPERATURE_CALIBRATION_POLL_INTERVAL_MS = 5_000;

export interface TemperatureCalibrationClient {
  cancelTemperatureCalibration(
    request: { calibrationId: string },
    options?: { signal?: AbortSignal },
  ): Promise<TemperatureCalibrationState>;
  getTemperatureCalibration(
    calibrationId?: string,
    options?: { signal?: AbortSignal },
  ): Promise<TemperatureCalibrationState>;
  saveTemperatureCalibration(
    request: { calibrationId: string },
    options?: { signal?: AbortSignal },
  ): Promise<TemperatureCalibrationState>;
  startTemperatureCalibration(
    options?: { signal?: AbortSignal },
  ): Promise<TemperatureCalibrationState>;
  updateTemperatureCalibrationCandidate(
    request: {
      calibrationId: string;
      candidateRawTargetC: number;
    },
    options?: { signal?: AbortSignal },
  ): Promise<TemperatureCalibrationState>;
}

export type TemperatureCalibrationPendingMutation =
  | "cancel"
  | "candidate"
  | "save"
  | "start";

export type TemperatureCalibrationSessionStatus =
  | "idle"
  | "loading"
  | "ready"
  | "pending"
  | "saved"
  | "cancelled"
  | "rejected"
  | "disconnected";

export type TemperatureCalibrationSessionErrorCode =
  | ApiV2ErrorCode
  | ErrorCode
  | ApiClientErrorKind
  | "unknown";

export interface TemperatureCalibrationSessionError {
  code: TemperatureCalibrationSessionErrorCode;
  message: string;
}

export interface TemperatureCalibrationSessionState {
  error: TemperatureCalibrationSessionError | null;
  pendingMutation: TemperatureCalibrationPendingMutation | null;
  snapshot: TemperatureCalibrationState | null;
  status: TemperatureCalibrationSessionStatus;
}

interface PollingScheduler {
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
}

interface TemperatureCalibrationSessionOptions {
  client: TemperatureCalibrationClient;
  onConnectionLost?: (connection: ConnectionState) => void;
  onStateChange: (state: TemperatureCalibrationSessionState) => void;
  pollIntervalMs?: number;
  scheduler?: PollingScheduler;
}

const systemScheduler: PollingScheduler = {
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
};

export const idleTemperatureCalibrationSessionState:
  TemperatureCalibrationSessionState = {
  error: null,
  pendingMutation: null,
  snapshot: null,
  status: "idle",
};

export class TemperatureCalibrationSession {
  private readonly client: TemperatureCalibrationClient;
  private readonly onConnectionLost: (connection: ConnectionState) => void;
  private readonly onStateChange: (
    state: TemperatureCalibrationSessionState,
  ) => void;
  private readonly pollIntervalMs: number;
  private readonly scheduler: PollingScheduler;

  private activeController: AbortController | null = null;
  private closeReason: "background" | "navigation" | "disconnect" | null =
    null;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private running = false;
  private state = idleTemperatureCalibrationSessionState;
  private timer: unknown | null = null;

  constructor(options: TemperatureCalibrationSessionOptions) {
    this.client = options.client;
    this.onConnectionLost = options.onConnectionLost ?? (() => undefined);
    this.onStateChange = options.onStateChange;
    this.pollIntervalMs =
      options.pollIntervalMs ?? TEMPERATURE_CALIBRATION_POLL_INTERVAL_MS;
    this.scheduler = options.scheduler ?? systemScheduler;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.closeReason = null;
    const generation = ++this.generation;
    this.publish({
      error: null,
      pendingMutation: null,
      snapshot: null,
      status: "loading",
    });
    void this.enqueue(() => this.poll(generation));
  }

  pause(): void {
    this.leave("background");
  }

  stop(): void {
    this.leave("navigation");
  }

  resume(): void {
    if (!this.running) {
      this.start();
    }
  }

  startCalibration(): Promise<void> {
    return this.mutate("start", (signal) =>
      this.client.startTemperatureCalibration({ signal }),
    );
  }

  updateCandidate(candidateRawTargetC: number): Promise<void> {
    return this.mutate("candidate", (signal) => {
      const active = this.requireActiveSnapshot();
      return this.client.updateTemperatureCalibrationCandidate(
        {
          calibrationId: active.calibrationId,
          candidateRawTargetC,
        },
        { signal },
      );
    });
  }

  save(): Promise<void> {
    return this.mutate(
      "save",
      (signal) => {
        const active = this.requireActiveSnapshot();
        return this.client.saveTemperatureCalibration(
          { calibrationId: active.calibrationId },
          { signal },
        );
      },
      "saved",
    );
  }

  cancel(): Promise<void> {
    return this.mutate(
      "cancel",
      (signal) => {
        const active = this.requireActiveSnapshot();
        return this.client.cancelTemperatureCalibration(
          { calibrationId: active.calibrationId },
          { signal },
        );
      },
      "cancelled",
    );
  }

  private mutate(
    mutation: TemperatureCalibrationPendingMutation,
    request: (signal: AbortSignal) => Promise<TemperatureCalibrationState>,
    terminalStatus?: "cancelled" | "saved",
  ): Promise<void> {
    if (!this.running || this.closeReason !== null) {
      return Promise.resolve();
    }
    this.clearTimer();
    const generation = this.generation;
    return this.enqueue(async () => {
      if (!this.isCurrent(generation)) {
        return;
      }
      this.publish({
        ...this.state,
        error: null,
        pendingMutation: mutation,
        status: "pending",
      });
      const controller = new AbortController();
      this.activeController = controller;
      try {
        const snapshot = await request(controller.signal);
        if (!this.isCurrent(generation)) {
          return;
        }
        this.publish({
          error: null,
          pendingMutation: null,
          snapshot,
          status: terminalStatus ?? "ready",
        });
        if (terminalStatus !== undefined) {
          this.running = false;
          this.generation += 1;
          this.clearTimer();
          return;
        }
      } catch (error) {
        if (!this.isCurrent(generation)) {
          return;
        }
        this.handleError(error);
      } finally {
        if (this.activeController === controller) {
          this.activeController = null;
        }
        if (this.isCurrent(generation)) {
          this.schedulePoll(generation);
        }
      }
    });
  }

  private async poll(generation: number): Promise<void> {
    if (!this.isCurrent(generation)) {
      return;
    }
    const controller = new AbortController();
    this.activeController = controller;
    try {
      const calibrationId =
        this.state.snapshot?.status === "calibrating"
          ? this.state.snapshot.calibrationId
          : undefined;
      const snapshot = await this.client.getTemperatureCalibration(
        calibrationId,
        { signal: controller.signal },
      );
      if (!this.isCurrent(generation)) {
        return;
      }
      this.publish({
        error: null,
        pendingMutation: null,
        snapshot,
        status: "ready",
      });
    } catch (error) {
      if (!this.isCurrent(generation)) {
        return;
      }
      this.handleError(error);
    } finally {
      if (this.activeController === controller) {
        this.activeController = null;
      }
      if (this.isCurrent(generation)) {
        this.schedulePoll(generation);
      }
    }
  }

  private handleError(error: unknown): void {
    const sessionError = calibrationSessionError(error);
    if (
      error instanceof ApiClientError &&
      (error.kind === "http" || error.kind === "invalid-request")
    ) {
      const terminal = isTerminalCalibrationError(sessionError.code);
      this.publish({
        ...this.state,
        error: sessionError,
        pendingMutation: null,
        snapshot: terminal ? null : this.state.snapshot,
        status: "rejected",
      });
      if (terminal) {
        this.running = false;
        this.generation += 1;
        this.clearTimer();
      }
      return;
    }
    const connection = connectionStateFromError(error);
    if (
      connection !== null &&
      connection.status !== "online" &&
      connection.status !== "connecting"
    ) {
      this.closeForDisconnection(connection, sessionError);
      return;
    }
    this.publish({
      ...this.state,
      error: sessionError,
      pendingMutation: null,
      status: "rejected",
    });
    if (isTerminalCalibrationError(sessionError.code)) {
      this.running = false;
      this.generation += 1;
      this.clearTimer();
    }
  }

  private closeForDisconnection(
    connection: ConnectionState,
    error: TemperatureCalibrationSessionError,
  ): void {
    const activeId =
      this.state.snapshot?.status === "calibrating"
        ? this.state.snapshot.calibrationId
        : null;
    this.closeReason ??= "disconnect";
    this.running = false;
    this.generation += 1;
    this.clearTimer();
    this.activeController?.abort();
    this.activeController = null;
    this.publish({
      error,
      pendingMutation: null,
      snapshot: null,
      status: "disconnected",
    });
    this.onConnectionLost(connection);
    this.bestEffortCancel(activeId);
  }

  private leave(reason: "background" | "navigation"): void {
    if (!this.running || this.closeReason !== null) {
      return;
    }
    const activeId =
      this.state.snapshot?.status === "calibrating"
        ? this.state.snapshot.calibrationId
        : null;
    this.closeReason = reason;
    this.running = false;
    this.generation += 1;
    this.clearTimer();
    this.activeController?.abort();
    this.activeController = null;
    this.publish({
      error: null,
      pendingMutation: null,
      snapshot: null,
      status: "cancelled",
    });
    this.bestEffortCancel(activeId);
  }

  private bestEffortCancel(calibrationId: string | null): void {
    if (calibrationId === null) {
      return;
    }
    void this.enqueue(async () => {
      try {
        await this.client.cancelTemperatureCalibration({ calibrationId });
      } catch {
        // The firmware inactivity lease is the fail-safe when Cancel cannot
        // reach the device.
      }
    });
  }

  private schedulePoll(generation: number): void {
    this.clearTimer();
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      void this.enqueue(() => this.poll(generation));
    }, this.pollIntervalMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private requireActiveSnapshot() {
    const snapshot = this.state.snapshot;
    if (snapshot?.status !== "calibrating") {
      throw new ApiClientError(
        "invalid-request",
        "No acknowledged temperature calibration is active.",
      );
    }
    return snapshot;
  }

  private isCurrent(generation: number): boolean {
    return (
      this.running &&
      this.closeReason === null &&
      this.generation === generation
    );
  }

  private publish(state: TemperatureCalibrationSessionState): void {
    this.state = state;
    this.onStateChange(state);
  }
}

function calibrationSessionError(
  error: unknown,
): TemperatureCalibrationSessionError {
  if (!(error instanceof ApiClientError)) {
    return {
      code: "unknown",
      message: "The temperature calibration request failed.",
    };
  }
  const responseCode = error.response?.error.code;
  return {
    code: responseCode ?? error.kind,
    message: error.response?.error.message ?? error.message,
  };
}

function isTerminalCalibrationError(
  code: TemperatureCalibrationSessionErrorCode,
): boolean {
  return (
    code === "temperature_calibration_expired" ||
    code === "temperature_calibration_inactive" ||
    code === "temperature_calibration_session_mismatch"
  );
}
