import { describe, expect, test } from "bun:test";

import { MachineStateV2Schema } from "@philcoino/protocol";

import {
  createThermalWorkflowPreviewState,
  finishStabilizationPreview,
  formatThermalPreviewTime,
  showCompensationActivePreview,
  showCooldownConfirmation,
  showCutoffPreview,
  showDisconnectedPreview,
  showFailurePreview,
  showSteamBlockedPreview,
  showTargetReachedPreview,
  startCooldownPreview,
  stopCooldownPreview,
} from "../src/debug/thermal-workflow-preview-model";

describe("thermal workflow design preview model", () => {
  test("starts with strict acknowledged idle and inactive compensation", () => {
    const state = createThermalWorkflowPreviewState();

    expect(MachineStateV2Schema.safeParse(state.snapshot).success).toBe(true);
    expect(state.snapshot).toMatchObject({
      machine: { activeMode: "brew", boilerTemperatureC: 104.3, brewTargetC: 93 },
      extraction: { status: "idle" },
      compensation: { status: "inactive", phase: null },
      cooldown: { status: "idle", outcome: null },
    });
  });

  test("requires confirmation before showing acknowledged pumping", () => {
    const confirmation = showCooldownConfirmation(
      createThermalWorkflowPreviewState(),
    );
    expect(confirmation.scenario).toBe("confirmation");
    expect(confirmation.snapshot?.cooldown.status).toBe("idle");

    const pumping = startCooldownPreview();
    expect(pumping.snapshot?.cooldown).toEqual({
      status: "pumping",
      cooldownId: "preview-cooldown-1",
      brewTargetC: 93,
      elapsedMs: 12_000,
      remainingMs: 33_000,
      pumpCommand: "running",
      heaterInhibited: true,
      outcome: null,
    });
    expect(pumping.snapshot?.machine.heaterActive).toBe(false);
    expect(pumping.snapshot?.machine.heaterEnabled).toBe(true);
  });

  test("makes Stop enter five-second stabilization without changing permission", () => {
    const stopped = stopCooldownPreview(startCooldownPreview());

    expect(stopped.scenario).toBe("stabilizing-stopped");
    expect(stopped.snapshot?.cooldown).toMatchObject({
      status: "stabilizing",
      remainingMs: 5_000,
      pumpCommand: "off",
      heaterInhibited: true,
      outcome: "stopped",
    });
    expect(stopped.snapshot?.machine.heaterEnabled).toBe(true);
  });

  test("previews target and cutoff outcomes then retained terminal identity", () => {
    const target = showTargetReachedPreview();
    expect(target.snapshot?.cooldown).toMatchObject({
      status: "stabilizing",
      outcome: "target-reached",
      remainingMs: 5_000,
    });

    const cutoff = showCutoffPreview();
    expect(cutoff.snapshot?.cooldown).toMatchObject({
      status: "stabilizing",
      elapsedMs: 45_000,
      outcome: "cutoff",
    });
    const completed = finishStabilizationPreview(cutoff);
    expect(completed.snapshot?.cooldown).toEqual({
      status: "idle",
      cooldownId: "preview-cooldown-1",
      brewTargetC: 93,
      elapsedMs: 50_000,
      remainingMs: null,
      pumpCommand: "off",
      heaterInhibited: false,
      outcome: "cutoff",
    });
  });

  test("shows active compensation without mutating the displayed Brew target", () => {
    const state = showCompensationActivePreview();

    expect(state.snapshot?.compensation).toEqual({
      status: "active",
      phase: "manual",
    });
    expect(state.snapshot?.extraction).toMatchObject({
      status: "running",
      phase: "manual",
    });
    expect(state.snapshot?.machine.brewTargetC).toBe(93);
  });

  test("keeps Steam-blocked extraction idle and requires explicit navigation", () => {
    const state = showSteamBlockedPreview();

    expect(state.snapshot).toMatchObject({
      machine: { activeMode: "steam" },
      extraction: { status: "idle" },
      compensation: { status: "inactive" },
    });
  });

  test("pairs failed cooldown with a machine fault and off commands", () => {
    const state = showFailurePreview();

    expect(MachineStateV2Schema.safeParse(state.snapshot).success).toBe(true);
    expect(state.snapshot).toMatchObject({
      machine: { status: "fault", heaterActive: false },
      cooldown: { status: "idle", pumpCommand: "off", outcome: "failed" },
    });
  });

  test("clears acknowledged values in the disconnected preview", () => {
    expect(showDisconnectedPreview()).toEqual({
      scenario: "disconnected",
      snapshot: null,
    });
  });

  test("uses tabular minute-second formatting", () => {
    expect(formatThermalPreviewTime(45_000)).toBe("0:45");
    expect(formatThermalPreviewTime(5_000)).toBe("0:05");
  });

  test("component remains local-only, accessible, and large-text friendly", async () => {
    const source = await Bun.file(
      new URL("../components/thermal-workflow-preview.tsx", import.meta.url),
    ).text();

    expect(source).toContain('translate("thermalPreview.feedbackWarning")');
    expect(source).toContain('translate("thermalPreview.stop")');
    expect(source).toContain('accessibilityRole="alert"');
    expect(source).toContain('accessibilityRole="radiogroup"');
    expect(source).toContain('accessibilityRole="radio"');
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain('flexWrap: "wrap"');
    expect(source).not.toContain("DeviceApiClient");
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("numberOfLines");
  });
});
