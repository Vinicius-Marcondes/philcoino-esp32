import type {
  MachineState,
  Mode,
  TemperatureSettingsRequest,
} from "@philcoino/protocol";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  DashboardMutationSession,
  idleMutationState,
  type DashboardMutationClient,
  type DashboardMutationKind,
  type DashboardMutationState,
} from "@/src/dashboard/dashboard-mutation-session";
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
  dismissMutation: (kind: DashboardMutationKind) => void;
  dismissOverTemperature: () => void;
  faultMutation: DashboardMutationState;
  heaterMutation: DashboardMutationState;
  modeMutation: DashboardMutationState;
  setMode: (mode: Mode) => void;
  setHeaterEnabled: (heaterEnabled: boolean) => void;
  snapshot: MachineState | null;
  temperatureMutation: DashboardMutationState;
  updateTemperatureSettings: (settings: TemperatureSettingsRequest) => void;
}

export function useMachineDashboard(
  client: DashboardStateClient & DashboardMutationClient,
): MachineDashboardState {
  const [connection, setConnection] = useState<ConnectionState>(connectingState);
  const [faultMutation, setFaultMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [heaterMutation, setHeaterMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [modeMutation, setModeMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [snapshot, setSnapshot] = useState<MachineState | null>(null);
  const [temperatureMutation, setTemperatureMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const mutationSession = useRef<DashboardMutationSession | null>(null);

  useFocusEffect(
    useCallback(() => {
      const polling = new DashboardPollingSession({
        client,
        onConnectionChange: setConnection,
        onSnapshotChange: setSnapshot,
      });
      const mutations = new DashboardMutationSession({
        client,
        onConnectionLost: (nextConnection) => {
          setSnapshot(null);
          setConnection(nextConnection);
        },
        onHeaterAcknowledged: (settings) => {
          setSnapshot((current) => {
            if (current === null) {
              return null;
            }
            if (current.status === "fault") {
              return {
                ...current,
                heaterActive: false,
                heaterEnabled: settings.heaterEnabled,
              };
            }
            return {
              ...current,
              heaterActive: settings.heaterEnabled
                ? current.heaterActive
                : false,
              heaterEnabled: settings.heaterEnabled,
            };
          });
        },
        onModeAcknowledged: (mode) => {
          setSnapshot((current) =>
            current === null
              ? null
              : {
                  ...current,
                  activeMode: mode,
                  steamTimeoutRemainingMs:
                    mode === "brew"
                      ? null
                      : current.steamTimeoutRemainingMs,
                },
          );
        },
        onMutationChange: (kind, state) => {
          if (kind === "mode") {
            setModeMutation(state);
          } else if (kind === "temperatures") {
            setTemperatureMutation(state);
          } else if (kind === "heater") {
            setHeaterMutation(state);
          } else {
            setFaultMutation(state);
          }
        },
        onOverTemperatureDismissed: setSnapshot,
        onTemperatureSettingsAcknowledged: (settings) => {
          setSnapshot((current) =>
            current === null ? null : { ...current, ...settings },
          );
        },
        polling,
      });
      mutationSession.current = mutations;

      const synchronizePolling = (appState: typeof AppState.currentState) => {
        if (appState === "active") {
          polling.start();
          mutations.start();
        } else {
          mutations.stop();
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
        mutations.stop();
        polling.stop();
        if (mutationSession.current === mutations) {
          mutationSession.current = null;
        }
      };
    }, [client]),
  );

  const setMode = useCallback((mode: Mode) => {
    mutationSession.current?.setMode(mode);
  }, []);

  const setHeaterEnabled = useCallback((heaterEnabled: boolean) => {
    mutationSession.current?.setHeaterEnabled(heaterEnabled);
  }, []);

  const dismissOverTemperature = useCallback(() => {
    mutationSession.current?.dismissOverTemperature();
  }, []);

  const dismissMutation = useCallback((kind: DashboardMutationKind) => {
    mutationSession.current?.dismissMutation(kind);
  }, []);

  const updateTemperatureSettings = useCallback(
    (settings: TemperatureSettingsRequest) => {
      mutationSession.current?.updateTemperatureSettings(settings);
    },
    [],
  );

  return {
    connection,
    dismissMutation,
    dismissOverTemperature,
    faultMutation,
    heaterMutation,
    modeMutation,
    setHeaterEnabled,
    setMode,
    snapshot,
    temperatureMutation,
    updateTemperatureSettings,
  };
}
