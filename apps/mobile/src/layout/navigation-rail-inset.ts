export type LandscapeDirection = "left" | "right" | null;

export function navigationRailLeadingInset(
  direction: LandscapeDirection,
  safeAreaLeft: number,
): number {
  const safeInset = Math.max(0, safeAreaLeft);

  if (direction === "left") {
    return 0;
  }

  return safeInset;
}
