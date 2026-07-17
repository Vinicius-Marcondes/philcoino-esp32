import type {
  ApiV2ErrorResponse,
  CooldownActiveConflictResponse,
  ErrorResponse,
  ExtractionActiveConflictResponse,
} from "@philcoino/protocol";

export type ApiErrorResponse =
  | ApiV2ErrorResponse
  | ErrorResponse
  | CooldownActiveConflictResponse
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
