import { describe, expect, test } from "bun:test";

import {
  dashboardPageAfterVerticalSwipe,
  dashboardPageTransitionDirection,
  shouldNavigateDashboardPageSwipe,
} from "../src/layout/dashboard-page-navigation";

describe("landscape dashboard page gestures", () => {
  test("derives transition direction from page order", () => {
    expect(dashboardPageTransitionDirection("dashboard", "profiles")).toBe(
      "forward",
    );
    expect(dashboardPageTransitionDirection("dashboard", "machine")).toBe(
      "forward",
    );
    expect(dashboardPageTransitionDirection("machine", "profiles")).toBe(
      "backward",
    );
  });

  test("moves forward on swipe up and backward on swipe down", () => {
    expect(dashboardPageAfterVerticalSwipe("dashboard", -40)).toBe("profiles");
    expect(dashboardPageAfterVerticalSwipe("profiles", -40)).toBe("machine");
    expect(dashboardPageAfterVerticalSwipe("machine", 40)).toBe("profiles");
    expect(dashboardPageAfterVerticalSwipe("profiles", 40)).toBe("dashboard");
  });

  test("ignores short gestures and clamps at the first and last page", () => {
    expect(dashboardPageAfterVerticalSwipe("profiles", 20)).toBe("profiles");
    expect(dashboardPageAfterVerticalSwipe("dashboard", 40)).toBe("dashboard");
    expect(dashboardPageAfterVerticalSwipe("machine", -40)).toBe("machine");
  });

  test("recognizes vertical page swipes anywhere when content fits", () => {
    expect(
      shouldNavigateDashboardPageSwipe({
        contentHeight: 380,
        deltaX: 4,
        deltaY: -48,
        offsetY: 0,
        viewportHeight: 400,
      }),
    ).toBe(true);
    expect(
      shouldNavigateDashboardPageSwipe({
        contentHeight: 380,
        deltaX: 48,
        deltaY: -40,
        offsetY: 0,
        viewportHeight: 400,
      }),
    ).toBe(false);
  });

  test("preserves scrolling until tall content reaches a swipe boundary", () => {
    const scrollablePage = {
      contentHeight: 800,
      deltaX: 2,
      viewportHeight: 400,
    };

    expect(
      shouldNavigateDashboardPageSwipe({
        ...scrollablePage,
        deltaY: -48,
        offsetY: 0,
      }),
    ).toBe(false);
    expect(
      shouldNavigateDashboardPageSwipe({
        ...scrollablePage,
        deltaY: -48,
        offsetY: 396,
      }),
    ).toBe(true);
    expect(
      shouldNavigateDashboardPageSwipe({
        ...scrollablePage,
        deltaY: 48,
        offsetY: 200,
      }),
    ).toBe(false);
    expect(
      shouldNavigateDashboardPageSwipe({
        ...scrollablePage,
        deltaY: 48,
        offsetY: 4,
      }),
    ).toBe(true);
  });
});
