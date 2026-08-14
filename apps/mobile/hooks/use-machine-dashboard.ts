import type {
  CompensationState,
  CooldownState,
  ExtractionSelection,
  ExtractionState,
  MachineState,
  Mode,
  ScaleState,
  TemperatureSettingsRequest,
  WeightControl,
} from "@philcoino/protocol";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  DashboardAppLifecycle,
  type DashboardFreshness,
} from "@/src/dashboard/dashboard-app-lifecycle";
import {
  DashboardMutationSession,
  idleMutationState,
  type DashboardMutationClient,
  type DashboardMutationKind,
  type DashboardMutationState,
} from "@/src/dashboard/dashboard-mutation-session";
import type { ProfileSet } from "@/src/profiles/profile-set";
import {
  DashboardPollingSession,
  type DashboardStateClient,
} from "@/src/dashboard/dashboard-polling-session";
import {
  connectingState,
  type ConnectionState,
} from "@/src/networking/connection-state";
import { translate } from "@/src/localization/i18n";
import { MobileProfileSession } from "@/src/profiles/mobile-profile-session";
import type { MobileProfileRepository } from "@/src/storage/mobile-profile-repository";

export interface MachineDashboardState {
  connection: ConnectionState;
  compensation: CompensationState | null;
  cooldown: CooldownState | null;
  cooldownStartMutation: DashboardMutationState;
  cooldownStopMutation: DashboardMutationState;
  dismissMutation: (kind: DashboardMutationKind) => void;
  dismissOverTemperature: () => void;
  faultMutation: DashboardMutationState;
  extraction: ExtractionState | null;
  extractionStartMutation: DashboardMutationState;
  extractionStopMutation: DashboardMutationState;
  freshness: DashboardFreshness;
  heaterMutation: DashboardMutationState;
  modeMutation: DashboardMutationState;
  mobileProfiles: ProfileSet | null;
  profileStorageError: string | null;
  profileWritePending: boolean;
  saveMobileProfiles: (profiles: ProfileSet) => Promise<boolean>;
  scaleSnapshot: ScaleState | null;
  startExtraction: (
    selection: ExtractionSelection,
    weightControl?: WeightControl,
  ) => void;
  startCooldown: () => void;
  stopCooldown: () => void;
  stopExtraction: () => void;
  setMode: (mode: Mode) => void;
  setHeaterEnabled: (heaterEnabled: boolean) => void;
  snapshot: MachineState | null;
  snapshotRevision: number;
  temperatureMutation: DashboardMutationState;
  updateTemperatureSettings: (settings: TemperatureSettingsRequest) => void;
}

