import { describe, expect, it } from "bun:test";

import { nativeTransportError } from "../src/networking/native-transport-error";

describe("native transport error classification", () => {
  it("preserves cancellation as the first cause", () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      nativeTransportError(new Error("NSURLErrorDomain error -1001"), controller.signal),
    ).toEqual(expect.objectContaining({ kind: "cancelled" }));
  });

  it("classifies native URLSession timeouts", () => {
    expect(
      nativeTransportError(new Error("NSURLErrorDomain error -1001")),
    ).toEqual(expect.objectContaining({ kind: "timeout" }));
  });

  it("classifies other native connection failures as offline", () => {
    expect(
      nativeTransportError(new Error("The network connection was lost.")),
    ).toEqual(expect.objectContaining({ kind: "offline" }));
  });

  it("does not disguise native request construction defects as connectivity", () => {
    expect(
      nativeTransportError(new Error("TransportError.invalidRequest")),
    ).toEqual(expect.objectContaining({ kind: "invalid-request" }));
  });
});
