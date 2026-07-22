import type {
  ExtractionState,
  MachineState,
  PredictiveTemperatureDiagnostics,
} from "@philcoino/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import type { DashboardFreshness } from "@/src/dashboard/dashboard-app-lifecycle";
import type { TemperatureHistoryExporter } from "@/src/history/temperature-history-export";
import type { TemperatureHistoryRepository } from "@/src/history/temperature-history-repository";
import {
  synchronizeTemperatureHistory,
  type TemperatureHistoryClient,
  temperatureHistorySyncWarning,
  type TemperatureHistorySyncWarning,
} from "@/src/history/temperature-history-sync";
import {
  appendTodaySample,
  createTemperatureHistorySample,
  isTemperatureHistoryGap,
  type TemperatureHistorySample,
} from "@/src/history/temperature-history";
import { ApiClientError } from "@/src/networking/api-client-error";

export type TemperatureHistoryError = "storage";
export type TemperatureHistoryExportError = "export" | "storage";
export type TemperatureHistoryStatus = "loading" | "ready";
export type TemperatureHistorySyncStatus = "idle" | "restoring" | "warning";
const RECOVERY_RETRY_DELAY_MS = 15_000;

export interface TemperatureHistoryState {
  clear: () => Promise<void>;
  error: TemperatureHistoryError | null;
  exportAll: () => Promise<void>;
  exportError: TemperatureHistoryExportError | null;
  exporting: boolean;
  samples: TemperatureHistorySample[];
  status: TemperatureHistoryStatus;
  syncStatus: TemperatureHistorySyncStatus;
  syncWarning: TemperatureHistorySyncWarning | null;
}

