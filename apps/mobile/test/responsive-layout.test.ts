import { describe, expect, test } from "bun:test";

import {
  isCompactLandscape,
  mobileLayoutMode,
} from "../src/layout/responsive-layout";

describe("responsive mobile layout", () => {
  test("classifies portrait, square, and both landscape directions", () => {
    expect(mobileLayoutMode({ height: 844, width: 390 })).toBe("portrait");
    expect(mobileLayoutMode({ height: 390, width: 844 })).toBe("landscape");
    expect(mobileLayoutMode({ height: 844, width: 390 })).toBe("portrait");
    expect(mobileLayoutMode({ height: 500, width: 500 })).toBe("portrait");
  });

  test("marks only short landscape viewports as compact", () => {
    expect(isCompactLandscape({ height: 375, width: 667 })).toBe(true);
    expect(isCompactLandscape({ height: 390, width: 844 })).toBe(false);
    expect(isCompactLandscape({ height: 667, width: 375 })).toBe(false);
  });
});
