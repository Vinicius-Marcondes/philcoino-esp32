import { describe, expect, test } from "bun:test";
import type {
  TemperatureCalibrationState,
} from "@philcoino/protocol";

import {
  TEMPERATURE_CALIBRATION_POLL_INTERVAL_MS,
  TemperatureCalibrationSession,
  type TemperatureCalibrationClient,
  type TemperatureCalibrationSessionState,
} from "../src/dashboard/temperature-calibration-session";
import { ApiClientError } from "../src/networking/api-client-error";
import {
  DeviceApiClient,
  type FetchImplementation,
} from "../src/networking/device-api-client";
import {
  createSimulator,
  DEFAULT_SIMULATOR_TOKEN,
} from "../../../tools/device-simulator/src/app.ts";

const uncalibrated: TemperatureCalibrationState = {
  status: "uncalibrated",
  savedOffsetC: 0,
  boilerTemperatureRawC: 24,
  boilerTemperatureC: 24,
  heaterActive: false,
  ready: false,
  safeTargetBounds: safeBounds(0),
};

const active: TemperatureCalibrationState = {
  status: "calibrating",
  savedOffsetC: 0,
  boilerTemperatureRawC: 24,
  boilerTemperatureC: 24,
  heaterActive: true,
  ready: false,
  safeTargetBounds: safeBounds(0),
  calibrationId: "temp-cal-test-0001",
  candidateRawTargetC: 100,
  offsetPreviewC: 0,
  advisoryStableMs: 0,
  sessionLeaseRemainingMs: 15_000,
  previewSafeTargetBounds: safeBounds(0),
};

