import type {
  ApiV2ErrorResponse,
  ErrorResponse,
  ExtractionActiveConflictResponse,
} from "@philcoino/protocol";

export type ApiErrorResponse =
  | ApiV2ErrorResponse
  | ErrorResponse
  | ExtractionActiveConflictResponse;

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
  readonly response?: ApiErrorResponse;
  readonly status?: number;

  constructor(
    kind: ApiClientErrorKind,
    message: string,
    options: { response?: ApiErrorResponse; status?: number } = {},
  ) {
    super(message);
    this.name = "ApiClientError";
    this.kind = kind;
    this.response = options.response;
    this.status = options.status;
  }
}
