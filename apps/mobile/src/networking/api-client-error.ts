import type { ErrorResponse } from "@philcoino/protocol";

export type ApiClientErrorKind =
  | "cancelled"
  | "http"
  | "invalid-request"
  | "not-found"
  | "offline"
  | "protocol"
  | "timeout"
  | "unauthorized";

export class ApiClientError extends Error {
  readonly kind: ApiClientErrorKind;
  readonly response?: ErrorResponse;
  readonly status?: number;

  constructor(
    kind: ApiClientErrorKind,
    message: string,
    options: { response?: ErrorResponse; status?: number } = {},
  ) {
    super(message);
    this.name = "ApiClientError";
    this.kind = kind;
    this.response = options.response;
    this.status = options.status;
  }
}
