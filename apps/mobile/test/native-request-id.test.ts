import { describe, expect, it } from "bun:test";

import { createNativeRequestId } from "../src/networking/native-request-id";

describe("native request identifiers", () => {
  it("creates distinct process-local identifiers without browser crypto", () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    });

    try {
      const first = createNativeRequestId();
      const second = createNativeRequestId();

      expect(first).toMatch(/^native-[a-z0-9]+-[a-z0-9]+$/u);
      expect(second).toMatch(/^native-[a-z0-9]+-[a-z0-9]+$/u);
      expect(second).not.toBe(first);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: originalCrypto,
      });
    }
  });
});
