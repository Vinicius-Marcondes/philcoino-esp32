import { describe, expect, test } from "bun:test";

import { shouldKeepScreenAwake } from "../src/layout/keep-awake-policy";

describe("paired keep-awake policy", () => {
  test("activates only for an enabled foreground paired screen", () => {
    expect(shouldKeepScreenAwake(true, "active")).toBe(true);
    expect(shouldKeepScreenAwake(false, "active")).toBe(false);
    expect(shouldKeepScreenAwake(true, "background")).toBe(false);
    expect(shouldKeepScreenAwake(true, "inactive")).toBe(false);
    expect(shouldKeepScreenAwake(true, "unknown")).toBe(false);
  });
});
