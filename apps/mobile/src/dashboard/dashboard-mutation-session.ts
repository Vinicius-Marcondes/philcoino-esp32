import type {
  HeaterSettingsResponse,
  MachineState,
  Mode,
  ModeResponse,
  OverTemperatureDismissResponse,
  TemperatureSettingsRequest,
  TemperatureSettingsResponse,
} from "@philcoino/protocol";

import { ApiClientError } from "../networking/api-client-error";
import {
  connectionStateFromError,
  type ConnectionState,
} from "../networking/connection-state";

export type DashboardMutationKind = "fault" | "heater" | "mode" | "temperatures";
export type DashboardMutationStatus =
  | "idle"
  | "pending"
  | "acknowledged"
  | "rejected"
  | "disconnected";

export interface DashboardMutationState {
  message: string;
  status: DashboardMutationStatus;
}

export const idleMutationState: DashboardMutationState = {
  message: "",
  status: "idle",
};

const mutationKinds: DashboardMutationKind[] = [
  "fault",
  "heater",
  "mode",
  "temperatures",
];

export interface DashboardMutationClient {
  dismissOverTemperature(
    options?: { signal?: AbortSignal },
  ): Promise<OverTemperatureDismissResponse>;
  setMode(
    request: { mode: Mode },
    options?: { signal?: AbortSignal },
  ): Promise<ModeResponse>;
  setHeaterEnabled(
    request: { heaterEnabled: boolean },
    options?: { signal?: AbortSignal },
  ): Promise<HeaterSettingsResponse>;
  updateTemperatureSettings(
    settings: TemperatureSettingsRequest,
    options?: { signal?: AbortSignal },
  ): Promise<TemperatureSettingsResponse>;
}

interface DashboardPollingControl {
  pause(): void;
  resume(): void;
}

interface DashboardMutationSessionOptions {
  client: DashboardMutationClient;
  onConnectionLost: (connection: ConnectionState) => void;
  onHeaterAcknowledged: (settings: HeaterSettingsResponse) => void;
  onModeAcknowledged: (mode: Mode) => void;
  onMutationChange: (
    kind: DashboardMutationKind,
    state: DashboardMutationState,
  ) => void;
  onOverTemperatureDismissed: (snapshot: MachineState) => void;
  onTemperatureSettingsAcknowledged: (
    settings: TemperatureSettingsResponse,
  ) => void;
  polling: DashboardPollingControl;
}

export class DashboardMutationSession {
  private readonly client: DashboardMutationClient;
  private readonly onConnectionLost: (connection: ConnectionState) => void;
  private readonly onHeaterAcknowledged: (settings: HeaterSettingsResponse) => void;
  private readonly onModeAcknowledged: (mode: Mode) => void;
  private readonly onMutationChange: DashboardMutationSessionOptions["onMutationChange"];
  private readonly onOverTemperatureDismissed: DashboardMutationSessionOptions["onOverTemperatureDismissed"];
  private readonly onTemperatureSettingsAcknowledged: DashboardMutationSessionOptions["onTemperatureSettingsAcknowledged"];
  private readonly polling: DashboardPollingControl;

  private activeController: AbortController | null = null;
  private generation = 0;
  private pending = false;
  private running = false;

  constructor(options: DashboardMutationSessionOptions) {
    this.client = options.client;
    this.onConnectionLost = options.onConnectionLost;
    this.onHeaterAcknowledged = options.onHeaterAcknowledged;
    this.onModeAcknowledged = options.onModeAcknowledged;
    this.onMutationChange = options.onMutationChange;
    this.onOverTemperatureDismissed = options.onOverTemperatureDismissed;
    this.onTemperatureSettingsAcknowledged =
      options.onTemperatureSettingsAcknowledged;
    this.polling = options.polling;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    for (const kind of mutationKinds) {
      this.onMutationChange(kind, idleMutationState);
    }
  }

  stop(): void {
    this.running = false;
    this.pending = false;
    this.generation += 1;
    this.activeController?.abort();
    this.activeController = null;
  }

  setMode(mode: Mode): void {
    void this.perform(
      "mode",
      (signal) => this.client.setMode({ mode }, { signal }),
      (response) => {
        this.onModeAcknowledged(response.mode);
        return `Machine acknowledged ${capitalize(response.mode)} mode.`;
      },
      `Waiting for the machine to acknowledge ${capitalize(mode)} mode…`,
    );
  }