export function useMachineDashboard(
  client: DashboardStateClient & DashboardMutationClient,
  profileRepository: MobileProfileRepository,
): MachineDashboardState {
  const [connection, setConnection] = useState<ConnectionState>(connectingState);
  const [compensation, setCompensation] = useState<CompensationState | null>(null);
  const [cooldown, setCooldown] = useState<CooldownState | null>(null);
  const [cooldownStartMutation, setCooldownStartMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [cooldownStopMutation, setCooldownStopMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [faultMutation, setFaultMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [freshness, setFreshness] =
    useState<DashboardFreshness>("connecting");
  const [heaterMutation, setHeaterMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [modeMutation, setModeMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [snapshot, setSnapshot] = useState<MachineState | null>(null);
  const [scaleSnapshot, setScaleSnapshot] = useState<ScaleState | null>(null);
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  const [extraction, setExtraction] = useState<ExtractionState | null>(null);
  const [extractionStartMutation, setExtractionStartMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [extractionStopMutation, setExtractionStopMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [mobileProfiles, setMobileProfiles] = useState<ProfileSet | null>(null);
  const [profileStorageError, setProfileStorageError] = useState<string | null>(
    null,
  );
  const [profileWritePending, setProfileWritePending] = useState(false);
  const [temperatureMutation, setTemperatureMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const mutationSession = useRef<DashboardMutationSession | null>(null);
  const profileSession = useRef<MobileProfileSession | null>(null);

  useFocusEffect(
    useCallback(() => {
      let lifecycle: DashboardAppLifecycle | null = null;
      let profiles: MobileProfileSession | null = null;
      const polling = new DashboardPollingSession({
        client,
        onDeviceRestart: () => mutationSession.current?.handleDeviceRestart(),
        onConnectionChange: (nextConnection) => {
          setConnection(nextConnection);
          if (nextConnection.status === "online") {
            lifecycle?.handleFreshSnapshot();
          }
        },
        onSnapshotChange: (nextSnapshot) => {
          setSnapshot(nextSnapshot?.machine ?? null);
          setScaleSnapshot(nextSnapshot?.scale ?? null);
          setExtraction(nextSnapshot?.extraction ?? null);
          setCompensation(nextSnapshot?.compensation ?? null);
          setCooldown(nextSnapshot?.cooldown ?? null);
          if (nextSnapshot !== null) {
            setSnapshotRevision((current) => current + 1);
          }
        },
      });
      const mutations = new DashboardMutationSession({
        client,
        onCooldownAcknowledged: (nextCooldown) => {
          setCooldown(nextCooldown);
          if (nextCooldown.status !== "idle") {
            setSnapshot((current) =>
              current === null
                ? null
                : {
                    ...current,
                    activeMode: "brew",
                    heaterActive: false,
                    steamTimeoutRemainingMs: null,
                  },
            );
            setCompensation({
              status: "inactive",
              phase: null,
            });
          }
        },
        onConnectionLost: (nextConnection) => {
          setSnapshot(null);
          setScaleSnapshot(null);
          setExtraction(null);
          setCompensation(null);
          setCooldown(null);
          setConnection(nextConnection);
        },
        onExtractionAcknowledged: setExtraction,
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
          if (kind === "cooldown-start") {
            setCooldownStartMutation(state);
          } else if (kind === "cooldown-stop") {
            setCooldownStopMutation(state);
          } else if (kind === "extraction-start") {
            setExtractionStartMutation(state);
          } else if (kind === "extraction-stop") {
            setExtractionStopMutation(state);
          } else if (kind === "mode") {
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
      lifecycle = new DashboardAppLifecycle({
        mutations,
        onFreshnessChange: setFreshness,
        polling,
      });
      mutationSession.current = mutations;
      profiles = new MobileProfileSession({
        onLocalErrorChange: (failed) =>
          setProfileStorageError(
            failed
              ? translate("extractionPreview.localProfileLoadError")
              : null,
          ),
        onMobileProfilesChange: setMobileProfiles,
        onWritePendingChange: setProfileWritePending,
        repository: profileRepository,
      });
      profileSession.current = profiles;
      profiles.start();

      const synchronizePolling = (appState: typeof AppState.currentState) => {
        lifecycle?.synchronize(appState);
      };

      synchronizePolling(AppState.currentState);
      const subscription = AppState.addEventListener(
        "change",
        synchronizePolling,
      );

      return () => {
        subscription.remove();
        profiles?.stop();
        if (profileSession.current === profiles) {
          profileSession.current = null;
        }
        lifecycle?.stop();
        lifecycle = null;
        if (mutationSession.current === mutations) {
          mutationSession.current = null;
        }
      };
    }, [client, profileRepository]),
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

  const saveMobileProfiles = useCallback(
    (profiles: ProfileSet) => {
      return (
        profileSession.current?.saveLocalProfiles(profiles) ??
        Promise.resolve(false)
      );
    },
    [],
  );

  const startExtraction = useCallback(
    (selection: ExtractionSelection, weightControl?: WeightControl) => {
      mutationSession.current?.startExtraction(selection, weightControl);
    },
    [],
  );

  const stopExtraction = useCallback(() => {
    mutationSession.current?.stopExtraction();
  }, []);

  const startCooldown = useCallback(() => {
    mutationSession.current?.startCooldown();
  }, []);

  const stopCooldown = useCallback(() => {
    mutationSession.current?.stopCooldown();
  }, []);

  return {
    connection,
    compensation,
    cooldown,
    cooldownStartMutation,
    cooldownStopMutation,
    dismissMutation,
    dismissOverTemperature,
    faultMutation,
    extraction,
    extractionStartMutation,
    extractionStopMutation,
    freshness,
    heaterMutation,
    modeMutation,
    mobileProfiles,
    profileStorageError,
    profileWritePending,
    saveMobileProfiles,
    scaleSnapshot,
    startExtraction,
    startCooldown,
    stopExtraction,
    stopCooldown,
    setHeaterEnabled,
    setMode,
    snapshot,
    snapshotRevision,
    temperatureMutation,
    updateTemperatureSettings,
  };
}
