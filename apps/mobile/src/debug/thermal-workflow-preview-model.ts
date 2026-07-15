import {
  CooldownStateSchema,
  IdleExtractionStateSchema,
  MachineStateV2Schema,
  type CooldownOutcome,
  type MachineState,
  type MachineStateV2,
} from "@philcoino/protocol";

export type ThermalPreviewScenario =
  | "idle"
  | "confirmation"
  | "compensation-active"
  | "steam-blocked"
  | "pumping"
  | "stabilizing-target"
  | "stabilizing-cutoff"
  | "stabilizing-stopped"
  | "completed"
  | "rejected"
  | "failed"
  | "disconnected";

export interface ThermalWorkflowPreviewState {
  scenario: ThermalPreviewScenario;
  snapshot: MachineStateV2 | null;
}

const idleExtraction = IdleExtractionStateSchema.parse({
  status: "idle",
  extractionId: null,
  selection: null,
  phase: "idle",
  elapsedMs: 0,
  remainingMs: null,
  pumpCommand: "off",
});

const idleCooldown = CooldownStateSchema.parse({
  status: "idle",
  cooldownId: null,
  brewTargetC: null,
  elapsedMs: 0,
  remainingMs: null,
  pumpCommand: "off",
  heaterInhibited: false,
  outcome: null,
});

export function createThermalWorkflowPreviewState(): ThermalWorkflowPreviewState {
  return previewState("idle", createIdleSnapshot());
}

export function showCooldownConfirmation(
  state: ThermalWorkflowPreviewState,
): ThermalWorkflowPreviewState {
  return state.snapshot === null
    ? state
    : previewState("confirmation", createIdleSnapshot());
}

export function startCooldownPreview(): ThermalWorkflowPreviewState {
  return previewState(
    "pumping",
    createSnapshot({
      machine: createMachine({ boilerTemperatureC: 104.3 }),
      cooldown: {
        status: "pumping",
        cooldownId: "preview-cooldown-1",
        brewTargetC: 93,
        elapsedMs: 12_000,
        remainingMs: 33_000,
        pumpCommand: "running",
        heaterInhibited: true,
        outcome: null,
      },
    }),
  );
}

export function stopCooldownPreview(
  state: ThermalWorkflowPreviewState,
): ThermalWorkflowPreviewState {
  const snapshot = state.snapshot;
  if (snapshot === null || snapshot.cooldown.status !== "pumping") {
    return state;
  }
  const cooldown = snapshot.cooldown;
  return stabilizingState(
    "stabilizing-stopped",
    "stopped",
    cooldown.elapsedMs,
    snapshot.machine.boilerTemperatureC,
  );
}

export function showTargetReachedPreview(): ThermalWorkflowPreviewState {
  return stabilizingState("stabilizing-target", "target-reached", 24_000, 93);
}

export function showCutoffPreview(): ThermalWorkflowPreviewState {
  return stabilizingState("stabilizing-cutoff", "cutoff", 45_000, 97.8);
}

export function finishStabilizationPreview(
  state: ThermalWorkflowPreviewState,
): ThermalWorkflowPreviewState {
  const snapshot = state.snapshot;
  if (snapshot === null || snapshot.cooldown.status !== "stabilizing") {
    return state;
  }
  const cooldown = snapshot.cooldown;
  return previewState(
    "completed",
    createSnapshot({
      machine: createMachine({
        boilerTemperatureC: snapshot.machine.boilerTemperatureC,
      }),
      cooldown: {
        status: "idle",
        cooldownId: cooldown.cooldownId,
        brewTargetC: cooldown.brewTargetC,
        elapsedMs: cooldown.elapsedMs + cooldown.remainingMs,
        remainingMs: null,
        pumpCommand: "off",
        heaterInhibited: false,
        outcome: cooldown.outcome,
      },
    }),
  );
}

