import type {
  ApiV2ErrorCode,
  CooldownState,
  ErrorCode,
  ExtractionSelection,
  ExtractionState,
  HeaterSettingsResponse,
  MachineState,
  Mode,
  ModeResponse,
  OverTemperatureDismissResponse,
  ProfileSet,
  StartExtractionResponse,
  StartExtractionRequest,
  StopExtractionResponse,
  TemperatureSettingsRequest,
  TemperatureSettingsResponse,
  WeightControl,
} from "@philcoino/protocol";

import { ApiClientError } from "../networking/api-client-error";
import {
  connectionStateFromError,
  type ConnectionState,
} from "../networking/connection-state";
import { translate } from "../localization/i18n";

export type DashboardMutationKind =
  | "cooldown-start"
  | "cooldown-stop"
  | "extraction-start"
  | "extraction-stop"
  | "fault"
  | "heater"
  | "mode"
  | "profiles"
  | "temperatures";
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
  "cooldown-start",
  "cooldown-stop",
  "extraction-start",
  "extraction-stop",
  "fault",
  "heater",
  "mode",
  "profiles",
  "temperatures",
];

export interface DashboardMutationClient {
  startCooldown(
    request: { idempotencyKey: string },
    options?: { signal?: AbortSignal },
  ): Promise<CooldownState>;
  stopCooldown(options?: { signal?: AbortSignal }): Promise<CooldownState>;
  dismissOverTemperature(
    options?: { signal?: AbortSignal },
  ): Promise<OverTemperatureDismissResponse>;
  replaceProfiles(
    profiles: ProfileSet,
    options?: { signal?: AbortSignal },
  ): Promise<ProfileSet>;
  startExtraction(
    request: StartExtractionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<StartExtractionResponse>;
  stopExtraction(
    options?: { signal?: AbortSignal },
  ): Promise<StopExtractionResponse>;
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
  onCooldownAcknowledged: (cooldown: CooldownState) => void;
  onHeaterAcknowledged: (settings: HeaterSettingsResponse) => void;
  onExtractionAcknowledged: (extraction: ExtractionState) => void;
  onModeAcknowledged: (mode: Mode) => void;
  onMutationChange: (
    kind: DashboardMutationKind,
    state: DashboardMutationState,
  ) => void;
  onOverTemperatureDismissed: (snapshot: MachineState) => void;
  onProfilesAcknowledged: (profiles: ProfileSet) => void;
  onTemperatureSettingsAcknowledged: (
    settings: TemperatureSettingsResponse,
  ) => void;
  polling: DashboardPollingControl;
  startKeyFactory?: () => string;
  cooldownStartKeyFactory?: () => string;
}

export class DashboardMutationSession {
  private readonly client: DashboardMutationClient;
  private readonly onCooldownAcknowledged: (cooldown: CooldownState) => void;
  private readonly onConnectionLost: (connection: ConnectionState) => void;
  private readonly onHeaterAcknowledged: (settings: HeaterSettingsResponse) => void;
  private readonly onExtractionAcknowledged: (extraction: ExtractionState) => void;
  private readonly onModeAcknowledged: (mode: Mode) => void;
  private readonly onMutationChange: DashboardMutationSessionOptions["onMutationChange"];
  private readonly onOverTemperatureDismissed: DashboardMutationSessionOptions["onOverTemperatureDismissed"];
  private readonly onProfilesAcknowledged: (profiles: ProfileSet) => void;
  private readonly onTemperatureSettingsAcknowledged: DashboardMutationSessionOptions["onTemperatureSettingsAcknowledged"];
  private readonly polling: DashboardPollingControl;
  private readonly startKeyFactory: () => string;
  private readonly cooldownStartKeyFactory: () => string;

  private activeController: AbortController | null = null;
  private activeKind: DashboardMutationKind | null = null;
  private generation = 0;
  private paused = false;
  private pending = false;
  private running = false;
  private pendingStart: StartExtractionRequest | null = null;
  private pendingCooldownStartKey: string | null = null;

  constructor(options: DashboardMutationSessionOptions) {
    this.client = options.client;
    this.onCooldownAcknowledged = options.onCooldownAcknowledged;
    this.onConnectionLost = options.onConnectionLost;
    this.onHeaterAcknowledged = options.onHeaterAcknowledged;
    this.onExtractionAcknowledged = options.onExtractionAcknowledged;
    this.onModeAcknowledged = options.onModeAcknowledged;
    this.onMutationChange = options.onMutationChange;
    this.onOverTemperatureDismissed = options.onOverTemperatureDismissed;
    this.onProfilesAcknowledged = options.onProfilesAcknowledged;
    this.onTemperatureSettingsAcknowledged =
      options.onTemperatureSettingsAcknowledged;
    this.polling = options.polling;
    this.startKeyFactory = options.startKeyFactory ?? createStartKey;
    this.cooldownStartKeyFactory =
      options.cooldownStartKeyFactory ?? createCooldownStartKey;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.paused = false;
    for (const kind of mutationKinds) {
      this.onMutationChange(kind, idleMutationState);
    }
  }

