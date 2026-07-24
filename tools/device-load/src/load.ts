export type LoadScenario = "state" | "prediction" | "history" | "combined";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface RequestMetric {
  bytes: number;
  client: "history" | "live" | "mutation" | "state" | "third-client";
  latencyMs: number;
  outcome: "http" | "network" | "success" | "timeout";
  status: number | null;
}

export interface WorkloadOptions {
  durationMs: number;
  fetch?: FetchLike;
  intervalMs: number;
  maxHistoryPages: number;
  maxIterations?: number;
  mutation?: "heater-off" | "none";
  now?: () => number;
  origin: string;
  scenario: LoadScenario;
  sleep?: (durationMs: number) => Promise<void>;
  timeoutMs: number;
  token: string;
}

export interface ClientSummary {
  bytes: number;
  httpErrors: number;
  latencyMs: {
    max: number;
    p50: number;
    p95: number;
    p99: number;
  };
  networkErrors: number;
  requests: number;
  timeouts: number;
}

export interface LoadReport {
  clients: Record<string, ClientSummary>;
  durationMs: number;
  finishedAt: string;
  origin: string;
  scenario: LoadScenario;
  totals: ClientSummary;
}

interface HistoryCursor {
  afterSequence: number;
  bootId: string;
}

interface HistoryPage {
  hasMore: boolean;
  latestSequence: number | null;
  nextCursor: HistoryCursor;
}

interface RequestResult {
  body: unknown;
  metric: RequestMetric;
}

const defaultSleep = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

export function normalizeOrigin(value: string): string {
  const parsed = new URL(value);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("Device address must be an HTTP(S) origin without credentials, path, query, or fragment.");
  }
  return parsed.origin;
}

export function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((percentileValue / 100) * ordered.length) - 1;
  return ordered[Math.max(0, Math.min(rank, ordered.length - 1))] ?? 0;
}

function isHistoryPage(value: unknown): value is HistoryPage {
  if (typeof value !== "object" || value === null) return false;
  const page = value as Record<string, unknown>;
  const cursor = page.nextCursor;
  return (
    typeof page.hasMore === "boolean" &&
    (page.latestSequence === null ||
      (typeof page.latestSequence === "number" &&
        Number.isSafeInteger(page.latestSequence))) &&
    typeof cursor === "object" &&
    cursor !== null &&
    typeof (cursor as Record<string, unknown>).bootId === "string" &&
    typeof (cursor as Record<string, unknown>).afterSequence === "number"
  );
}

