export const DASHBOARD_PAGES = [
  "dashboard",
  "profiles",
  "machine",
] as const;

export type DashboardPage = (typeof DASHBOARD_PAGES)[number];

export type DashboardPageTransitionDirection = "backward" | "forward";

export function dashboardPageTransitionDirection(
  current: DashboardPage,
  next: DashboardPage,
): DashboardPageTransitionDirection {
  return DASHBOARD_PAGES.indexOf(next) >= DASHBOARD_PAGES.indexOf(current)
    ? "forward"
    : "backward";
}

export function dashboardPageAfterVerticalSwipe(
  current: DashboardPage,
  deltaY: number,
  threshold = 32,
): DashboardPage {
  if (Math.abs(deltaY) < threshold) {
    return current;
  }

  const currentIndex = DASHBOARD_PAGES.indexOf(current);
  const nextIndex = deltaY < 0 ? currentIndex + 1 : currentIndex - 1;
  return DASHBOARD_PAGES[
    Math.max(0, Math.min(DASHBOARD_PAGES.length - 1, nextIndex))
  ];
}

export function shouldNavigateDashboardPageSwipe({
  contentHeight,
  deltaX,
  deltaY,
  offsetY,
  viewportHeight,
}: {
  contentHeight: number;
  deltaX: number;
  deltaY: number;
  offsetY: number;
  viewportHeight: number;
}): boolean {
  const swipeThreshold = 32;
  if (
    Math.abs(deltaY) < swipeThreshold ||
    Math.abs(deltaY) <= Math.abs(deltaX)
  ) {
    return false;
  }

  if (contentHeight <= 0 || viewportHeight <= 0) {
    return true;
  }

  const scrollRange = Math.max(0, contentHeight - viewportHeight);
  if (scrollRange <= swipeThreshold) {
    return true;
  }

  const boundaryTolerance = 8;
  return deltaY < 0
    ? offsetY >= scrollRange - boundaryTolerance
    : offsetY <= boundaryTolerance;
}
