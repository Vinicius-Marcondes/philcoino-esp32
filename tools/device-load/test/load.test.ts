import { describe, expect, test } from "bun:test";

import {
  normalizeOrigin,
  percentile,
  runWorkload,
  type FetchLike,
  type WorkloadOptions,
} from "../src/load.ts";

describe("device load harness", () => {
  test("calculates nearest-rank latency percentiles", () => {
    expect(percentile([40, 10, 30, 20], 50)).toBe(20);
    expect(percentile([40, 10, 30, 20], 95)).toBe(40);
    expect(percentile([], 99)).toBe(0);
  });

  test("rejects origins that could leak credentials or alter request paths", () => {
    expect(() => normalizeOrigin("http://esp32.local/api")).toThrow();
    expect(() => normalizeOrigin("http://token@esp32.local")).toThrow();
    expect(normalizeOrigin("http://esp32.local")).toBe("http://esp32.local");
  });

  test("runs live polling, paged backfill retry, safe mutation, and a third client together", async () => {
    let active = 0;
    let maximumActive = 0;
    let historyRequests = 0;
    const requests: Array<{ authorization: string | null; body: string; path: string }> = [];
    const fetchImplementation: FetchLike = async (input, init) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      requests.push({
        authorization: headers.get("Authorization"),
        body: String(init?.body ?? ""),
        path: `${url.pathname}${url.search}`,
      });
      let status = 200;
      let body: unknown = { ok: true };
      if (url.pathname === "/api/v2/history") {
        historyRequests += 1;
        if (historyRequests === 1) {
          status = 503;
          body = { error: "busy" };
        } else if (historyRequests === 2) {
          body = {
            hasMore: true,
            latestSequence: 16,
            nextCursor: { afterSequence: 8, bootId: "boot" },
          };
        } else {
          body = {
            hasMore: false,
            latestSequence: 16,
            nextCursor: { afterSequence: 16, bootId: "boot" },
          };
        }
      }
      active -= 1;
      return new Response(JSON.stringify(body), { status });
    };
    const options: WorkloadOptions = {
      durationMs: 60_000,
      fetch: fetchImplementation,
      intervalMs: 1,
      maxHistoryPages: 75,
      maxIterations: 2,
      mutation: "heater-off",
      now: Date.now,
      origin: "http://esp32.local",
      scenario: "combined",
      sleep: async () => undefined,
      timeoutMs: 5_000,
      token: "secret-token",
    };

    const report = await runWorkload(options);

    expect(maximumActive).toBeGreaterThanOrEqual(3);
    expect(historyRequests).toBe(3);
    expect(requests.some((request) => request.path.includes("afterSequence=8"))).toBeTrue();
    expect(requests.some((request) => request.path === "/api/v1/heater")).toBeTrue();
    expect(
      requests.find((request) => request.path === "/api/v1/heater")?.body,
    ).toBe('{"heaterEnabled":false}');
    expect(report.clients.live?.requests).toBe(2);
    expect(report.clients["third-client"]?.requests).toBe(2);
    expect(report.clients.mutation?.requests).toBe(2);
    expect(report.clients.history?.httpErrors).toBe(1);
    expect(JSON.stringify(report)).not.toContain("secret-token");
    expect(
      requests
        .filter((request) => request.path !== "/healthz")
        .every((request) => request.authorization === "Bearer secret-token"),
    ).toBeTrue();
    expect(
      requests
        .filter((request) => request.path === "/healthz")
        .every((request) => request.authorization === null),
    ).toBeTrue();
  });
});
