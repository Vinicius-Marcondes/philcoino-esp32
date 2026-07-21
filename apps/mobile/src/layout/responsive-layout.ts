export type MobileLayoutMode = "landscape" | "portrait";

export interface WindowSize {
  height: number;
  width: number;
}

export function mobileLayoutMode({
  height,
  width,
}: WindowSize): MobileLayoutMode {
  return width > height ? "landscape" : "portrait";
}

export function isCompactLandscape(size: WindowSize): boolean {
  return mobileLayoutMode(size) === "landscape" && size.height < 390;
}
