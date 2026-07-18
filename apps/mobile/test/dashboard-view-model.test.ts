import { describe, expect, test } from "bun:test";
import type { MachineState } from "@philcoino/protocol";

import {
  boilerTargetC,
  boilerTemperatureC,
  connectionCopy,
  faultDetail,
  faultLabel,
  formatSteamCountdown,
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
  boilerTemperatureC: 120,
  fault: null,
  heaterEnabled: true,
  heaterActive: false,
  status: "ready",
  steamTargetC: 120,
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
    expect(faultDetail("sensor_failure")).toBe(
      "The boiler thermocouple reading is unavailable, invalid, or implausible.",
    );
  });

  test("shows sanitized protocol diagnostics without response data", () => {
    expect(
      connectionCopy({
        protocol: {
          endpoint: "/api/v2/state",
          issuePaths: ["extraction.pumpCommand"],
          status: 200,
        },
        status: "protocol-error",
      }).detail,
    ).toBe(
      "The machine replied with data that does not match the current Philcoino API contract. Endpoint: /api/v2/state. HTTP status: 200. Invalid fields: extraction.pumpCommand.",
    );
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

  test("uses the acknowledged boiler reading unchanged and the active target", () => {
    expect(
      boilerTemperatureC({
        ...steamState,
        activeMode: "brew",
        boilerTemperatureC: 85,
      }),
    ).toBe(85);
    expect(boilerTemperatureC(steamState)).toBe(120);
    expect(boilerTargetC({ ...steamState, activeMode: "brew" })).toBe(93);
    expect(boilerTargetC(steamState)).toBe(120);
  });

  test("explains whether the steam countdown is active", () => {
    expect(steamCountdownContext(steamState)).toBe("Returns to brew automatically");
    expect(
      steamCountdownContext({ ...steamState, steamTimeoutRemainingMs: null }),
    ).toBe("Starts after steam becomes ready");
    expect(formatSteamCountdown(null)).toBe("Not running");
  });

});
