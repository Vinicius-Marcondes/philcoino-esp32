import { ApiClientError } from "../networking/api-client-error";
import type { PairingStage } from "./pairing-service";

type PairingLogEvent = "failure" | "start" | "success";

type PairingLogDetails = {
  apiCode?: string;
  errorCode?: string;
  errorName?: string;
  httpStatus?: number;
  operation?: string;
  state?: string;
  transportKind?: string;
};

export type PairingLogEntry = PairingLogDetails & {
  event: PairingLogEvent;
  sequence: number;
  stage: PairingStage;
};

const maximumEntries = 20;
const entries: PairingLogEntry[] = [];
const listeners = new Set<(snapshot: readonly PairingLogEntry[]) => void>();
let sequence = 0;

export function pairingLog(
  stage: PairingStage,
  event: PairingLogEvent,
  details: PairingLogDetails = {},
): void {
  const entry: PairingLogEntry = {
    event,
    sequence: ++sequence,
    stage,
    ...details,
  };
  entries.push(entry);
  if (entries.length > maximumEntries) entries.shift();
  // warn is intentionally used for every entry because Metro, Xcode, and the
  // React Native simulator consistently surface this level.
  console.warn("[Philcoino pairing]", entry);
  const snapshot = [...entries];
  listeners.forEach((listener) => listener(snapshot));
}

export function pairingLogSnapshot(): readonly PairingLogEntry[] {
  return [...entries];
}

export function subscribePairingLog(
  listener: (snapshot: readonly PairingLogEntry[]) => void,
): () => void {
  listeners.add(listener);
  listener(pairingLogSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function safePairingErrorDetails(error: unknown): PairingLogDetails {
  if (error instanceof ApiClientError) {
    return {
      apiCode: error.response?.error.code,
      errorName: error.name,
      httpStatus: error.status,
      transportKind: error.kind,
    };
  }
  if (typeof error === "object" && error !== null) {
    const value = error as { code?: unknown; name?: unknown };
    return {
      ...(typeof value.code === "string" ? { errorCode: value.code } : {}),
      ...(typeof value.name === "string" ? { errorName: value.name } : {}),
    };
  }
  return { errorName: typeof error };
}
