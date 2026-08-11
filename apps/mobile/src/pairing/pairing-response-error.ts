import { ApiClientError } from "../networking/api-client-error";
import { ApiErrorResponseSchema } from "@philcoino/protocol";

export function pairingResponseError(
  response: { body: string; status: number },
  endpoint: string,
): ApiClientError {
  let message = "The device rejected the pairing request.";
  let parsedResponse:
    | ReturnType<typeof ApiErrorResponseSchema.parse>
    | undefined;
  try {
    parsedResponse = ApiErrorResponseSchema.parse(
      JSON.parse(response.body) as unknown,
    );
    message = parsedResponse.error.message;
  } catch {
    // HTTP status remains authoritative when the peer sends malformed JSON.
  }

  const kind = response.status === 401
    ? "unauthorized"
    : response.status === 404
      ? "not-found"
      : "http";
  return new ApiClientError(kind, message, {
    endpoint,
    response: parsedResponse,
    status: response.status,
  });
}
