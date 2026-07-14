import { describe, expect, test } from "bun:test";
import type { MachineState } from "@philcoino/protocol";

import {
  appendTemperatureSample,
  boilerTargetC,
  boilerTemperatureC,
  connectionCopy,
  faultLabel,
  formatSteamCountdown,
  formatHistoryDuration,
  formatTarget,
  formatTemperature,
  formatUptime,
  machineActivityLabel,
  machineStatusLabel,
  modeLabel,
  steamCountdownContext,
} from "../src/dashboard/dashboard-view-model";

const steamState: MachineState = {
  activeMode: "steam",
  brewTargetC: 93,
  boilerTemperatureC: 115,
  fault: null,
  heaterEnabled: true,
  heaterActive: false,
  status: "ready",
  steamTargetC: 115,
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

  test("labels over-target heater-off states as cooling", () => {
    expect(
      machineActivityLabel({
        ...steamState,
        activeMode: "brew",
        brewTargetC: 85,
        boilerTemperatureC: 92,
        heaterActive: false,
        status: "heating",
      }),
    ).toBe("Cooling");
    expect(
      machineActivityLabel({
        ...steamState,
        activeMode: "brew",
        brewTargetC: 85,
        boilerTemperatureC: 84,
        heaterActive: true,
        status: "heating",
      }),
    ).toBe("Heating");
  });

  test("uses one boiler reading and the active mode target", () => {
    expect(
      boilerTemperatureC({
        ...steamState,
        activeMode: "brew",
        boilerTemperatureC: 85,
      }),
    ).toBe(85);
    expect(boilerTemperatureC(steamState)).toBe(115);
    expect(boilerTargetC({ ...steamState, activeMode: "brew" })).toBe(93);
    expect(boilerTargetC(steamState)).toBe(115);
  });

  test("explains whether the steam countdown is active", () => {
    expect(steamCountdownContext(steamState)).toBe("Returns to brew automatically");
    expect(
      steamCountdownContext({ ...steamState, steamTimeoutRemainingMs: null }),
    ).toBe("Starts after steam becomes ready");
    expect(formatSteamCountdown(null)).toBe("Not running");
  });

  test("keeps bounded in-memory temperature samples", () => {
    const first = appendTemperatureSample([], {
      ...steamState,
      boilerTemperatureC: 85,
      uptimeMs: 1_000,
    });
    const replaced = appendTemperatureSample(first, {
      ...steamState,
      boilerTemperatureC: 86,
      uptimeMs: 1_000,
    });
    expect(replaced).toHaveLength(1);
    expect(replaced[0].boilerTemperatureC).toBe(86);

    const capped = appendTemperatureSample(
      appendTemperatureSample(replaced, { ...steamState, uptimeMs: 2_000 }),
      { ...steamState, uptimeMs: 3_000 },
      2,
    );
    expect(capped.map((sample) => sample.uptimeMs)).toEqual([2_000, 3_000]);
    expect(formatHistoryDuration(capped)).toBe("1s");

    expect(
      appendTemperatureSample(capped, { ...steamState, uptimeMs: 500 }),
    ).toHaveLength(1);
  });
});
