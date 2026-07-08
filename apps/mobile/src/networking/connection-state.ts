import { ApiClientError } from "./api-client-error";

export type ConnectionStatus =
  | "connecting"
  | "not-found"
  | "offline"
  | "online"
  | "protocol-error"
  | "unauthorized";

export interface ConnectionState {
  status: ConnectionStatus;
}

export const connectingState: ConnectionState = { status: "connecting" };
export const onlineState: ConnectionState = { status: "online" };

export function connectionStateFromError(
  error: unknown,
): ConnectionState | null {
  if (!(error instanceof ApiClientError)) {
    return { status: "offline" };
  }

  switch (error.kind) {
    case "cancelled":
      return null;
    case "not-found":
      return { status: "not-found" };
    case "protocol":
    case "invalid-request":
      return { status: "protocol-error" };
    case "unauthorized":
      return { status: "unauthorized" };
    case "http":
    case "offline":
    case "timeout":
      return { status: "offline" };
  }
}
