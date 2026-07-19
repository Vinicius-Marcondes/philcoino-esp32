import type { HistoryCursor, HistoryPage } from "@philcoino/protocol";

import type { RecoveredHistoryPage } from "./temperature-history-repository";
import type { TemperatureHistorySample } from "./temperature-history";
import { ApiClientError } from "../networking/api-client-error";

export type TemperatureHistorySyncWarning =
  | "device"
  | "network"
  | "protocol"
  | "storage";

export class TemperatureHistoryProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemperatureHistoryProtocolError";
  }
}

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
  let page = await requestHistoryPage(client, cursor, signal);
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
      throw new TemperatureHistoryProtocolError(
        "History response belongs to a different device.",
      );
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
    page = await requestHistoryPage(client, cursor, signal);
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

async function requestHistoryPage(
  client: TemperatureHistoryClient,
  cursor: HistoryCursor | null,
  signal?: AbortSignal,
): Promise<HistoryPage> {
  try {
    return await client.getHistory(cursor ?? undefined, { signal });
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.kind !== "http") {
      throw error;
    }
    signal?.throwIfAborted();
    return await client.getHistory(cursor ?? undefined, { signal });
  }
}

export function temperatureHistorySyncWarning(
  error: unknown,
): TemperatureHistorySyncWarning {
  if (error instanceof TemperatureHistoryProtocolError) {
    return "protocol";
  }
  if (error instanceof ApiClientError) {
    if (error.kind === "protocol") {
      return "protocol";
    }
    if (
      error.kind === "offline" ||
      error.kind === "timeout"
    ) {
      return "network";
    }
    return "device";
  }
  return "storage";
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
