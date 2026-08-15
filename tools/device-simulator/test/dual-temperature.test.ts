import { describe, expect, it } from "bun:test";

import { SimulatorMachine } from "../src/model.ts";

describe("dual-temperature simulator policy", () => {
  it("uses Boiler in Brew and Steam in Steam without fallback", () => {
    const machine = new SimulatorMachine();
    machine.setTemperature(92);
    machine.setSteamTemperature(114);

    expect(machine.getState().activeMode).toBe("brew");
    machine.setSensorAvailable("steam", false);
    expect(machine.getState().fault).toBeNull();
    expect(machine.getState().steamTemperatureC).toBeNull();
    expect(machine.setMode("steam")).toBeNull();

    machine.setSensorAvailable("steam", true);
    expect(machine.setMode("steam")).toBe("steam");
    expect(machine.getState().steamTemperatureC).toBe(114);
  });

  it("turns heating off on one active failure and latches on the third", () => {
    const machine = new SimulatorMachine();
    machine.setSensorAvailable("boiler", false);
    expect(machine.getState().heaterActive).toBe(false);
    expect(machine.getState().fault).toBeNull();
    machine.setSensorAvailable("boiler", false);
    expect(machine.getState().fault).toBeNull();
    machine.setSensorAvailable("boiler", false);
    expect(machine.getState().fault).toMatchObject({
      code: "sensor_failure",
      sensor: "boiler",
    });
  });

  it("latches raw over-temperature from either sensor", () => {
    const boiler = new SimulatorMachine();
    boiler.setTemperature(136);
    expect(boiler.getState().fault).toMatchObject({
      code: "over_temperature",
      sensor: "boiler",
    });

    const steam = new SimulatorMachine();
    steam.setSteamTemperature(136);
    expect(steam.getState().fault).toMatchObject({
      code: "over_temperature",
      sensor: "steam",
    });
  });

  it("keeps calibration offsets isolated and permits only one session", () => {
    const machine = new SimulatorMachine();
    const started = machine.startTemperatureCalibration("steam");
    expect(started.ok).toBe(true);
    expect(machine.startTemperatureCalibration("boiler")).toEqual({
      ok: false,
      reason: "active",
    });
    if (!started.ok || started.state.status !== "calibrating") return;

    const saved = machine.saveTemperatureCalibration(
      "steam",
      started.state.calibrationId,
    );
    expect(saved.ok).toBe(true);
    const state = machine.getStateV4();
    expect(state.temperatureCalibrations.steam.status).toBe("calibrated");
    expect(state.temperatureCalibrations.boiler.status).toBe("uncalibrated");
  });
});
