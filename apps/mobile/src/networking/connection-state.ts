import { ApiClientError } from "./api-client-error";

export type ConnectionStatus =
  | "connecting"
  | "not-found"
  | "offline"
  | "online"
  | "protocol-error"
  | "unauthorized";

export interface ConnectionState {
  protocol?: {
    endpoint?: string;
    issuePaths?: readonly string[];
    status?: number;
  };
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
    case "protocol": {
      const protocol = {
        endpoint: error.endpoint,
        issuePaths: error.issuePaths,
        status: error.status,
      };
      return protocol.endpoint === undefined &&
        protocol.issuePaths === undefined &&
        protocol.status === undefined
        ? { status: "protocol-error" }
        : { protocol, status: "protocol-error" };
    }
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