  pause(): void {
    if (!this.running || this.paused) {
      return;
    }

    this.paused = true;
    this.generation += 1;
    this.activeController?.abort();
    this.activeController = null;
    if (this.pending && this.activeKind !== null) {
      this.onMutationChange(this.activeKind, {
        message: translate("mutation.backgrounded"),
        status: "disconnected",
      });
    }
    this.pending = false;
    this.activeKind = null;
  }

  resume(): void {
    if (!this.running || !this.paused) {
      return;
    }

    this.paused = false;
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    this.pending = false;
    this.generation += 1;
    this.activeController?.abort();
    this.activeController = null;
    this.activeKind = null;
  }

  handleDeviceRestart(): void {
    this.pendingStart = null;
    this.pendingCooldownStartKey = null;
  }

  setMode(mode: Mode): void {
    void this.perform(
      "mode",
      (signal) => this.client.setMode({ mode }, { signal }),
      (response) => {
        this.onModeAcknowledged(response.mode);
        return translate("mutation.modeAcknowledged", {
          mode: localizedMode(response.mode),
        });
      },
      translate("mutation.modePending", { mode: localizedMode(mode) }),
    );
  }

  setHeaterEnabled(heaterEnabled: boolean): void {
    void this.perform(
      "heater",
      (signal) => this.client.setHeaterEnabled({ heaterEnabled }, { signal }),
      (response) => {
        this.onHeaterAcknowledged(response);
        return response.heaterEnabled
          ? translate("mutation.heaterAllowed")
          : translate("mutation.heaterOff");
      },
      heaterEnabled
        ? translate("mutation.heaterAllowPending")
        : translate("mutation.heaterOffPending"),
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
        return translate("mutation.targetsSaved", {
          brew: response.brewTargetC,
          steam: response.steamTargetC,
        });
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
        return translate("mutation.faultDismissed");
      },
      translate("mutation.faultPending"),
    );
  }

  replaceProfiles(profiles: ProfileSet): void {
    void this.perform(
      "profiles",
      (signal) => this.client.replaceProfiles(profiles, { signal }),
      (response) => {
        this.onProfilesAcknowledged(response);
        return translate("mutation.profilesExported");
      },
      translate("mutation.profilesExportPending"),
    );
  }

  startExtraction(
    selection: ExtractionSelection,
    weightControl?: WeightControl,
  ): void {
    const candidate: StartExtractionRequest =
      weightControl === undefined
        ? { idempotencyKey: "", selection }
        : { idempotencyKey: "", selection, weightControl };
    if (
      this.pendingStart === null ||
      !sameExtractionRequest(this.pendingStart, candidate)
    ) {
      this.pendingStart = {
        idempotencyKey: this.startKeyFactory(),
        selection,
        ...(weightControl === undefined ? {} : { weightControl }),
      };
    }
    const request = this.pendingStart;
    void this.perform(
      "extraction-start",
      (signal) => this.client.startExtraction(request, { signal }),
      (response) => {
        this.pendingStart = null;
        this.onExtractionAcknowledged(response);
        return translate("mutation.extractionStarted");
      },
      translate(
        weightControl === undefined
          ? "mutation.extractionStartPending"
          : "mutation.weightedExtractionStartPending",
      ),
      (error) => {
        if (
          error instanceof ApiClientError &&
          (error.kind === "http" || error.kind === "invalid-request")
        ) {
          this.pendingStart = null;
        }
      },
    );
  }

  stopExtraction(): void {
    void this.perform(
      "extraction-stop",
      (signal) => this.client.stopExtraction({ signal }),
      (response) => {
        this.pendingStart = null;
        this.onExtractionAcknowledged(response);
        return translate("mutation.extractionStopped");
      },
      translate("mutation.extractionStopPending"),
    );
  }

  startCooldown(): void {
    this.pendingCooldownStartKey ??= this.cooldownStartKeyFactory();
    const idempotencyKey = this.pendingCooldownStartKey;
    void this.perform(
      "cooldown-start",
      (signal) => this.client.startCooldown({ idempotencyKey }, { signal }),
      (response) => {
        this.pendingCooldownStartKey = null;
        this.onCooldownAcknowledged(response);
        return translate("mutation.cooldownStarted");
      },
      translate("mutation.cooldownStartPending"),
      (error) => {
        if (
          error instanceof ApiClientError &&
          (error.kind === "http" || error.kind === "invalid-request")
        ) {
          this.pendingCooldownStartKey = null;
        }
      },
    );
  }

