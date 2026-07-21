import { useKeepAwake } from "expo-keep-awake";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { shouldKeepScreenAwake } from "@/src/layout/keep-awake-policy";

export function PairedKeepAwake({ enabled }: { enabled: boolean }) {
  const [appState, setAppState] = useState(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);

  return shouldKeepScreenAwake(enabled, appState) ? (
    <KeepAwakeActivator />
  ) : null;
}

function KeepAwakeActivator() {
  useKeepAwake("philcoino-display-preference");
  return null;
}
