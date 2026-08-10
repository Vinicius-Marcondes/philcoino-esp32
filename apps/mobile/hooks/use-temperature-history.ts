import type { ExtractionState, MachineState } from "@philcoino/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import type { DashboardFreshness } from "@/src/dashboard/dashboard-app-lifecycle";
import type { TemperatureHistoryExporter } from "@/src/history/temperature-history-export";
import type { TemperatureHistoryRepository } from "@/src/history/temperature-history-repository";
import {
  appendTodaySample,
  createTemperatureHistorySample,
  type TemperatureHistorySample,
} from "@/src/history/temperature-history";

export interface TemperatureHistoryState {
  clear: () => Promise<void>;
  error: "storage" | null;
  exportAll: () => Promise<void>;
  exportError: "export" | "storage" | null;
  exporting: boolean;
  samples: TemperatureHistorySample[];
  status: "loading" | "ready";
}

export function useTemperatureHistory(
  deviceId: string,
  snapshot: MachineState | null,
  extraction: ExtractionState | null,
  snapshotRevision: number,
  freshness: DashboardFreshness,
  repository: TemperatureHistoryRepository,
  exporter: TemperatureHistoryExporter,
): TemperatureHistoryState {
  const [error, setError] = useState<"storage" | null>(null);
  const [exportError, setExportError] =
    useState<"export" | "storage" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [samples, setSamples] = useState<TemperatureHistorySample[]>([]);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const generation = useRef(0);
  const lastRecordedRevision = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const refresh = useCallback(() => {
    const current = generation.current;
    const operation = queue.current.then(async () => {
      await repository.initialize();
      const loaded = await repository.loadToday(deviceId);
      if (generation.current === current) {
        setSamples(loaded);
        setError(null);
        setStatus("ready");
      }
    });
    queue.current = operation.catch(() => {
      if (generation.current === current) {
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
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      generation.current += 1;
      subscription.remove();
    };
  }, [refresh]);

  useEffect(() => {
    if (
      freshness !== "live" || snapshot === null || extraction === null ||
      lastRecordedRevision.current === snapshotRevision
    ) return;
    lastRecordedRevision.current = snapshotRevision;
    const sample = createTemperatureHistorySample(
      deviceId,
      snapshot,
      extraction,
      Date.now(),
    );
    const current = generation.current;
    const operation = queue.current.then(async () => {
      await repository.append(sample);
      if (generation.current === current) {
        setSamples((stored) => appendTodaySample(stored, sample));
        setError(null);
        setStatus("ready");
      }
    });
    queue.current = operation.catch(() => {
      if (generation.current === current) setError("storage");
    });
  }, [deviceId, extraction, freshness, repository, snapshot, snapshotRevision]);

  const exportAll = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      await queue.current;
      await exporter.share(repository.iterateAll(deviceId));
    } catch {
      setExportError("export");
    } finally {
      setExporting(false);
    }
  }, [deviceId, exporter, exporting, repository]);

  const clear = useCallback(async () => {
    await queue.current;
    await repository.clearDevice(deviceId);
    setSamples([]);
  }, [deviceId, repository]);

  return { clear, error, exportAll, exportError, exporting, samples, status };
}