  stopCooldown(): void {
    void this.perform(
      "cooldown-stop",
      (signal) => this.client.stopCooldown({ signal }),
      (response) => {
        this.pendingCooldownStartKey = null;
        this.onCooldownAcknowledged(response);
        return translate(
          response.status === "stabilizing"
            ? "mutation.cooldownStopped"
            : "mutation.cooldownStopAcknowledged",
        );
      },
      translate("mutation.cooldownStopPending"),
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
    onFailure?: (error: unknown) => void,
  ): Promise<void> {
    if (!this.running || this.paused || this.pending) {
      return;
    }

    this.pending = true;
    this.activeKind = kind;
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
      onFailure?.(error);
      this.onMutationChange(kind, outcome.state);
      if (outcome.connection !== null) {
        this.onConnectionLost(outcome.connection);
      }
    } finally {
      if (this.isCurrent(generation)) {
        this.pending = false;
        this.activeController = null;
        this.activeKind = null;
        this.polling.resume();
      }
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.paused && this.running && this.generation === generation;
  }
}

function createStartKey(): string {
  const random = Math.random()
    .toString(36)
    .slice(2)
    .padEnd(12, "0")
    .slice(0, 12);
  return `start-${Date.now().toString(36)}-${random}`;
}

function createCooldownStartKey(): string {
  return createStartKey().replace(/^start-/, "cooldown-");
}

function sameExtractionSelection(
  left: ExtractionSelection,
  right: ExtractionSelection,
): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === "manual" ||
      (right.kind === "profile" && left.profileId === right.profileId))
  );
}

function sameExtractionRequest(
  left: StartExtractionRequest,
  right: StartExtractionRequest,
): boolean {
  return (
    sameExtractionSelection(left.selection, right.selection) &&
    JSON.stringify("weightControl" in left ? left.weightControl : null) ===
      JSON.stringify("weightControl" in right ? right.weightControl : null)
  );
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
        message: localizedRejectionMessage(error.response?.error.code),
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

function localizedRejectionMessage(
  code: ApiV2ErrorCode | ErrorCode | undefined,
): string {
  switch (code) {
    case "brew_mode_required":
      return translate("mutation.rejections.brewModeRequired");
    case "cooldown_active":
      return translate("mutation.rejections.cooldownActive");
    case "cooldown_not_required":
      return translate("mutation.rejections.cooldownNotRequired");
    case "extraction_active":
      return translate("mutation.rejections.extractionActive");
    case "internal_error":
      return translate("mutation.rejections.internalError");
    case "idempotency_mismatch":
      return translate("mutation.rejections.idempotencyMismatch");
    case "machine_faulted":
      return translate("mutation.rejections.machineFaulted");
    case "malformed_request":
      return translate("mutation.rejections.malformedRequest");
    case "persistence_failure":
      return translate("mutation.rejections.persistenceFailure");
    case "profile_not_configured":
      return translate("mutation.rejections.profileNotConfigured");
    case "scale_not_calibrated":
      return translate("mutation.rejections.scaleNotCalibrated");
    case "scale_not_stable":
      return translate("mutation.rejections.scaleNotStable");
    case "scale_unavailable":
      return translate("mutation.rejections.scaleUnavailable");
    case "scale_warning_unacknowledged":
      return translate("mutation.rejections.scaleWarningUnacknowledged");
    case "calibration_in_progress":
      return translate("mutation.rejections.calibrationInProgress");
    case "sensor_unavailable":
      return translate("mutation.rejections.sensorUnavailable");
    case "temperature_out_of_range":
      return translate("mutation.rejections.temperatureOutOfRange");
    case "unauthorized":
      return translate("mutation.rejections.unauthorized");
    case undefined:
      return translate("mutation.rejected");
  }
}

function disconnectedMutationMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.kind) {
      case "timeout":
        return translate("mutation.timeout");
      case "unauthorized":
        return translate("mutation.unauthorized");
      case "protocol":
        return translate("mutation.protocol");
      case "not-found":
      case "offline":
        return translate("mutation.offline");
      case "cancelled":
        return translate("mutation.cancelled");
      case "http":
      case "invalid-request":
        break;
    }
  }
  return translate("mutation.generic");
}

function localizedMode(mode: Mode): string {
  return translate(mode === "brew" ? "viewModel.mode.brew" : "viewModel.mode.steam");
}

function pendingTemperatureMessage(
  settings: TemperatureSettingsRequest,
): string {
  const targets = [
    settings.brewTargetC === undefined
      ? null
      : translate("mutation.brewTarget", { value: settings.brewTargetC }),
    settings.steamTargetC === undefined
      ? null
      : translate("mutation.steamTarget", { value: settings.steamTargetC }),
  ].filter((target): target is string => target !== null);
  return translate("mutation.targetsPending", {
    targets: targets.join(translate("mutation.and")),
  });
}
