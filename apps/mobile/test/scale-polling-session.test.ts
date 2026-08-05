import { describe, expect, test } from "bun:test";
import type { ScaleState } from "@philcoino/protocol";

import { ApiClientError } from "../src/networking/api-client-error";
import {
  SCALE_FAST_POLL_INTERVAL_MS,
  SCALE_IDLE_POLL_INTERVAL_MS,
  ScalePollingSession,
  type ScalePollingClient,
} from "../src/scale/scale-polling-session";

const idleScale: ScaleState = {
  availability: "ready",
  calibrationStatus: "calibrated",
  stable: true,
  grossWeightDecigrams: 800,
  netWeightDecigrams: null,
  activeExtraction: null,
  terminalExtraction: null,
  warning: null,
};

const weightedScale: ScaleState = {
  ...idleScale,
  netWeightDecigrams: 10,
  activeExtraction: {
    extractionId: "weighted-run-1",
    mode: "weight",
    targetWeightDecigrams: 350,
    compensationDecigrams: 20,
    cutoffWeightDecigrams: 330,
    netWeightDecigrams: 10,
  },
};

describe("ScalePollingSession", () => {
  test("never uses REST for the 250 ms extraction telemetry cadence", () => {
    expect(SCALE_FAST_POLL_INTERVAL_MS).toBe(1_000);
    expect(SCALE_IDLE_POLL_INTERVAL_MS).toBe(1_000);
  });

  test("polls immediately then uses the one-second idle cadence", async () => {
    const scheduler = new FakeScheduler();
    let requests = 0;
    const session = new ScalePollingSession({
      client: {
        getScale: async () => {
          requests += 1;
          return idleScale;
        },
      },
      onError: () => {},
      onSnapshot: () => {},
      scalePageVisible: false,
      scheduler,
    });

    session.start();
    await settle();

    expect(requests).toBe(1);
    expect(scheduler.nextDelay()).toBe(SCALE_IDLE_POLL_INTERVAL_MS);
    scheduler.runNext();
    await settle();
    expect(requests).toBe(2);
    session.stop();
  });

  test("uses fresh weighted state then returns immediately to idle cadence", async () => {
    const scheduler = new FakeScheduler();
    const responses = [weightedScale, idleScale];
    const session = new ScalePollingSession({
      client: {
        getScale: async () => responses.shift() ?? idleScale,
      },
      onError: () => {},
      onSnapshot: () => {},
      scalePageVisible: false,
      scheduler,
    });

    session.start();
    await settle();
    expect(scheduler.nextDelay()).toBe(SCALE_FAST_POLL_INTERVAL_MS);

    scheduler.runNext();
    await settle();
    expect(scheduler.nextDelay()).toBe(SCALE_IDLE_POLL_INTERVAL_MS);
    session.stop();
  });

  test("changes a settled timer when Scale page visibility changes", async () => {
    const scheduler = new FakeScheduler();
    const session = new ScalePollingSession({
      client: { getScale: async () => idleScale },
      onError: () => {},
      onSnapshot: () => {},
      scalePageVisible: false,
      scheduler,
    });

    session.start();
    await settle();
    expect(scheduler.nextDelay()).toBe(SCALE_IDLE_POLL_INTERVAL_MS);

    session.setScalePageVisible(true);
    expect(scheduler.size).toBe(1);
    expect(scheduler.nextDelay()).toBe(SCALE_FAST_POLL_INTERVAL_MS);

    session.setScalePageVisible(false);
    expect(scheduler.size).toBe(1);
    expect(scheduler.nextDelay()).toBe(SCALE_IDLE_POLL_INTERVAL_MS);
    session.stop();
  });

  test("does not retain weighted fast cadence after a failed request", async () => {
    const scheduler = new FakeScheduler();
    let request = 0;
    let errors = 0;
    const session = new ScalePollingSession({
      client: {
        getScale: async () => {
          request += 1;
          if (request === 1) return weightedScale;
          throw new ApiClientError("offline", "offline");
        },
      },
      onError: () => {
        errors += 1;
      },
      onSnapshot: () => {},
      scalePageVisible: false,
      scheduler,
    });

    session.start();
    await settle();
    expect(scheduler.nextDelay()).toBe(SCALE_FAST_POLL_INTERVAL_MS);

    scheduler.runNext();
    await settle();
    expect(errors).toBe(1);
    expect(scheduler.nextDelay()).toBe(SCALE_IDLE_POLL_INTERVAL_MS);
    session.stop();
  });

  test("never overlaps and stop aborts without publishing or scheduling", async () => {
    const scheduler = new FakeScheduler();
    const pending = deferred<ScaleState>();
    let requests = 0;
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    let snapshots = 0;
    let aborted = false;
    const client: ScalePollingClient = {
      getScale: ({ signal } = {}) => {
        requests += 1;
        activeRequests += 1;
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            activeRequests -= 1;
            pending.reject(new ApiClientError("cancelled", "cancelled"));
          },
          { once: true },
        );
        return pending.promise.finally(() => {
          if (!aborted) activeRequests -= 1;
        });
      },
    };
    const session = new ScalePollingSession({
      client,
      onError: () => {},
      onSnapshot: () => {
        snapshots += 1;
      },
      scalePageVisible: false,
      scheduler,
    });

    session.start();
    session.start();
    session.setScalePageVisible(true);

    expect(requests).toBe(1);
    expect(maximumActiveRequests).toBe(1);
    expect(scheduler.size).toBe(0);

    session.stop();
    await settle();
    expect(aborted).toBe(true);
    expect(snapshots).toBe(0);
    expect(scheduler.size).toBe(0);
  });

  test("applies visibility changed during a request only after completion", async () => {
    const scheduler = new FakeScheduler();
    const pending = deferred<ScaleState>();
    const session = new ScalePollingSession({
      client: { getScale: () => pending.promise },
      onError: () => {},
      onSnapshot: () => {},
      scalePageVisible: false,
      scheduler,
    });

    session.start();
    session.setScalePageVisible(true);
    expect(scheduler.size).toBe(0);

    pending.resolve(idleScale);
    await settle();
    expect(scheduler.nextDelay()).toBe(SCALE_FAST_POLL_INTERVAL_MS);
    session.stop();
  });
});

class FakeScheduler {
  private nextHandle = 1;
  private readonly timers = new Map<
    number,
    { callback: () => void; delayMs: number }
  >();

  get size(): number {
    return this.timers.size;
  }

  clearTimeout = (handle: unknown) => {
    this.timers.delete(handle as number);
  };

  setTimeout = (callback: () => void, delayMs: number): number => {
    const handle = this.nextHandle++;
    this.timers.set(handle, { callback, delayMs });
    return handle;
  };

  nextDelay(): number | null {
    return this.timers.values().next().value?.delayMs ?? null;
  }

  runNext(): void {
    const entry = this.timers.entries().next().value;
    if (entry === undefined) throw new Error("No timer is scheduled.");
    const [handle, timer] = entry;
    this.timers.delete(handle);
    timer.callback();
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
