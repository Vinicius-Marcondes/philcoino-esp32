import type {
  ExtractionState,
  ProfileSlotId,
  ScaleState,
  ScaleTraceResponse,
  WeightedExtractionTraceCursor,
  WeightControl,
} from "@philcoino/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

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
import { WeightedTraceSyncSession } from "@/src/scale/weighted-trace-sync-session";
import type { StoredWeightedShotTrace } from "@/src/history/weighted-shot-trace";

interface ScaleClient {
  acknowledgeScaleWarning(options?: { signal?: AbortSignal }): Promise<ScaleState>;
  cancelScaleCalibration(options?: { signal?: AbortSignal }): Promise<ScaleState>;
  completeScaleCalibration(
    request: { referenceWeightDecigrams: number },
    options?: { signal?: AbortSignal },
  ): Promise<ScaleState>;
  getScale(options?: { signal?: AbortSignal }): Promise<ScaleState>;
  getScaleTrace(
    cursor?: WeightedExtractionTraceCursor,
    options?: { signal?: AbortSignal },
  ): Promise<ScaleTraceResponse>;
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
  const [trace, setTrace] = useState<StoredWeightedShotTrace | null>(null);
  const [traceSupported, setTraceSupported] = useState<boolean | null>(null);
  const storedTerminal = useRef<string | null>(null);
  const extractionRef = useRef(extraction);
  const pollingRef = useRef<ScalePollingSession | null>(null);
  const traceSyncRef = useRef<WeightedTraceSyncSession | null>(null);
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
    const traceSync = new WeightedTraceSyncSession({
      client,
      deviceId,
      onSupportChanged: setTraceSupported,
      onTrace: (nextTrace) => {
        setTrace(nextTrace);
        if (nextTrace !== null && nextTrace.completeness !== "live") {
          void shotHistoryRepository.load(deviceId).then((value) => {
            if (active) setHistory(value);
          });
        }
      },
      repository: shotHistoryRepository,
    });
    traceSyncRef.current = traceSync;
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
    traceSync.start();
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") traceSync.start();
        else traceSync.stop();
      },
    );
    return () => {
      active = false;
      polling.stop();
      traceSync.stop();
      appStateSubscription.remove();
      if (pollingRef.current === polling) {
        pollingRef.current = null;
      }
      if (traceSyncRef.current === traceSync) traceSyncRef.current = null;
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
    exportTrace: async (selectedTrace: StoredWeightedShotTrace) => {
      try {
        await shotHistoryExporter.shareTrace(selectedTrace);
      } catch {
        setHistoryError("Shot trace could not be exported.");
      }
    },
    history,
    historyError,
    mutation,
    saveDefault,
    scale,
    selectTrace: async (extractionId: string) =>
      await shotHistoryRepository.loadTrace(deviceId, extractionId),
    startCalibration: () =>
      run("calibration-start", () => client.startScaleCalibration()),
    trace,
    traceSupported,
  };
}
