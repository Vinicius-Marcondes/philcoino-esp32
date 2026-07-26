import type {
  ExtractionState,
  ProfileSlotId,
  ScaleState,
  WeightControl,
} from "@philcoino/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  shotSummaryFromTerminal,
  type WeightedShotSummary,
} from "@/src/history/shot-history";
import { shotHistoryExporter } from "@/src/history/shot-history-export";
import { shotHistoryRepository } from "@/src/history/shot-history-repository";
import {
  defaultScaleProfileDefaults,
  type ScaleProfileDefaults,
} from "@/src/scale/scale-preferences";
import { scalePreferencesRepository } from "@/src/scale/scale-preferences-repository";
import { scaleMutationErrorMessage } from "@/src/scale/scale-mutation-error";
import { ScalePollingSession } from "@/src/scale/scale-polling-session";

interface ScaleClient {
  acknowledgeScaleWarning(options?: { signal?: AbortSignal }): Promise<ScaleState>;
  cancelScaleCalibration(options?: { signal?: AbortSignal }): Promise<ScaleState>;
  completeScaleCalibration(
    request: { referenceWeightDecigrams: number },
    options?: { signal?: AbortSignal },
  ): Promise<ScaleState>;
  getScale(options?: { signal?: AbortSignal }): Promise<ScaleState>;
  startScaleCalibration(options?: { signal?: AbortSignal }): Promise<ScaleState>;
}

export type ScaleMutation =
  | "acknowledge"
  | "calibration-cancel"
  | "calibration-complete"
  | "calibration-start"
  | null;

export function useScale({
  client,
  deviceId,
  extraction,
  scalePageVisible,
}: {
  client: ScaleClient;
  deviceId: string;
  extraction: ExtractionState | null;
  scalePageVisible: boolean;
}) {
  const [scale, setScale] = useState<ScaleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mutation, setMutation] = useState<ScaleMutation>(null);
  const [defaults, setDefaults] = useState<ScaleProfileDefaults>(
    defaultScaleProfileDefaults,
  );
  const [history, setHistory] = useState<WeightedShotSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const storedTerminal = useRef<string | null>(null);
  const extractionRef = useRef(extraction);
  const pollingRef = useRef<ScalePollingSession | null>(null);
  extractionRef.current = extraction;

  useEffect(() => {
    let active = true;
    const polling = new ScalePollingSession({
      client,
      onError: () => {
        if (active) {
          setError("Scale data is unavailable.");
        }
      },
      onSnapshot: async (next) => {
        if (!active) return;
        setScale(next);
        setError(null);
        const terminal = next.terminalExtraction;
        const currentExtraction = extractionRef.current;
        if (
          terminal !== null &&
          storedTerminal.current !== terminal.extractionId &&
          currentExtraction?.selection?.kind === "profile"
        ) {
          const summary = shotSummaryFromTerminal(
            deviceId,
            currentExtraction.selection.profileId,
            terminal,
            currentExtraction.elapsedMs,
          );
          await shotHistoryRepository.append(summary);
          storedTerminal.current = terminal.extractionId;
          if (active) {
            setHistory(await shotHistoryRepository.load(deviceId));
          }
        }
      },
      scalePageVisible,
    });
    pollingRef.current = polling;
    void Promise.all([
      scalePreferencesRepository.load(deviceId).then((value) => {
        if (active) setDefaults(value);
      }),
      shotHistoryRepository.load(deviceId).then((value) => {
        if (active) setHistory(value);
      }),
    ]).catch(() => {
      if (active) setHistoryError("Local scale data could not be loaded.");
    });
    polling.start();
    return () => {
      active = false;
      polling.stop();
      if (pollingRef.current === polling) {
        pollingRef.current = null;
      }
    };
  }, [client, deviceId]);

  useEffect(() => {
    pollingRef.current?.setScalePageVisible(scalePageVisible);
  }, [scalePageVisible]);

  const run = useCallback(
    async (kind: Exclude<ScaleMutation, null>, operation: () => Promise<ScaleState>) => {
      if (mutation !== null) return;
      setMutation(kind);
      setError(null);
      try {
        setScale(await operation());
      } catch (error) {
        setError(scaleMutationErrorMessage(error));
      } finally {
        setMutation(null);
      }
    },
    [mutation],
  );

  const saveDefault = useCallback(
    async (profileId: ProfileSlotId, value: WeightControl) => {
      setDefaults(
        await scalePreferencesRepository.save(deviceId, profileId, value),
      );
    },
    [deviceId],
  );

  return {
    acknowledgeWarning: () =>
      run("acknowledge", () => client.acknowledgeScaleWarning()),
    cancelCalibration: () =>
      run("calibration-cancel", () => client.cancelScaleCalibration()),
    clearHistory: async () => {
      await shotHistoryRepository.clearDevice(deviceId);
      setHistory([]);
    },
    completeCalibration: (referenceWeightDecigrams: number) =>
      run("calibration-complete", () =>
        client.completeScaleCalibration({ referenceWeightDecigrams }),
      ),
    defaults,
    error,
    exportHistory: async () => {
      try {
        await shotHistoryExporter.share(history);
      } catch {
        setHistoryError("Shot history could not be exported.");
      }
    },
    history,
    historyError,
    mutation,
    saveDefault,
    scale,
    startCalibration: () =>
      run("calibration-start", () => client.startScaleCalibration()),
  };
}
