import type {
  ApiErrorResponse as ProtocolApiErrorResponse,
} from "@philcoino/protocol";

export type ApiErrorResponse = ProtocolApiErrorResponse;

export type ApiClientErrorKind =
  | "cancelled"
  | "certificate-changed"
  | "http"
  | "invalid-request"
  | "not-found"
  | "offline"
  | "protocol"
  | "timeout"
  | "unauthorized";

export class ApiClientError extends Error {
  readonly endpoint?: string;
  readonly issuePaths?: readonly string[];
  readonly kind: ApiClientErrorKind;
  readonly response?: ApiErrorResponse;
  readonly status?: number;

  constructor(
    kind: ApiClientErrorKind,
    message: string,
    options: {
      endpoint?: string;
      issuePaths?: readonly string[];
      response?: ApiErrorResponse;
      status?: number;
    } = {},
  ) {
    super(message);
    this.name = "ApiClientError";
    this.endpoint = options.endpoint;
    this.issuePaths = options.issuePaths;
    this.kind = kind;
    this.response = options.response;
    this.status = options.status;
  }
}