export function showCompensationActivePreview(): ThermalWorkflowPreviewState {
  return previewState(
    "compensation-active",
    createSnapshot({
      extraction: {
        status: "running",
        extractionId: "preview-run-1",
        selection: { kind: "manual" },
        phase: "manual",
        elapsedMs: 12_000,
        remainingMs: 48_000,
        pumpCommand: "running",
      },
      compensation: { status: "active", phase: "manual" },
    }),
  );
}

export function showSteamBlockedPreview(): ThermalWorkflowPreviewState {
  return previewState(
    "steam-blocked",
    createSnapshot({
      machine: createMachine({
        activeMode: "steam",
        boilerTemperatureC: 115,
        steamTimeoutRemainingMs: 240_000,
      }),
    }),
  );
}

export function showRejectedPreview(): ThermalWorkflowPreviewState {
  return previewState(
    "rejected",
    createSnapshot({
      machine: createMachine({ boilerTemperatureC: 92 }),
    }),
  );
}

export function showFailurePreview(): ThermalWorkflowPreviewState {
  return previewState(
    "failed",
    createSnapshot({
      machine: {
        ...createMachine({ boilerTemperatureC: 99 }),
        fault: {
          code: "internal_error",
          message: "Cooldown aborted after an output command failure.",
        },
        heaterActive: false,
        status: "fault",
      },
      cooldown: {
        status: "idle",
        cooldownId: "preview-cooldown-1",
        brewTargetC: 93,
        elapsedMs: 12_000,
        remainingMs: null,
        pumpCommand: "off",
        heaterInhibited: false,
        outcome: "failed",
      },
    }),
  );
}

export function showDisconnectedPreview(): ThermalWorkflowPreviewState {
  return { scenario: "disconnected", snapshot: null };
}

export function formatThermalPreviewTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `0:${totalSeconds.toString().padStart(2, "0")}`;
}

function stabilizingState(
  scenario: Extract<
    ThermalPreviewScenario,
    "stabilizing-target" | "stabilizing-cutoff" | "stabilizing-stopped"
  >,
  outcome: Exclude<CooldownOutcome, "failed">,
  elapsedMs: number,
  boilerTemperatureC: number,
): ThermalWorkflowPreviewState {
  return previewState(
    scenario,
    createSnapshot({
      machine: createMachine({ boilerTemperatureC }),
      cooldown: {
        status: "stabilizing",
        cooldownId: "preview-cooldown-1",
        brewTargetC: 93,
        elapsedMs,
        remainingMs: 5_000,
        pumpCommand: "off",
        heaterInhibited: true,
        outcome,
      },
    }),
  );
}

function createIdleSnapshot(): MachineStateV2 {
  return createSnapshot({ machine: createMachine({ boilerTemperatureC: 104.3 }) });
}

function createSnapshot(
  overrides: Partial<Pick<MachineStateV2, "machine" | "extraction" | "compensation" | "cooldown">>,
): MachineStateV2 {
  return MachineStateV2Schema.parse({
    machine: overrides.machine ?? createMachine(),
    extraction: overrides.extraction ?? idleExtraction,
    compensation:
      overrides.compensation ?? { status: "inactive", phase: null },
    cooldown: overrides.cooldown ?? idleCooldown,
  });
}

function createMachine(overrides: Partial<MachineState> = {}): MachineState {
  const activeMode = overrides.activeMode ?? "brew";
  return {
    status: "heating",
    activeMode,
    boilerTemperatureC: 104.3,
    brewTargetC: 93,
    steamTargetC: 115,
    heaterEnabled: true,
    heaterActive: false,
    fault: null,
    steamTimeoutRemainingMs: activeMode === "steam" ? 240_000 : null,
    uptimeMs: 184_220,
    ...overrides,
  } as MachineState;
}

function previewState(
  scenario: ThermalPreviewScenario,
  snapshot: MachineStateV2,
): ThermalWorkflowPreviewState {
  return { scenario, snapshot };
}
