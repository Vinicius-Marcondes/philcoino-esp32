import { ApiClientError } from "./api-client-error";

const TIMEOUT_PATTERN = /(?:timed?\s*out|timeout|NSURLErrorDomain[^\n]*-1001)/iu;
const INVALID_REQUEST_PATTERN = /(?:invalidRequest|invalid request|ERR_INVALID_REQUEST)/iu;
const CERTIFICATE_CHANGED_PATTERN = /(?:certificate pin changed|server certificate pin changed|pinning|certificate-changed)/iu;

export function nativeTransportError(
  error: unknown,
  signal?: AbortSignal,
): ApiClientError {
  if (signal?.aborted) {
    return new ApiClientError("cancelled", "The native device request was cancelled.");
  }

  const details = errorDetails(error);
  if (CERTIFICATE_CHANGED_PATTERN.test(details)) {
    return new ApiClientError(
      "certificate-changed",
      "The saved certificate pin no longer matches this device.",
    );
  }
  if (INVALID_REQUEST_PATTERN.test(details)) {
    return new ApiClientError(
      "invalid-request",
      "The native secure transport rejected the request configuration.",
    );
  }
  if (TIMEOUT_PATTERN.test(details)) {
    return new ApiClientError(
      "timeout",
      "The native device request timed out.",
    );
  }
  return new ApiClientError(
    "offline",
    "The native secure transport could not reach the device.",
  );
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    const code = "code" in error ? String(error.code) : "";
    return `${error.name}\n${code}\n${error.message}`;
  }
  if (typeof error === "object" && error !== null) {
    const value = error as { code?: unknown; message?: unknown };
    return `${String(value.code ?? "")}\n${String(value.message ?? "")}`;
  }
  return String(error);
}
