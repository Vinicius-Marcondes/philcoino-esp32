import type { HistoryCursor, HistoryPage } from "@philcoino/protocol";

import type { RecoveredHistoryPage } from "./temperature-history-repository";
import type { TemperatureHistorySample } from "./temperature-history";

export interface TemperatureHistoryClient {
  getHistory(
    cursor?: HistoryCursor,
    options?: { signal?: AbortSignal },
  ): Promise<HistoryPage>;
}

export interface TemperatureHistorySyncRepository {
  loadSyncCursor(deviceId: string): Promise<HistoryCursor | null>;
  storeRecoveredPage(
    deviceId: string,
    page: RecoveredHistoryPage,
  ): Promise<void>;
}

export interface TemperatureHistorySyncOptions {
  client: TemperatureHistoryClient;
  deviceId: string;
  now?: () => number;
  onPageCommitted?: () => void | Promise<void>;
  repository: TemperatureHistorySyncRepository;
  signal?: AbortSignal;
}

export interface TemperatureHistorySyncResult {
  pagesCommitted: number;
  samplesCommitted: number;
}

export async function synchronizeTemperatureHistory({
  client,
  deviceId,
  now = Date.now,
  onPageCommitted,
  repository,
  signal,
}: TemperatureHistorySyncOptions): Promise<TemperatureHistorySyncResult> {
  let cursor = await repository.loadSyncCursor(deviceId);
  let requestStartedAtMs = now();
  let page = await client.getHistory(cursor ?? undefined, { signal });
  let responseReceivedAtMs = now();
  let anchorPhoneMs = Math.round(
    (requestStartedAtMs + responseReceivedAtMs) / 2,
  );
  let anchorUptimeMs = page.capturedAtUptimeMs;
  let anchorBootId = page.bootId;
  let latestSequenceAtStart = page.latestSequence;
  let pagesCommitted = 0;
  let samplesCommitted = 0;

  while (true) {
    if (page.deviceId !== deviceId) {
      throw new Error("History response belongs to a different device.");
    }

    signal?.throwIfAborted();
    const samples = mapHistoryPage(
      page,
      deviceId,
      anchorPhoneMs,
      anchorUptimeMs,
    );
    await repository.storeRecoveredPage(deviceId, {
      cursor: page.nextCursor,
      samples,
    });
    pagesCommitted += 1;
    samplesCommitted += samples.length;
    await onPageCommitted?.();

    cursor = page.nextCursor;
    if (
      !page.hasMore ||
      latestSequenceAtStart === null ||
      cursor.afterSequence >= latestSequenceAtStart
    ) {
      return { pagesCommitted, samplesCommitted };
    }
    requestStartedAtMs = now();
    page = await client.getHistory(cursor, { signal });
    responseReceivedAtMs = now();
    if (page.bootId !== anchorBootId) {
      anchorBootId = page.bootId;
      anchorPhoneMs = Math.round(
        (requestStartedAtMs + responseReceivedAtMs) / 2,
      );
      anchorUptimeMs = page.capturedAtUptimeMs;
      latestSequenceAtStart = page.latestSequence;
    }
  }
}

export function mapHistoryPage(
  page: HistoryPage,
  deviceId: string,
  anchorPhoneMs: number,
  anchorUptimeMs: number,
): TemperatureHistorySample[] {
  return page.samples.map((sample, index) => ({
    activeMode: sample.activeMode,
    activeTargetC:
      sample.activeMode === "brew" ? sample.brewTargetC : sample.steamTargetC,
    boilerTemperatureC: sample.boilerTemperatureC,
    brewTargetC: sample.brewTargetC,
    deviceId,
    faultCode: sample.faultCode,
    heaterActive: sample.heaterActive,
    heaterEnabled: sample.heaterEnabled,
    machineStatus: sample.machineStatus,
    pumpActive: sample.pumpActive,
    recordedAtMs: anchorPhoneMs - (anchorUptimeMs - sample.uptimeMs),
    sourceBootId: page.bootId,
    sourceSequence: sample.sequence,
    startsAfterHistoryGap:
      index === 0 &&
      (page.continuity === "reset" || page.continuity === "truncated"),
    steamTargetC: sample.steamTargetC,
    uptimeMs: sample.uptimeMs,
  }));
}
