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

const CONNECTION_COPY: Record<
  ConnectionStatus,
  { detail: string; label: string }
> = {
  connecting: {
    detail: "Contacting the saved machine on your local network.",
    label: "Connecting",
  },
  "not-found": {
    detail: "No Philcoino API was found at the saved address.",
    label: "Machine not found",
  },
  offline: {
    detail: "Check machine power and that the iPhone is on the same Wi-Fi.",
    label: "Offline",
  },
  online: {
    detail: "Live data is updating once per second.",
    label: "Online",
  },
  "protocol-error": {
    detail: "The machine replied with data that does not match API v1.",
    label: "Protocol error",
  },
  unauthorized: {
    detail: "The saved bearer token was rejected by the machine.",
    label: "Authentication required",
  },
};

const STATUS_LABELS: Record<MachineStatus, string> = {
  fault: "Fault",
  heating: "Heating",
  ready: "Ready",
};

const MODE_LABELS: Record<Mode, string> = {
  brew: "Brew",
  steam: "Steam",
};

const FAULT_LABELS: Record<FaultCode, string> = {
  heating_timeout: "Heating timeout",
  internal_error: "Internal control error",
  over_temperature: "Over-temperature",
  sensor_failure: "Sensor failure",
};

export function connectionCopy(connection: ConnectionState) {
  return CONNECTION_COPY[connection.status];
}

export function machineStatusLabel(status: MachineStatus): string {
  return STATUS_LABELS[status];
}

export function modeLabel(mode: Mode): string {
  return MODE_LABELS[mode];
}

export function faultLabel(code: FaultCode): string {
  return FAULT_LABELS[code];
}

export function formatTemperature(temperatureC: number): string {
  return `${temperatureC.toFixed(1)}°`;
}

export function formatTarget(targetC: number): string {
  return `${targetC}°C`;
}

export function formatSteamCountdown(
  remainingMs: MachineState["steamTimeoutRemainingMs"],
): string {
  if (remainingMs === null) {
    return "Not running";
  }

  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function steamCountdownContext(snapshot: MachineState): string {
  if (snapshot.steamTimeoutRemainingMs !== null) {
    return "Returns to brew automatically";
  }
  if (snapshot.activeMode === "steam") {
    return "Starts after steam becomes ready";
  }
  return "Available in steam mode";
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
