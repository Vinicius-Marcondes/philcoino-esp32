import { describe, expect, test } from "bun:test";
import type { MachineState } from "@philcoino/protocol";

import {
  connectionCopy,
  faultLabel,
  formatSteamCountdown,
  formatTarget,
  formatTemperature,
  formatUptime,
  machineStatusLabel,
  modeLabel,
  steamCountdownContext,
} from "../src/dashboard/dashboard-view-model";

const steamState: MachineState = {
  activeMode: "steam",
  brewTargetC: 93,
  brewTemperatureC: 91.2,
  fault: null,
  heaterActive: false,
  status: "ready",
  steamTargetC: 115,
  steamTemperatureC: 115,
  steamTimeoutRemainingMs: 299_001,
  uptimeMs: 3_661_000,
};

describe("dashboard view model", () => {
  test("formats temperatures, countdown, and uptime for stable reading", () => {
    expect(formatTemperature(91.24)).toBe("91.2°");
    expect(formatTarget(93)).toBe("93°C");
    expect(formatSteamCountdown(299_001)).toBe("5:00");
    expect(formatSteamCountdown(0)).toBe("0:00");
    expect(formatUptime(3_661_000)).toBe("1h 1m");
  });

  test("provides explicit machine and app-state labels", () => {
    expect(connectionCopy({ status: "offline" }).label).toBe("Offline");
    expect(connectionCopy({ status: "protocol-error" }).label).toBe("Protocol error");
    expect(machineStatusLabel("fault")).toBe("Fault");
    expect(modeLabel("steam")).toBe("Steam");
    expect(faultLabel("sensor_failure")).toBe("Sensor failure");
  });

  test("explains whether the steam countdown is active", () => {
    expect(steamCountdownContext(steamState)).toBe("Returns to brew automatically");
    expect(
      steamCountdownContext({ ...steamState, steamTimeoutRemainingMs: null }),
    ).toBe("Starts after steam becomes ready");
    expect(formatSteamCountdown(null)).toBe("Not running");
  });
});
