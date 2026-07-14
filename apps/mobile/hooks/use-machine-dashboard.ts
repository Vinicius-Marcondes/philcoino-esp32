import type {
  CompensationState,
  CooldownState,
  ExtractionSelection,
  ExtractionState,
  MachineState,
  Mode,
  TemperatureSettingsRequest,
  ProfileSet,
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
import { profileSetsEqual } from "@/src/profiles/profile-set";
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
  heaterMutation: DashboardMutationState;
  modeMutation: DashboardMutationState;
  machineProfiles: ProfileSet | null;
  mobileProfiles: ProfileSet | null;
  profileMutation: DashboardMutationState;
  profileStorageError: string | null;
  profilesSynchronized: boolean;
  exportProfiles: () => void;
  saveMobileProfiles: (profiles: ProfileSet) => Promise<boolean>;
  startExtraction: (selection: ExtractionSelection) => void;
  startCooldown: () => void;
  stopCooldown: () => void;
  stopExtraction: () => void;
  setMode: (mode: Mode) => void;
  setHeaterEnabled: (heaterEnabled: boolean) => void;
  snapshot: MachineState | null;
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
  const [heaterMutation, setHeaterMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [modeMutation, setModeMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [snapshot, setSnapshot] = useState<MachineState | null>(null);
  const [extraction, setExtraction] = useState<ExtractionState | null>(null);
  const [extractionStartMutation, setExtractionStartMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [extractionStopMutation, setExtractionStopMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [machineProfiles, setMachineProfiles] = useState<ProfileSet | null>(null);
  const [mobileProfiles, setMobileProfiles] = useState<ProfileSet | null>(null);
  const [profileMutation, setProfileMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const [profileStorageError, setProfileStorageError] = useState<string | null>(
    null,
  );
  const [temperatureMutation, setTemperatureMutation] =
    useState<DashboardMutationState>(idleMutationState);
  const mutationSession = useRef<DashboardMutationSession | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const profileController = new AbortController();
      const polling = new DashboardPollingSession({
        client,
        onConnectionChange: setConnection,
        onSnapshotChange: (nextSnapshot) => {
          setSnapshot(nextSnapshot?.machine ?? null);
          setExtraction(nextSnapshot?.extraction ?? null);
          setCompensation(nextSnapshot?.compensation ?? null);
          setCooldown(nextSnapshot?.cooldown ?? null);
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
          } else if (kind === "profiles") {
            setProfileMutation(state);
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
        onProfilesAcknowledged: setMachineProfiles,
        onTemperatureSettingsAcknowledged: (settings) => {
          setSnapshot((current) =>
            current === null ? null : { ...current, ...settings },
          );
        },
        polling,
      });
      mutationSession.current = mutations;

      void Promise.all([
        profileRepository.load(),
        client.getProfiles({ signal: profileController.signal }),
      ])
        .then(([localProfiles, persistedProfiles]) => {
          if (!active) {
            return;
          }
          setMobileProfiles(localProfiles);
          setMachineProfiles(persistedProfiles);
          setProfileStorageError(null);
        })
        .catch((error: unknown) => {
          if (!active || profileController.signal.aborted) {
            return;
          }
          setProfileStorageError(
            error instanceof Error
              ? error.message
              : "The profile sets could not be loaded.",
          );
        });

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
        active = false;
        profileController.abort();
        subscription.remove();
        mutations.stop();
        polling.stop();
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
    async (profiles: ProfileSet) => {
      try {
        await profileRepository.save(profiles);
        setMobileProfiles(profiles);
        setProfileStorageError(null);
        return true;
      } catch (error) {
        setProfileStorageError(
          error instanceof Error
            ? error.message
            : "The mobile profile set could not be saved.",
        );
        return false;
      }
    },
    [profileRepository],
  );

  const exportProfiles = useCallback(() => {
    if (mobileProfiles !== null) {
      mutationSession.current?.replaceProfiles(mobileProfiles);
    }
  }, [mobileProfiles]);

  const startExtraction = useCallback(
    (selection: ExtractionSelection) => {
      if (
        selection.kind === "profile" &&
        !profileSetsEqual(mobileProfiles, machineProfiles)
      ) {
        return;
      }
      mutationSession.current?.startExtraction(selection);
    },
    [machineProfiles, mobileProfiles],
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
    heaterMutation,
    modeMutation,
    machineProfiles,
    mobileProfiles,
    profileMutation,
    profileStorageError,
    profilesSynchronized: profileSetsEqual(mobileProfiles, machineProfiles),
    exportProfiles,
    saveMobileProfiles,
    startExtraction,
    startCooldown,
    stopExtraction,
    stopCooldown,
    setHeaterEnabled,
    setMode,
    snapshot,
    temperatureMutation,
    updateTemperatureSettings,
  };
}
