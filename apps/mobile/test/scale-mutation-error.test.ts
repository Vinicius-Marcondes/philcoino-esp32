import { describe, expect, test } from "bun:test";

import { ApiClientError } from "../src/networking/api-client-error";
import { scaleMutationErrorMessage } from "../src/scale/scale-mutation-error";

describe("scale mutation errors", () => {
  test("shows the firmware scale rejection instead of a generic message", () => {
    const error = new ApiClientError("http", "rejected", {
      response: {
        error: {
          code: "scale_not_stable",
          message: "The scale must be stable before calibration.",
        },
      },
      status: 409,
    });

    expect(scaleMutationErrorMessage(error)).toContain("did not become stable");
  });

  test("distinguishes unavailable hardware from protocol and transport errors", () => {
    const unavailable = new ApiClientError("http", "rejected", {
      response: {
        error: {
          code: "scale_unavailable",
          message: "The scale is unavailable.",
        },
      },
      status: 409,
    });

    expect(scaleMutationErrorMessage(unavailable)).toContain("unavailable");
    expect(
      scaleMutationErrorMessage(new ApiClientError("protocol", "invalid")),
    ).toContain("API contract");
    expect(
      scaleMutationErrorMessage(new ApiClientError("offline", "offline")),
    ).toContain("Connection");
  });
});
