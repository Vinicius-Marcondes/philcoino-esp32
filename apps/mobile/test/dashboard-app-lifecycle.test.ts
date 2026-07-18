import { describe, expect, test } from "bun:test";

import {
  DashboardAppLifecycle,
  type DashboardFreshness,
} from "../src/dashboard/dashboard-app-lifecycle";

describe("DashboardAppLifecycle", () => {
  test("pauses in the background and resumes without restarting live state", () => {
    const polling = lifecycleControl();
    const mutations = lifecycleControl();
    const freshness: DashboardFreshness[] = [];
    const lifecycle = new DashboardAppLifecycle({
      mutations,
      onFreshnessChange: (state) => freshness.push(state),
      polling,
    });

    lifecycle.synchronize("active");
    lifecycle.handleFreshSnapshot();
    lifecycle.synchronize("background");
    lifecycle.synchronize("background");
    lifecycle.synchronize("active");

    expect(polling.calls).toEqual(["start", "pause", "resume"]);
    expect(mutations.calls).toEqual(["start", "resume", "pause"]);
    expect(freshness).toEqual([
      "connecting",
      "live",
      "refreshing",
      "refreshing",
    ]);

    lifecycle.handleFreshSnapshot();
    expect(mutations.calls).toEqual(["start", "resume", "pause", "resume"]);
    expect(freshness.at(-1)).toBe("live");

    lifecycle.stop();
    expect(polling.calls.at(-1)).toBe("stop");
    expect(mutations.calls.at(-1)).toBe("stop");
  });

  test("does not start network work until a focused app becomes active", () => {
    const polling = lifecycleControl();
    const mutations = lifecycleControl();
    const lifecycle = new DashboardAppLifecycle({
      mutations,
      onFreshnessChange: () => {},
      polling,
    });

    lifecycle.synchronize("inactive");
    expect(polling.calls).toEqual([]);
    expect(mutations.calls).toEqual([]);

    lifecycle.synchronize("active");
    lifecycle.synchronize("active");
    expect(polling.calls).toEqual(["start"]);
    expect(mutations.calls).toEqual(["start"]);
  });
});

function lifecycleControl() {
  const calls: string[] = [];
  return {
    calls,
    pause: () => calls.push("pause"),
    resume: () => calls.push("resume"),
    start: () => calls.push("start"),
    stop: () => calls.push("stop"),
  };
}
