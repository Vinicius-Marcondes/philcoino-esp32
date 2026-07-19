import type { ExtractionState, MachineState } from "@philcoino/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import type { DashboardFreshness } from "@/src/dashboard/dashboard-app-lifecycle";
import type { TemperatureHistoryExporter } from "@/src/history/temperature-history-export";
import type { TemperatureHistoryRepository } from "@/src/history/temperature-history-repository";
import {
  synchronizeTemperatureHistory,
  type TemperatureHistoryClient,
} from "@/src/history/temperature-history-sync";
import {
  appendTodaySample,
  createTemperatureHistorySample,
  type TemperatureHistorySample,
} from "@/src/history/temperature-history";
import { ApiClientError } from "@/src/networking/api-client-error";

export type TemperatureHistoryError = "export" | "storage";
export type TemperatureHistoryStatus = "loading" | "ready";
export type TemperatureHistorySyncStatus = "idle" | "restoring" | "warning";

export interface TemperatureHistoryState {
  clear: () => Promise<void>;
  error: TemperatureHistoryError | null;
  exportAll: () => Promise<void>;
  exporting: boolean;
  samples: TemperatureHistorySample[];
  status: TemperatureHistoryStatus;
  syncStatus: TemperatureHistorySyncStatus;
}

export function useTemperatureHistory(
  deviceId: string,
  snapshot: MachineState | null,
  extraction: ExtractionState | null,
  snapshotRevision: number,
  freshness: DashboardFreshness,
  repository: TemperatureHistoryRepository,
  exporter: TemperatureHistoryExporter,
  client: TemperatureHistoryClient,
): TemperatureHistoryState {
  const [error, setError] = useState<TemperatureHistoryError | null>(null);
  const [exporting, setExporting] = useState(false);
  const [samples, setSamples] = useState<TemperatureHistorySample[]>([]);
  const [status, setStatus] =
    useState<TemperatureHistoryStatus>("loading");
  const [syncStatus, setSyncStatus] =
    useState<TemperatureHistorySyncStatus>("idle");
  const generation = useRef(0);
  const lastRecordedRevision = useRef(0);
  const operationQueue = useRef<Promise<void>>(Promise.resolve());

  const refresh = useCallback(() => {
    const currentGeneration = generation.current;
    operationQueue.current = operationQueue.current
      .then(async () => {
        await repository.initialize();
        const loaded = await repository.loadToday(deviceId);
        if (generation.current === currentGeneration) {
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

  useEffect(() => {
    if (freshness !== "live") {
      setSyncStatus("idle");
      return;
    }

    const controller = new AbortController();
    const currentGeneration = generation.current;
    setSyncStatus("restoring");
    const synchronize = async () => {
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
        setSyncStatus("idle");
      }
    };
    void synchronize().catch((caught: unknown) => {
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
        setSyncStatus("idle");
        return;
      }
      setSyncStatus("warning");
    });

    return () => controller.abort();
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
    );
    const currentGeneration = generation.current;
    operationQueue.current = operationQueue.current
      .then(async () => {
        await repository.append(sample);
        if (generation.current === currentGeneration) {
          setSamples((current) => appendTodaySample(current, sample));
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
  }, [
    deviceId,
    extraction,
    freshness,
    repository,
    snapshot,
    snapshotRevision,
  ]);

  const exportAll = useCallback(async () => {
    if (exporting) {
      return;
    }
    setExporting(true);
    let stored: TemperatureHistorySample[];
    try {
      await operationQueue.current;
      stored = [];
      for await (const sample of repository.iterateToday(deviceId)) {
        stored.push(sample);
      }
      setSamples(stored);
      if (stored.length === 0) {
        setError(null);
        setExporting(false);
        return;
      }
    } catch {
      setError("storage");
      setExporting(false);
      return;
    }

    try {
      await exporter.share(stored);
      setError(null);
    } catch {
      setError("export");
    } finally {
      setExporting(false);
    }
  }, [deviceId, exporter, exporting, repository]);

  const clear = useCallback(async () => {
    await operationQueue.current;
    await repository.clearDevice(deviceId);
    setSamples([]);
  }, [deviceId, repository]);

  return {
    clear,
    error,
    exportAll,
    exporting,
    samples,
    status,
    syncStatus,
  };
}
