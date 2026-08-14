import type {
  ExtractionState,
  MachineStateV3,
  ProfileSlotId,
  ScaleState,
  WeightControl,
} from "@philcoino/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import {
  extractionSummaryFromState,
  type ExtractionSummary,
} from "@/src/history/shot-history";
import { shotHistoryExporter } from "@/src/history/shot-history-export";
import { shotHistoryRepository } from "@/src/history/shot-history-repository";
import {
  defaultScaleProfileDefaults,
  type ScaleProfileDefaults,
} from "@/src/scale/scale-preferences";
import { scalePreferencesRepository } from "@/src/scale/scale-preferences-repository";
import { scaleMutationErrorMessage } from "@/src/scale/scale-mutation-error";
import type { StoredExtractionTrace } from "@/src/history/extraction-trace";
import {
  ExtractionStreamSession,
  type ExtractionStreamClient,
  type ExtractionStreamStatus,
} from "@/src/telemetry/extraction-stream-session";

interface ScaleClient {
  acknowledgeScaleWarning(options?: { signal?: AbortSignal }): Promise<MachineStateV3>;
  cancelScaleCalibration(options?: { signal?: AbortSignal }): Promise<MachineStateV3>;
  completeScaleCalibration(
    request: { referenceWeightDecigrams: number },
    options?: { signal?: AbortSignal },
  ): Promise<MachineStateV3>;
  startScaleCalibration(options?: { signal?: AbortSignal }): Promise<MachineStateV3>;
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
  stateScale,
  streamClient,
}: {
  client: ScaleClient;
  deviceId: string;
  extraction: ExtractionState | null;
  stateScale: ScaleState | null;
  streamClient: ExtractionStreamClient | null;
}) {
  const [scale, setScale] = useState<ScaleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mutation, setMutation] = useState<ScaleMutation>(null);
  const [defaults, setDefaults] = useState<ScaleProfileDefaults>(
    defaultScaleProfileDefaults,
  );
  const [history, setHistory] = useState<ExtractionSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [trace, setTrace] = useState<StoredExtractionTrace | null>(null);
  const [traceSupported, setTraceSupported] = useState<boolean | null>(null);
  const [streamStatus, setStreamStatus] =
    useState<ExtractionStreamStatus>("idle");
  const recordedExtractionRef = useRef<string | null>(null);
  const streamRef = useRef<ExtractionStreamSession | null>(null);

  useEffect(() => {
    setScale(stateScale);
    if (stateScale !== null) setError(null);
  }, [stateScale]);

  useEffect(() => {
    let active = true;
    const stream = streamClient === null
      ? null
      : new ExtractionStreamSession({
          client: streamClient,
          deviceId,
          onStatus: (status) => {
            setStreamStatus(status);
            if (status === "stale") {
              setError("Extraction telemetry is unavailable or stale. Start and Stop remain available.");
            } else if (status === "unsupported") {
              setError("Extraction streaming requires a firmware update. No polling fallback is used.");
            } else if (status === "live") {
              setError(null);
            }
          },
          onSupportChanged: setTraceSupported,
          onTrace: (nextTrace) => {
            if (nextTrace === null) return;
            setTrace(nextTrace);
            if (nextTrace.completeness !== "live") {
              void shotHistoryRepository.load(deviceId).then((value) => {
                if (active) setHistory(value);
              });
            }
          },
          repository: shotHistoryRepository,
        });
    streamRef.current = stream;
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
    if (AppState.currentState === "active") stream?.start();
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          stream?.start();
        } else {
          stream?.stop();
        }
      },
    );
    return () => {
      active = false;
      stream?.stop();
      appStateSubscription.remove();
      if (streamRef.current === stream) streamRef.current = null;
    };
  }, [client, deviceId, streamClient]);

  useEffect(() => {
    if (extraction === null) return;
    const retainedExtractionId = extraction.extractionId;
    const recordKey = JSON.stringify({
      extractionId: retainedExtractionId,
      status: extraction.status,
      selection: extraction.selection,
      activeWeight:
        scale?.activeExtraction?.extractionId === retainedExtractionId
          ? scale.activeExtraction
          : null,
      terminalWeight:
        scale?.terminalExtraction?.extractionId === retainedExtractionId
          ? scale.terminalExtraction
          : null,
    });
    if (recordedExtractionRef.current === recordKey) return;
    recordedExtractionRef.current = recordKey;
    let active = true;
    void (async () => {
      await shotHistoryRepository.markUnfinishedIncomplete(
        deviceId,
        retainedExtractionId,
      );
      if (
        retainedExtractionId !== null &&
        extraction.selection !== null
      ) {
        const activeWeight =
          scale?.activeExtraction?.extractionId === retainedExtractionId
            ? {
                compensationDecigrams:
                  scale.activeExtraction.compensationDecigrams,
                targetWeightDecigrams:
                  scale.activeExtraction.targetWeightDecigrams,
              }
            : undefined;
        const terminalWeight =
          scale?.terminalExtraction?.extractionId === retainedExtractionId
            ? scale.terminalExtraction
            : null;
        const weightControl = activeWeight ?? (terminalWeight === null
          ? undefined
          : {
              compensationDecigrams: terminalWeight.compensationDecigrams,
              targetWeightDecigrams: terminalWeight.targetWeightDecigrams,
            });
        const summary = extractionSummaryFromState(
          deviceId,
          extraction,
          weightControl,
        );
        await shotHistoryRepository.append(
          terminalWeight === null
            ? summary
            : {
                ...summary,
                compensationDecigrams: terminalWeight.compensationDecigrams,
                cutoffDecigrams: terminalWeight.cutoffWeightDecigrams,
                fallbackOccurred: terminalWeight.fallbackOccurred,
                finalWeightDecigrams: terminalWeight.finalWeightDecigrams,
                settled: terminalWeight.settled,
                targetDecigrams: terminalWeight.targetWeightDecigrams,
              },
        );
      }
      const nextHistory = await shotHistoryRepository.load(deviceId);
      if (active) setHistory(nextHistory);
    })().catch(() => {
      if (active) setHistoryError("Local shot data could not be saved.");
    });
    return () => {
      active = false;
    };
  }, [deviceId, extraction, scale?.activeExtraction, scale?.terminalExtraction]);

  useEffect(() => {
    const streamingExpected =
      streamClient !== null &&
      (extraction?.extractionId !== null ||
        streamStatus === "connecting" ||
        streamStatus === "live" ||
        streamStatus === "stale");
    if (streamingExpected) {
      if (extraction?.extractionId !== null && extraction?.extractionId !== undefined) {
        streamRef.current?.observeExtraction(extraction.extractionId);
      }
    }
  }, [extraction?.extractionId, extraction?.status, streamClient, streamStatus]);

  const run = useCallback(
    async (kind: Exclude<ScaleMutation, null>, operation: () => Promise<MachineStateV3>) => {
      if (mutation !== null) return;
      setMutation(kind);
      setError(null);
      try {
        setScale((await operation()).scale);
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
    exportTrace: async (selectedTrace: StoredExtractionTrace) => {
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
    selectTrace: async (extractionId: string, bootId?: string | null) =>
      await shotHistoryRepository.loadTrace(deviceId, extractionId, bootId),
    startCalibration: () =>
      run("calibration-start", () => client.startScaleCalibration()),
    trace,
    traceSupported,
    streamStatus,
  };
}