describe("TemperatureCalibrationSession", () => {
  test("polls immediately and renews only while the screen session is active", async () => {
    const scheduler = new FakeScheduler();
    const requestedIds: (string | undefined)[] = [];
    const states: TemperatureCalibrationSessionState[] = [];
    const client = fakeClient({
      getTemperatureCalibration: async (calibrationId) => {
        requestedIds.push(calibrationId);
        return requestedIds.length === 1 ? uncalibrated : active;
      },
    });
    const session = new TemperatureCalibrationSession({
      client,
      onStateChange: (state) => states.push(state),
      scheduler,
    });

    session.start();
    await settle();
    expect(requestedIds).toEqual([undefined]);
    expect(scheduler.nextDelay()).toBe(
      TEMPERATURE_CALIBRATION_POLL_INTERVAL_MS,
    );
    expect(states.at(-1)).toMatchObject({
      status: "ready",
      snapshot: { status: "uncalibrated" },
    });

    await session.startCalibration();
    scheduler.runNext();
    await settle();
    expect(requestedIds.at(-1)).toBe(active.calibrationId);

    session.stop();
    await settle();
    expect(scheduler.size).toBe(0);
  });

  test("serializes candidate then Save without presenting the draft as acknowledged", async () => {
    const candidate = deferred<TemperatureCalibrationState>();
    const states: TemperatureCalibrationSessionState[] = [];
    const calls: string[] = [];
    const client = fakeClient({
      updateTemperatureCalibrationCandidate: async () => {
        calls.push("candidate");
        return candidate.promise;
      },
      saveTemperatureCalibration: async () => {
        calls.push("save");
        return calibrated(-1);
      },
    });
    const session = new TemperatureCalibrationSession({
      client,
      onStateChange: (state) => states.push(state),
      scheduler: new FakeScheduler(),
    });
    session.start();
    await settle();
    await session.startCalibration();

    const candidateRequest = session.updateCandidate(101);
    await settle();
    const saveRequest = session.save();
    await settle();
    expect(calls).toEqual(["candidate"]);
    expect(states.at(-1)).toMatchObject({
      status: "pending",
      pendingMutation: "candidate",
      snapshot: { candidateRawTargetC: 100 },
    });

    candidate.resolve({
      ...active,
      candidateRawTargetC: 101,
      offsetPreviewC: -1,
      previewSafeTargetBounds: safeBounds(-1),
    });
    await candidateRequest;
    await saveRequest;
    expect(calls).toEqual(["candidate", "save"]);
    expect(states.at(-1)).toMatchObject({
      status: "saved",
      pendingMutation: null,
      snapshot: { status: "calibrated", savedOffsetC: -1 },
    });
  });

  test("never overlaps a status read and a queued mutation", async () => {
    const scheduler = new FakeScheduler();
    const renewal = deferred<TemperatureCalibrationState>();
    let reads = 0;
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    let candidateCalls = 0;
    const client = fakeClient({
      getTemperatureCalibration: async () => {
        reads += 1;
        activeRequests += 1;
        maximumActiveRequests = Math.max(
          maximumActiveRequests,
          activeRequests,
        );
        if (reads === 1) {
          activeRequests -= 1;
          return uncalibrated;
        }
        return renewal.promise.finally(() => {
          activeRequests -= 1;
        });
      },
      updateTemperatureCalibrationCandidate: async () => {
        candidateCalls += 1;
        activeRequests += 1;
        maximumActiveRequests = Math.max(
          maximumActiveRequests,
          activeRequests,
        );
        activeRequests -= 1;
        return active;
      },
    });
    const session = new TemperatureCalibrationSession({
      client,
      onStateChange: () => undefined,
      scheduler,
    });
    session.start();
    await settle();
    await session.startCalibration();
    scheduler.runNext();
    await settle();

    const mutation = session.updateCandidate(100);
    await settle();
    expect(candidateCalls).toBe(0);
    renewal.resolve(active);
    await mutation;
    expect(candidateCalls).toBe(1);
    expect(maximumActiveRequests).toBe(1);
    session.stop();
  });

  test("backgrounding preserves first-cause cancellation and suppresses a late response", async () => {
    const candidate = deferred<TemperatureCalibrationState>();
    const states: TemperatureCalibrationSessionState[] = [];
    let cancels = 0;
    const client = fakeClient({
      cancelTemperatureCalibration: async () => {
        cancels += 1;
        return uncalibrated;
      },
      updateTemperatureCalibrationCandidate: async () => candidate.promise,
    });
    const session = new TemperatureCalibrationSession({
      client,
      onStateChange: (state) => states.push(state),
      scheduler: new FakeScheduler(),
    });
    session.start();
    await settle();
    await session.startCalibration();
    const pending = session.updateCandidate(101);
    await settle();

    session.pause();
    session.stop();
    expect(states.at(-1)).toMatchObject({
      snapshot: null,
      status: "cancelled",
    });
    candidate.resolve({
      ...active,
      candidateRawTargetC: 101,
      offsetPreviewC: -1,
      previewSafeTargetBounds: safeBounds(-1),
    });
    await pending;
    await settle();
    expect(cancels).toBe(1);
    expect(states.at(-1)).toMatchObject({
      snapshot: null,
      status: "cancelled",
    });
  });

  test("clears stale state on disconnection and leaves expiry as a terminal rejection", async () => {
    const scheduler = new FakeScheduler();
    const connections: string[] = [];
    const states: TemperatureCalibrationSessionState[] = [];
    let reads = 0;
    let cancels = 0;
    const client = fakeClient({
      cancelTemperatureCalibration: async () => {
        cancels += 1;
        throw new ApiClientError("offline", "offline");
      },
      getTemperatureCalibration: async () => {
        reads += 1;
        if (reads === 1) {
          return uncalibrated;
        }
        throw new ApiClientError("offline", "offline");
      },
    });
    const session = new TemperatureCalibrationSession({
      client,
      onConnectionLost: (connection) =>
        connections.push(connection.status),
      onStateChange: (state) => states.push(state),
      scheduler,
    });
    session.start();
    await settle();
    await session.startCalibration();
    scheduler.runNext();
    await settle();
    await settle();
    expect(states.at(-1)).toMatchObject({
      error: { code: "offline" },
      snapshot: null,
      status: "disconnected",
    });
    expect(connections).toEqual(["offline"]);
    expect(cancels).toBe(1);

    const expiryStates: TemperatureCalibrationSessionState[] = [];
    const expiry = new TemperatureCalibrationSession({
      client: fakeClient({
        getTemperatureCalibration: async () => {
          throw new ApiClientError("http", "expired", {
            response: {
              error: {
                code: "temperature_calibration_expired",
                message: "expired",
              },
            },
            status: 409,
          });
        },
      }),
      onStateChange: (state) => expiryStates.push(state),
      scheduler: new FakeScheduler(),
    });
    expiry.start();
    await settle();
    expect(expiryStates.at(-1)).toMatchObject({
      error: { code: "temperature_calibration_expired" },
      status: "rejected",
    });
  });

  test("runs strict start, adjust, Save, reload, cancel, and expiry against the simulator", async () => {
    const simulator = createSimulator();
    const request = simulator.app.request.bind(simulator.app);
    const fetch: FetchImplementation = (url, init) =>
      Promise.resolve(
        request(url, {
          body: init.body,
          headers: init.headers,
          method: init.method,
          signal: init.signal,
        }),
      );
    const client = new DeviceApiClient({
      address: "http://127.0.0.1:3000",
      fetch,
      token: DEFAULT_SIMULATOR_TOKEN,
    });

    let current = await client.getTemperatureCalibration();
    expect(current.status).toBe("uncalibrated");
    current = await client.startTemperatureCalibration();
    expect(current.status).toBe("calibrating");
    if (current.status !== "calibrating") {
      throw new Error("Expected active calibration.");
    }
    current = await client.updateTemperatureCalibrationCandidate({
      calibrationId: current.calibrationId,
      candidateRawTargetC: 108,
    });
    if (current.status !== "calibrating") {
      throw new Error("Expected acknowledged candidate.");
    }
    current = await client.saveTemperatureCalibration({
      calibrationId: current.calibrationId,
    });
    expect(current).toMatchObject({
      status: "calibrated",
      savedOffsetC: -8,
    });
    await simulator.app.request("/_simulator/power-cycle", {
      method: "POST",
    });
    await expect(client.getTemperatureCalibration()).resolves.toMatchObject({
      status: "calibrated",
      savedOffsetC: -8,
    });

    current = await client.startTemperatureCalibration();
    if (current.status !== "calibrating") {
      throw new Error("Expected recalibration session.");
    }
    await expect(
      client.cancelTemperatureCalibration({
        calibrationId: current.calibrationId,
      }),
    ).resolves.toMatchObject({ status: "calibrated", savedOffsetC: -8 });

    current = await client.startTemperatureCalibration();
    if (current.status !== "calibrating") {
      throw new Error("Expected expiry session.");
    }
    simulator.machine.advance(15_000);
    const error = await captureError(
      client.getTemperatureCalibration(current.calibrationId),
    );
    expect(error).toMatchObject({
      kind: "http",
      response: {
        error: { code: "temperature_calibration_expired" },
      },
      status: 409,
    });
  });

  test("rejects a malformed calibration response without retaining it", async () => {
    const client = new DeviceApiClient({
      address: "philcoino.local",
      fetch: async () =>
        Response.json({ ...uncalibrated, unexpected: true }),
      token: "secret",
    });
    const error = await captureError(
      client.getTemperatureCalibration(),
    );
    expect(error).toMatchObject({
      endpoint: "/api/v2/temperature-calibration",
      kind: "protocol",
      status: 200,
    });
  });
});

function fakeClient(
  overrides: Partial<TemperatureCalibrationClient> = {},
): TemperatureCalibrationClient {
  return {
    cancelTemperatureCalibration: async () => uncalibrated,
    getTemperatureCalibration: async () => uncalibrated,
    saveTemperatureCalibration: async () => calibrated(0),
    startTemperatureCalibration: async () => active,
    updateTemperatureCalibrationCandidate: async () => active,
    ...overrides,
  };
}

function calibrated(offset: number): TemperatureCalibrationState {
  return {
    status: "calibrated",
    savedOffsetC: offset,
    boilerTemperatureRawC: 100 - offset,
    boilerTemperatureC: 100,
    heaterActive: false,
    ready: false,
    safeTargetBounds: safeBounds(offset),
  };
}

function safeBounds(offset: number) {
  return {
    brewMinimumC: 85 as const,
    brewMaximumC: Math.min(95, 135 + offset),
    steamMinimumC: 110 as const,
    steamMaximumC: Math.min(135, 135 + offset),
  };
}

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
    if (entry === undefined) {
      throw new Error("No timer is scheduled.");
    }
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

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject.");
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
