import type { AppStateStatus } from "react-native";

export function shouldKeepScreenAwake(
  enabled: boolean,
  appState: AppStateStatus,
): boolean {
  return enabled && appState === "active";
}
