import type {
  FaultCode,
  MachineState,
  MachineStatus,
  Mode,
} from "@philcoino/protocol";

import type {
  ConnectionState,
  ConnectionStatus,
} from "../networking/connection-state";
import { currentLocale, translate } from "../localization/i18n";

const CONNECTION_COPY_KEYS: Record<
  ConnectionStatus,
  { detail: string; label: string }
> = {
  connecting: {
    detail: "viewModel.connection.connecting.detail",
    label: "viewModel.connection.connecting.label",
  },
  "not-found": {
    detail: "viewModel.connection.notFound.detail",
    label: "viewModel.connection.notFound.label",
  },
  offline: {
    detail: "viewModel.connection.offline.detail",
    label: "viewModel.connection.offline.label",
  },
  online: {
    detail: "viewModel.connection.online.detail",
    label: "viewModel.connection.online.label",
  },
  "protocol-error": {
    detail: "viewModel.connection.protocol.detail",
    label: "viewModel.connection.protocol.label",
  },
  unauthorized: {
    detail: "viewModel.connection.unauthorized.detail",
    label: "viewModel.connection.unauthorized.label",
  },
};

const STATUS_LABEL_KEYS: Record<MachineStatus, string> = {
  fault: "viewModel.status.fault",
  heating: "viewModel.status.heating",
  ready: "viewModel.status.ready",
};

const MODE_LABEL_KEYS: Record<Mode, string> = {
  brew: "viewModel.mode.brew",
  steam: "viewModel.mode.steam",
};

const FAULT_LABEL_KEYS: Record<FaultCode, string> = {
  heating_timeout: "viewModel.fault.heatingTimeout",
  internal_error: "viewModel.fault.internalError",
  over_temperature: "viewModel.fault.overTemperature",
  sensor_failure: "viewModel.fault.sensorFailure",
};

export const TEMPERATURE_HISTORY_LIMIT = 180;

export interface TemperatureSample {
  activeMode: Mode;
  brewTargetC: number;
  boilerTemperatureC: number;
  heaterActive: boolean;
  steamTargetC: number;
  uptimeMs: number;
}

export function connectionCopy(connection: ConnectionState) {
  const keys = CONNECTION_COPY_KEYS[connection.status];
  return { detail: translate(keys.detail), label: translate(keys.label) };
}

export function machineStatusLabel(status: MachineStatus): string {
  return translate(STATUS_LABEL_KEYS[status]);
}

export function machineActivityLabel(snapshot: MachineState): string {
  if (snapshot.status !== "heating") {
    return machineStatusLabel(snapshot.status);
  }
  if (snapshot.heaterActive) {
    return translate("viewModel.status.heating");
  }

  return boilerTemperatureC(snapshot) > boilerTargetC(snapshot) + 1
    ? translate("viewModel.status.cooling")
    : translate("viewModel.status.stabilizing");
}

export function modeLabel(mode: Mode): string {
  return translate(MODE_LABEL_KEYS[mode]);
}

export function faultLabel(code: FaultCode): string {
  return translate(FAULT_LABEL_KEYS[code]);
}

export function formatTemperature(temperatureC: number): string {
  return `${new Intl.NumberFormat(currentLocale(), {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(temperatureC)}°`;
}

export function formatTarget(targetC: number): string {
  return `${targetC}°C`;
}

export function formatSteamCountdown(
  remainingMs: MachineState["steamTimeoutRemainingMs"],
): string {
  if (remainingMs === null) {
    return translate("viewModel.notRunning");
  }

  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function steamCountdownContext(snapshot: MachineState): string {
  if (snapshot.steamTimeoutRemainingMs !== null) {
    return translate("viewModel.returnsToBrew");
  }
  if (snapshot.activeMode === "steam") {
    return translate("viewModel.startsWhenReady");
  }
  return translate("viewModel.availableInSteam");
}

export function boilerTemperatureC(
  sample: MachineState | TemperatureSample,
): number {
  return sample.boilerTemperatureC;
}

export function boilerTargetC(sample: MachineState | TemperatureSample): number {
  return sample.activeMode === "brew" ? sample.brewTargetC : sample.steamTargetC;
}

export function appendTemperatureSample(
  history: TemperatureSample[],
  snapshot: MachineState,
  limit = TEMPERATURE_HISTORY_LIMIT,
): TemperatureSample[] {
  const sample: TemperatureSample = {
    activeMode: snapshot.activeMode,
    brewTargetC: snapshot.brewTargetC,
    boilerTemperatureC: snapshot.boilerTemperatureC,
    heaterActive: snapshot.heaterActive,
    steamTargetC: snapshot.steamTargetC,
    uptimeMs: snapshot.uptimeMs,
  };
  const previous = history.at(-1);
  if (previous?.uptimeMs === sample.uptimeMs) {
    return [...history.slice(0, -1), sample];
  }
  if (previous !== undefined && sample.uptimeMs < previous.uptimeMs) {
    return [sample];
  }

  return [...history, sample].slice(-limit);
}

export function formatHistoryDuration(history: TemperatureSample[]): string {
  if (history.length < 2) {
    return translate("viewModel.collecting");
  }
  const durationMs = history[history.length - 1].uptimeMs - history[0].uptimeMs;
  const seconds = Math.max(0, Math.round(durationMs / 1_000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatUptime(uptimeMs: number): string {
  const totalSeconds = Math.floor(uptimeMs / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${totalSeconds}s`;
}
