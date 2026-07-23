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
  scalePreferencesRepository,
  type ScaleProfileDefaults,
} from "@/src/scale/scale-preferences-repository";

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
  fastPolling,
}: {
  client: ScaleClient;
  deviceId: string;
  extraction: ExtractionState | null;
  fastPolling: boolean;
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
  extractionRef.current = extraction;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const next = await client.getScale({ signal: controller.signal });
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
      } catch {
        if (active && !controller.signal.aborted) {
          setError("Scale data is unavailable.");
        }
      } finally {
        if (active) {
          const weightedActive = scale?.activeExtraction !== null;
          timeout = setTimeout(poll, fastPolling || weightedActive ? 250 : 1000);
        }
      }
    };
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
    void poll();
    return () => {
      active = false;
      controller.abort();
      if (timeout !== null) clearTimeout(timeout);
    };
  }, [client, deviceId, fastPolling]);

  const run = useCallback(
    async (kind: Exclude<ScaleMutation, null>, operation: () => Promise<ScaleState>) => {
      if (mutation !== null) return;
      setMutation(kind);
      setError(null);
      try {
        setScale(await operation());
      } catch {
        setError("The scale rejected the request. Check stability and try again.");
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