  setHeaterEnabled(heaterEnabled: boolean): void {
    void this.perform(
      "heater",
      (signal) => this.client.setHeaterEnabled({ heaterEnabled }, { signal }),
      (response) => {
        this.onHeaterAcknowledged(response);
        return response.heaterEnabled
          ? "Machine allowed automatic heater control."
          : "Machine turned heater output off.";
      },
      heaterEnabled
        ? "Waiting for the machine to allow heater control..."
        : "Waiting for the machine to turn heater output off...",
    );
  }

  updateTemperatureSettings(settings: TemperatureSettingsRequest): void {
    void this.perform(
      "temperatures",
      (signal) =>
        this.client.updateTemperatureSettings(
          settings,
          { signal },
        ),
      (response) => {
        this.onTemperatureSettingsAcknowledged(response);
        return `Machine saved Brew ${response.brewTargetC}°C and Steam ${response.steamTargetC}°C.`;
      },
      pendingTemperatureMessage(settings),
    );
  }

  dismissOverTemperature(): void {
    void this.perform(
      "fault",
      (signal) => this.client.dismissOverTemperature({ signal }),
      (response) => {
        this.onOverTemperatureDismissed(response);
        return "Machine dismissed the over-temperature limit and resumed normal control.";
      },
      "Waiting for the machine to dismiss the over-temperature limit…",
    );
  }

  dismissMutation(kind: DashboardMutationKind): void {
    if (!this.running) {
      return;
    }

    this.onMutationChange(kind, idleMutationState);
  }

  private async perform<T>(
    kind: DashboardMutationKind,
    request: (signal: AbortSignal) => Promise<T>,
    acknowledge: (response: T) => string,
    pendingMessage: string,
  ): Promise<void> {
    if (!this.running || this.pending) {
      return;
    }

    this.pending = true;
    const controller = new AbortController();
    this.activeController = controller;
    const generation = ++this.generation;
    for (const otherKind of mutationKinds) {
      if (otherKind !== kind) {
        this.onMutationChange(otherKind, idleMutationState);
      }
    }
    this.onMutationChange(kind, {
      message: pendingMessage,
      status: "pending",
    });
    this.polling.pause();

    try {
      const response = await request(controller.signal);
      if (!this.isCurrent(generation)) {
        return;
      }

      const message = acknowledge(response);
      this.onMutationChange(kind, { message, status: "acknowledged" });
    } catch (error) {
      if (!this.isCurrent(generation) || controller.signal.aborted) {
        return;
      }

      const outcome = mutationOutcomeFromError(error);
      this.onMutationChange(kind, outcome.state);
      if (outcome.connection !== null) {
        this.onConnectionLost(outcome.connection);
      }
    } finally {
      if (this.isCurrent(generation)) {
        this.pending = false;
        this.activeController = null;
        this.polling.resume();
      }
    }
  }

  private isCurrent(generation: number): boolean {
    return this.running && this.generation === generation;
  }
}

export function mutationOutcomeFromError(error: unknown): {
  connection: ConnectionState | null;
  state: DashboardMutationState;
} {
  if (
    error instanceof ApiClientError &&
    (error.kind === "http" || error.kind === "invalid-request")
  ) {
    return {
      connection: null,
      state: {
        message:
          error.response?.error.message ??
          "The machine rejected the requested change.",
        status: "rejected",
      },
    };
  }

  const connection = connectionStateFromError(error) ?? { status: "offline" };
  return {
    connection,
    state: {
      message: disconnectedMutationMessage(error),
      status: "disconnected",
    },
  };
}

function disconnectedMutationMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.kind) {
      case "timeout":
        return "The machine did not acknowledge the change before the request timed out. No change is shown.";
      case "unauthorized":
        return "The saved token was rejected before the change was acknowledged. No change is shown.";
      case "protocol":
        return "The acknowledgement did not match API v1. No change is shown.";
      case "not-found":
      case "offline":
        return "Connection to the machine was lost before acknowledgement. No change is shown.";
      case "cancelled":
        return "The change was cancelled before acknowledgement. No change is shown.";
      case "http":
      case "invalid-request":
        break;
    }
  }
  return "The change could not be acknowledged. No change is shown.";
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function pendingTemperatureMessage(
  settings: TemperatureSettingsRequest,
): string {
  const targets = [
    settings.brewTargetC === undefined
      ? null
      : `Brew ${settings.brewTargetC}°C`,
    settings.steamTargetC === undefined
      ? null
      : `Steam ${settings.steamTargetC}°C`,
  ].filter((target): target is string => target !== null);
  return `Waiting for the machine to validate and save ${targets.join(" and ")}…`;
}
