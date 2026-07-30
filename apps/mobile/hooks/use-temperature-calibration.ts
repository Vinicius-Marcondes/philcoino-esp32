import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  idleTemperatureCalibrationSessionState,
  TemperatureCalibrationSession,
  type TemperatureCalibrationClient,
  type TemperatureCalibrationSessionState,
} from "@/src/dashboard/temperature-calibration-session";
import type { ConnectionState } from "@/src/networking/connection-state";

interface UseTemperatureCalibrationOptions {
  active: boolean;
  client: TemperatureCalibrationClient;
  onConnectionLost?: (connection: ConnectionState) => void;
}

export interface TemperatureCalibrationController {
  cancel: () => Promise<void>;
  save: () => Promise<void>;
  start: () => Promise<void>;
  state: TemperatureCalibrationSessionState;
  updateCandidate: (candidateRawTargetC: number) => Promise<void>;
}

export function useTemperatureCalibration({
  active,
  client,
  onConnectionLost,
}: UseTemperatureCalibrationOptions): TemperatureCalibrationController {
  const [state, setState] =
    useState<TemperatureCalibrationSessionState>(
      idleTemperatureCalibrationSessionState,
    );
  const sessionRef = useRef<TemperatureCalibrationSession | null>(null);

  useEffect(() => {
    if (!active) {
      sessionRef.current = null;
      setState(idleTemperatureCalibrationSessionState);
      return;
    }

    const session = new TemperatureCalibrationSession({
      client,
      onConnectionLost,
      onStateChange: setState,
    });
    sessionRef.current = session;

    const synchronize = (appState: typeof AppState.currentState) => {
      if (appState === "active") {
        session.resume();
      } else {
        session.pause();
      }
    };
    synchronize(AppState.currentState);
    const subscription = AppState.addEventListener(
      "change",
      synchronize,
    );
    return () => {
      subscription.remove();
      session.stop();
      if (sessionRef.current === session) {
        sessionRef.current = null;
      }
    };
  }, [active, client, onConnectionLost]);

  const start = useCallback(
    () => sessionRef.current?.startCalibration() ?? Promise.resolve(),
    [],
  );
  const updateCandidate = useCallback(
    (candidateRawTargetC: number) =>
      sessionRef.current?.updateCandidate(candidateRawTargetC) ??
      Promise.resolve(),
    [],
  );
  const save = useCallback(
    () => sessionRef.current?.save() ?? Promise.resolve(),
    [],
  );
  const cancel = useCallback(
    () => sessionRef.current?.cancel() ?? Promise.resolve(),
    [],
  );

  return { cancel, save, start, state, updateCandidate };
}
