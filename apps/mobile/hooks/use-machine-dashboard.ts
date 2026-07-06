import type { MachineState } from "@philcoino/protocol";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { AppState } from "react-native";

import {
  DashboardPollingSession,
  type DashboardStateClient,
} from "@/src/dashboard/dashboard-polling-session";
import {
  connectingState,
  type ConnectionState,
} from "@/src/networking/connection-state";

export interface MachineDashboardState {
  connection: ConnectionState;
  snapshot: MachineState | null;
}

export function useMachineDashboard(
  client: DashboardStateClient,
): MachineDashboardState {
  const [connection, setConnection] = useState<ConnectionState>(connectingState);
  const [snapshot, setSnapshot] = useState<MachineState | null>(null);

  useFocusEffect(
    useCallback(() => {
      const polling = new DashboardPollingSession({
        client,
        onConnectionChange: setConnection,
        onSnapshotChange: setSnapshot,
      });

      const synchronizePolling = (appState: typeof AppState.currentState) => {
        if (appState === "active") {
          polling.start();
        } else {
          polling.stop();
        }
      };

      synchronizePolling(AppState.currentState);
      const subscription = AppState.addEventListener(
        "change",
        synchronizePolling,
      );

      return () => {
        subscription.remove();
        polling.stop();
      };
    }, [client]),
  );

  return { connection, snapshot };
}