async function requestJson(
  options: WorkloadOptions,
  metrics: RequestMetric[],
  client: RequestMetric["client"],
  path: string,
  init: RequestInit = {},
  authenticated = true,
): Promise<RequestResult> {
  const fetchImplementation: FetchLike =
    options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const controller = new AbortController();
  const startedAt = now();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (authenticated) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  try {
    const response = await fetchImplementation(`${options.origin}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    const metric: RequestMetric = {
      bytes: new TextEncoder().encode(text).byteLength,
      client,
      latencyMs: Math.max(0, now() - startedAt),
      outcome: response.ok ? "success" : "http",
      status: response.status,
    };
    metrics.push(metric);
    let body: unknown = null;
    if (text !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { body, metric };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const metric: RequestMetric = {
      bytes: 0,
      client,
      latencyMs: Math.max(0, now() - startedAt),
      outcome: timedOut ? "timeout" : "network",
      status: null,
    };
    metrics.push(metric);
    throw Object.assign(
      new Error(timedOut ? "request timed out" : "network request failed"),
      { cause: error, metric },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function poll(
  options: WorkloadOptions,
  metrics: RequestMetric[],
  client: RequestMetric["client"],
  path: string,
  deadlineMs: number,
  authenticated = true,
): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  let iterations = 0;
  while (
    now() < deadlineMs &&
    (options.maxIterations === undefined ||
      iterations < options.maxIterations)
  ) {
    try {
      await requestJson(options, metrics, client, path, {}, authenticated);
    } catch {
      // Failure is represented in metrics; continue to reproduce app recovery.
    }
    iterations += 1;
    await sleep(options.intervalMs);
  }
}

async function mutateHeaterOff(
  options: WorkloadOptions,
  metrics: RequestMetric[],
  deadlineMs: number,
): Promise<void> {
  if (options.mutation !== "heater-off") return;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  let iterations = 0;
  while (
    now() < deadlineMs &&
    (options.maxIterations === undefined ||
      iterations < options.maxIterations)
  ) {
    try {
      await requestJson(options, metrics, "mutation", "/api/v1/heater", {
        body: JSON.stringify({ heaterEnabled: false }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
    } catch {
      // Failure is represented in metrics.
    }
    iterations += 1;
    await sleep(Math.max(options.intervalMs, 5_000));
  }
}

export async function retrieveHistory(
  options: WorkloadOptions,
  metrics: RequestMetric[],
): Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  let cursor: HistoryCursor | undefined;
  let latestSequenceAtStart: number | null | undefined;
  for (let pageNumber = 0; pageNumber < options.maxHistoryPages; pageNumber += 1) {
    const query =
      cursor === undefined
        ? ""
        : `?bootId=${encodeURIComponent(cursor.bootId)}&afterSequence=${cursor.afterSequence}`;
    let result: RequestResult;
    try {
      result = await requestJson(
        options,
        metrics,
        "history",
        `/api/v2/history${query}`,
      );
    } catch {
      return;
    }
    if (result.metric.outcome === "http") {
      try {
        result = await requestJson(
          options,
          metrics,
          "history",
          `/api/v2/history${query}`,
        );
      } catch {
        return;
      }
    }
    if (result.metric.outcome !== "success" || !isHistoryPage(result.body)) {
      return;
    }
    const page = result.body;
    latestSequenceAtStart ??= page.latestSequence;
    cursor = page.nextCursor;
    if (
      !page.hasMore ||
      latestSequenceAtStart === null ||
      cursor.afterSequence >= latestSequenceAtStart
    ) {
      return;
    }
    await sleep(0);
  }
}

function summarize(metrics: readonly RequestMetric[]): ClientSummary {
  const latencies = metrics.map((metric) => metric.latencyMs);
  return {
    bytes: metrics.reduce((total, metric) => total + metric.bytes, 0),
    httpErrors: metrics.filter((metric) => metric.outcome === "http").length,
    latencyMs: {
      max: latencies.length === 0 ? 0 : Math.max(...latencies),
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
    networkErrors: metrics.filter((metric) => metric.outcome === "network")
      .length,
    requests: metrics.length,
    timeouts: metrics.filter((metric) => metric.outcome === "timeout").length,
  };
}

export async function runWorkload(options: WorkloadOptions): Promise<LoadReport> {
  const normalizedOptions = { ...options, origin: normalizeOrigin(options.origin) };
  const now = options.now ?? Date.now;
  const startedAt = now();
  const deadlineMs = startedAt + options.durationMs;
  const metrics: RequestMetric[] = [];

  if (options.scenario === "state") {
    await poll(normalizedOptions, metrics, "state", "/api/v2/state", deadlineMs);
  } else if (options.scenario === "prediction") {
    await poll(
      normalizedOptions,
      metrics,
      "live",
      "/api/v2/state?include=prediction",
      deadlineMs,
    );
  } else if (options.scenario === "history") {
    await retrieveHistory(normalizedOptions, metrics);
  } else {
    await Promise.all([
      poll(
        normalizedOptions,
        metrics,
        "live",
        "/api/v2/state?include=prediction",
        deadlineMs,
      ),
      retrieveHistory(normalizedOptions, metrics),
      poll(
        normalizedOptions,
        metrics,
        "third-client",
        "/healthz",
        deadlineMs,
        false,
      ),
      mutateHeaterOff(normalizedOptions, metrics, deadlineMs),
    ]);
  }

  const clients: Record<string, ClientSummary> = {};
  for (const client of new Set(metrics.map((metric) => metric.client))) {
    clients[client] = summarize(
      metrics.filter((metric) => metric.client === client),
    );
  }
  return {
    clients,
    durationMs: Math.max(0, now() - startedAt),
    finishedAt: new Date().toISOString(),
    origin: normalizedOptions.origin,
    scenario: options.scenario,
    totals: summarize(metrics),
  };
}
