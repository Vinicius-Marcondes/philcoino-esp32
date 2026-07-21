import { describe, expect, test } from "bun:test";

import { navigationRailLeadingInset } from "../src/layout/navigation-rail-inset";

describe("landscape navigation rail inset", () => {
  test("keeps the left rail close to the edge in landscape-left", () => {
    expect(navigationRailLeadingInset("left", 59)).toBe(0);
  });

  test("keeps the notch-safe inset in landscape-right and while unknown", () => {
    expect(navigationRailLeadingInset("right", 59)).toBe(59);
    expect(navigationRailLeadingInset(null, 59)).toBe(59);
  });

  test("never produces a negative fallback inset", () => {
    expect(navigationRailLeadingInset("right", -1)).toBe(0);
  });
});