export function useTemperatureHistory(
  deviceId: string,
  snapshot: MachineState | null,
  extraction: ExtractionState | null,
  predictiveTemperature: PredictiveTemperatureDiagnostics | null,
  snapshotRevision: number,
  freshness: DashboardFreshness,
  repository: TemperatureHistoryRepository,
  exporter: TemperatureHistoryExporter,
  client: TemperatureHistoryClient,
): TemperatureHistoryState {
  const [error, setError] = useState<TemperatureHistoryError | null>(null);
  const [exportError, setExportError] =
    useState<TemperatureHistoryExportError | null>(null);
  const [exporting, setExporting] = useState(false);
  const [samples, setSamples] = useState<TemperatureHistorySample[]>([]);
  const [status, setStatus] =
    useState<TemperatureHistoryStatus>("loading");
  const [syncStatus, setSyncStatus] =
    useState<TemperatureHistorySyncStatus>("idle");
  const [syncWarning, setSyncWarning] =
    useState<TemperatureHistorySyncWarning | null>(null);
  const generation = useRef(0);
  const lastRecordedRevision = useRef(0);
  const latestSample = useRef<TemperatureHistorySample | null>(null);
  const recoveryPending = useRef(false);
  const nextRecoveryAttemptAtMs = useRef(0);
  const operationQueue = useRef<Promise<void>>(Promise.resolve());
  const activeSynchronization = useRef<{
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);

  const refresh = useCallback(() => {
    const currentGeneration = generation.current;
    operationQueue.current = operationQueue.current
      .then(async () => {
        await repository.initialize();
        const loaded = await repository.loadToday(deviceId);
        if (generation.current === currentGeneration) {
          latestSample.current = loaded.at(-1) ?? null;
          setSamples(loaded);
          setError(null);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (generation.current === currentGeneration) {
          setError("storage");
          setStatus("ready");
        }
      });
  }, [deviceId, repository]);

  useEffect(() => {
    generation.current += 1;
    lastRecordedRevision.current = 0;
    latestSample.current = null;
    recoveryPending.current = false;
    nextRecoveryAttemptAtMs.current = 0;
    setSamples([]);
    setStatus("loading");
    refresh();

    const subscription = AppState.addEventListener("change", (appState) => {
      if (appState === "active") {
        refresh();
      }
    });
    return () => {
      generation.current += 1;
      subscription.remove();
    };
  }, [refresh]);

  const synchronizeRecovery = useCallback((): Promise<void> => {
    if (freshness !== "live") {
      return Promise.resolve();
    }
    const running = activeSynchronization.current;
    if (running !== null) {
      return running.promise;
    }

    const controller = new AbortController();
    const currentGeneration = generation.current;
    nextRecoveryAttemptAtMs.current = Number.MAX_SAFE_INTEGER;
    setSyncStatus("restoring");
    setSyncWarning(null);
    const promise = (async () => {
      await operationQueue.current;
      await synchronizeTemperatureHistory({
        client,
        deviceId,
        onPageCommitted: async () => {
          await operationQueue.current;
          const loaded = await repository.loadToday(deviceId);
          if (
            generation.current === currentGeneration &&
            !controller.signal.aborted
          ) {
            latestSample.current = loaded.at(-1) ?? null;
            setSamples(loaded);
            setStatus("ready");
          }
        },
        repository: {
          loadSyncCursor: async (selectedDeviceId) => {
            await operationQueue.current;
            return await repository.loadSyncCursor(selectedDeviceId);
          },
          storeRecoveredPage: async (selectedDeviceId, page) => {
            const commit = operationQueue.current.then(() =>
              repository.storeRecoveredPage(selectedDeviceId, page),
            );
            operationQueue.current = commit.catch(() => undefined);
            await commit;
          },
        },
        signal: controller.signal,
      });
      if (
        generation.current === currentGeneration &&
        !controller.signal.aborted
      ) {
        recoveryPending.current = false;
        nextRecoveryAttemptAtMs.current = 0;
        setSyncStatus("idle");
        setSyncWarning(null);
      }
    })()
      .catch((caught: unknown) => {
        if (
          generation.current !== currentGeneration ||
          controller.signal.aborted
        ) {
          return;
        }
        if (
          caught instanceof ApiClientError &&
          (caught.kind === "not-found" || caught.kind === "cancelled")
        ) {
          if (caught.kind === "not-found") {
            recoveryPending.current = false;
          }
          nextRecoveryAttemptAtMs.current = 0;
          setSyncStatus("idle");
          setSyncWarning(null);
          return;
        }
        recoveryPending.current = true;
        nextRecoveryAttemptAtMs.current = Date.now() + RECOVERY_RETRY_DELAY_MS;
        setSyncStatus("warning");
        setSyncWarning(temperatureHistorySyncWarning(caught));
      })
      .finally(() => {
        if (activeSynchronization.current?.controller === controller) {
          activeSynchronization.current = null;
        }
      });
    activeSynchronization.current = { controller, promise };
    return promise;
  }, [client, deviceId, freshness, repository]);

  useEffect(() => {
    if (freshness !== "live") {
      activeSynchronization.current?.controller.abort();
      activeSynchronization.current = null;
      nextRecoveryAttemptAtMs.current = 0;
      setSyncStatus("idle");
    }
    return () => activeSynchronization.current?.controller.abort();
  }, [client, deviceId, freshness, repository]);

  useEffect(() => {
    if (
      freshness !== "live" ||
      snapshot === null ||
      extraction === null ||
      lastRecordedRevision.current === snapshotRevision
    ) {
      return;
    }

    lastRecordedRevision.current = snapshotRevision;
    const sample = createTemperatureHistorySample(
      deviceId,
      snapshot,
      extraction,
      Date.now(),
      predictiveTemperature,
    );
    const currentGeneration = generation.current;
    let recoveryRequired = false;
    const append = operationQueue.current.then(async () => {
      const previous = latestSample.current;
      if (previous !== null && isTemperatureHistoryGap(previous, sample)) {
        recoveryPending.current = true;
        nextRecoveryAttemptAtMs.current = 0;
      }
      recoveryRequired =
        recoveryPending.current &&
        Date.now() >= nextRecoveryAttemptAtMs.current;
      await repository.append(sample);
      if (generation.current === currentGeneration) {
        latestSample.current = sample;
        setSamples((current) => appendTodaySample(current, sample));
        setError(null);
        setStatus("ready");
      }
    });
    operationQueue.current = append.catch(() => {
      if (generation.current === currentGeneration) {
        setError("storage");
        setStatus("ready");
      }
    });
    void append.then(
      () => {
        if (
          recoveryRequired &&
          generation.current === currentGeneration
        ) {
          void synchronizeRecovery();
        }
      },
      () => undefined,
    );
  }, [
    deviceId,
    extraction,
    freshness,
    predictiveTemperature,
    repository,
    snapshot,
    snapshotRevision,
    synchronizeRecovery,
  ]);

  const exportAll = useCallback(async () => {
    if (exporting) {
      return;
    }
    setExportError(null);
    setExporting(true);
    let stored: TemperatureHistorySample[];
    try {
      await activeSynchronization.current?.promise;
      await operationQueue.current;
      stored = [];
      for await (const sample of repository.iterateToday(deviceId)) {
        stored.push(sample);
      }
      setSamples(stored);
      if (stored.length === 0) {
        setExporting(false);
        return;
      }
    } catch {
      setExportError("storage");
      setExporting(false);
      return;
    }

    try {
      await exporter.share(stored);
      setExportError(null);
    } catch {
      setExportError("export");
    } finally {
      setExporting(false);
    }
  }, [deviceId, exporter, exporting, repository]);

  const clear = useCallback(async () => {
    await activeSynchronization.current?.promise;
    await operationQueue.current;
    await repository.clearDevice(deviceId);
    latestSample.current = null;
    recoveryPending.current = false;
    nextRecoveryAttemptAtMs.current = 0;
    setSamples([]);
  }, [deviceId, repository]);

  return {
    clear,
    error,
    exportAll,
    exportError,
    exporting,
    samples,
    status,
    syncStatus,
    syncWarning,
  };
}
