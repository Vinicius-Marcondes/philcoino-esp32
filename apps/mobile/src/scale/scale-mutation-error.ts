import { translate } from "@/src/localization/i18n";
import { ApiClientError } from "@/src/networking/api-client-error";

export function scaleMutationErrorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) {
    return translate("mutation.generic");
  }

  const response = error.response;
  const code =
    response !== undefined && "error" in response
      ? response.error.code
      : undefined;
  switch (code) {
    case "calibration_in_progress":
      return translate("mutation.rejections.calibrationInProgress");
    case "extraction_active":
      return translate("mutation.rejections.extractionActive");
    case "malformed_request":
      return translate("mutation.rejections.malformedRequest");
    case "persistence_failure":
      return translate("mutation.rejections.persistenceFailure");
    case "scale_not_stable":
      return translate("mutation.rejections.scaleNotStable");
    case "scale_unavailable":
      return translate("mutation.rejections.scaleUnavailable");
    case "unauthorized":
      return translate("mutation.rejections.unauthorized");
  }

  switch (error.kind) {
    case "cancelled":
      return translate("mutation.cancelled");
    case "offline":
    case "not-found":
      return translate("mutation.offline");
    case "protocol":
      return translate("mutation.protocol");
    case "timeout":
      return translate("mutation.timeout");
    case "unauthorized":
      return translate("mutation.unauthorized");
    case "http":
    case "invalid-request":
      return translate("mutation.generic");
  }
}
