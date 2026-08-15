import { describe, expect, it } from "bun:test";

import { pairingResponseError } from "../src/pairing/pairing-response-error";

describe("pairing HTTP errors", () => {
  it("retains bounded-session conflict status, code, and endpoint", () => {
    const error = pairingResponseError(
      {
        body: JSON.stringify({
          error: {
            code: "pairing_busy",
            message: "Two pairing sessions are already active.",
          },
        }),
        status: 409,
      },
      "/api/v4/pairing/sessions",
    );

    expect(error).toEqual(expect.objectContaining({
      endpoint: "/api/v4/pairing/sessions",
      kind: "http",
      message: "Two pairing sessions are already active.",
      response: { error: { code: "pairing_busy", message: "Two pairing sessions are already active." } },
      status: 409,
    }));
  });

  it("classifies a rejected completion proof as unauthorized", () => {
    const error = pairingResponseError(
      {
        body: JSON.stringify({
          error: {
            code: "unauthorized",
            message: "The pairing proof is invalid.",
          },
        }),
        status: 401,
      },
      "/api/v4/pairing/sessions/00000000000000000000000000000001/complete",
    );

    expect(error).toEqual(expect.objectContaining({
      endpoint: "/api/v4/pairing/sessions/00000000000000000000000000000001/complete",
      kind: "unauthorized",
      status: 401,
    }));
  });
});
