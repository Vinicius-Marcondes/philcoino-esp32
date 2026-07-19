import { z } from "zod";

export const BREW_TARGET_MIN_C = 85;
export const BREW_TARGET_MAX_C = 95;
export const STEAM_TARGET_MIN_C = 110;
export const STEAM_TARGET_MAX_C = 120;
export const STEAM_TIMEOUT_MS = 300_000;
export const EXTRACTION_MAX_DURATION_SECONDS = 60;
export const EXTRACTION_MAX_DURATION_MS =
  EXTRACTION_MAX_DURATION_SECONDS * 1_000;
export const COOLDOWN_PUMP_LIMIT_MS = 45_000;
export const COOLDOWN_STABILIZATION_MS = 5_000;
export const COOLDOWN_MAX_DURATION_MS =
  COOLDOWN_PUMP_LIMIT_MS + COOLDOWN_STABILIZATION_MS;
export const PROFILE_NAME_MAX_LENGTH = 12;
export const HISTORY_PAGE_SIZE = 60;
export const HISTORY_RETENTION_SAMPLES = 600;
export const PROFILE_SLOT_IDS = [
  "profile-1",
  "profile-2",
  "profile-3",
  "profile-4",
] as const;

export const ModeSchema = z.enum(["brew", "steam"]);
export const MachineStatusSchema = z.enum(["heating", "ready", "fault"]);
export const FaultCodeSchema = z.enum([
  "sensor_failure",
  "over_temperature",
  "heating_timeout",
  "internal_error",
]);
export const ErrorCodeSchema = z.enum([
  "malformed_request",
  "unauthorized",
  "temperature_out_of_range",
  "sensor_unavailable",
  "persistence_failure",
  "internal_error",
]);

export const BrewTargetSchema = z
  .number()
  .int()
  .min(BREW_TARGET_MIN_C)
  .max(BREW_TARGET_MAX_C);

export const SteamTargetSchema = z
  .number()
  .int()
  .min(STEAM_TARGET_MIN_C)
  .max(STEAM_TARGET_MAX_C);

export const HealthResponseSchema = z.strictObject({
  status: z.literal("ok"),
  uptimeMs: z.number().int().nonnegative(),
});

export const DeviceResponseSchema = z.strictObject({
  deviceId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  name: z.string().min(1).max(64),
  model: z.string().min(1).max(64),
  apiVersion: z.literal("1"),
  firmwareVersion: z.string().min(1).max(32),
});

export const FaultSchema = z.strictObject({
  code: FaultCodeSchema,
  message: z.string().min(1).max(160),
});

const machineStateShape = {
  activeMode: ModeSchema,
  boilerTemperatureC: z.number(),
  brewTargetC: BrewTargetSchema,
  steamTargetC: SteamTargetSchema,
  heaterEnabled: z.boolean(),
  heaterActive: z.boolean(),
  steamTimeoutRemainingMs: z
    .number()
    .int()
    .nonnegative()
    .max(STEAM_TIMEOUT_MS)
    .nullable(),
  uptimeMs: z.number().int().nonnegative(),
};

export const MachineStateSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("heating"),
    ...machineStateShape,
    fault: z.null(),
  }),
  z.strictObject({
    status: z.literal("ready"),
    ...machineStateShape,
    fault: z.null(),
  }),
  z.strictObject({
    status: z.literal("fault"),
    ...machineStateShape,
    heaterActive: z.literal(false),
    fault: FaultSchema,
  }),
]);

export const TemperatureSettingsRequestSchema = z.union([
  z.strictObject({
    brewTargetC: BrewTargetSchema,
    steamTargetC: SteamTargetSchema.optional(),
  }),
  z.strictObject({
    brewTargetC: BrewTargetSchema.optional(),
    steamTargetC: SteamTargetSchema,
  }),
]);

export const TemperatureSettingsResponseSchema = z.strictObject({
  brewTargetC: BrewTargetSchema,
  steamTargetC: SteamTargetSchema,
});

export const OverTemperatureDismissResponseSchema = MachineStateSchema;

export const ModeRequestSchema = z.strictObject({
  mode: ModeSchema,
});

export const ModeResponseSchema = z.strictObject({
  mode: ModeSchema,
});

export const HeaterSettingsRequestSchema = z.strictObject({
  heaterEnabled: z.boolean(),
});

export const HeaterSettingsResponseSchema = z.strictObject({
  heaterEnabled: z.boolean(),
});

export const ErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string().min(1).max(160),
  }),
});

export const ProfileSlotIdSchema = z.enum(PROFILE_SLOT_IDS);
export const ProfileNameSchema = z
  .string()
  .min(1)
  .max(PROFILE_NAME_MAX_LENGTH)
  .regex(/^[A-Za-z0-9]+$/);

const ProfileDurationSecondsSchema = z
  .number()
  .int()
  .min(0)
  .max(EXTRACTION_MAX_DURATION_SECONDS);

export const ExtractionProfileSchema = z
  .strictObject({
    name: ProfileNameSchema,
    preInfusionSeconds: ProfileDurationSecondsSchema,
    soakSeconds: ProfileDurationSecondsSchema,
    mainExtractionSeconds: ProfileDurationSecondsSchema.min(1),
  })
  .superRefine((profile, context) => {
    if (profile.preInfusionSeconds === 0 && profile.soakSeconds !== 0) {
      context.addIssue({
        code: "custom",
        path: ["soakSeconds"],
        message: "Soak requires a non-zero pre-infusion phase.",
      });
    }

    const totalSeconds =
      profile.preInfusionSeconds +
      profile.soakSeconds +
      profile.mainExtractionSeconds;
    if (totalSeconds > EXTRACTION_MAX_DURATION_SECONDS) {
      context.addIssue({
        code: "custom",
        path: ["mainExtractionSeconds"],
        message: "Total profile duration must not exceed 60 seconds.",
      });
    }
  });

function profileSlotSchema<const Id extends (typeof PROFILE_SLOT_IDS)[number]>(
  id: Id,
) {
  return z.strictObject({
    id: z.literal(id),
    profile: ExtractionProfileSchema.nullable(),
  });
}

export const ProfileSetSchema = z.strictObject({
  profiles: z.tuple([
    profileSlotSchema("profile-1"),
    profileSlotSchema("profile-2"),
    profileSlotSchema("profile-3"),
    profileSlotSchema("profile-4"),
  ]),
});

export const ManualExtractionSelectionSchema = z.strictObject({
  kind: z.literal("manual"),
});

export const ProfileExtractionSelectionSchema = z.strictObject({
  kind: z.literal("profile"),
  profileId: ProfileSlotIdSchema,
});

export const ExtractionSelectionSchema = z.discriminatedUnion("kind", [
  ManualExtractionSelectionSchema,
  ProfileExtractionSelectionSchema,
]);

export const PumpCommandSchema = z.enum(["running", "off"]);
export const ExtractionPhaseSchema = z.enum([
  "idle",
  "manual",
  "pre-infusion",
  "soak",
  "main-extraction",
]);

const ExtractionIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/);
const CooldownIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/);
export const IdempotencyKeySchema = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/);
const ExtractionElapsedMsSchema = z
  .number()
  .int()
  .min(0)
  .max(EXTRACTION_MAX_DURATION_MS);
const ExtractionRemainingMsSchema = ExtractionElapsedMsSchema;

export const IdleExtractionStateSchema = z.strictObject({
  status: z.literal("idle"),
  extractionId: z.null(),
  selection: z.null(),
  phase: z.literal("idle"),
  elapsedMs: z.literal(0),
  remainingMs: z.null(),
  pumpCommand: z.literal("off"),
});

export const RunningExtractionStateSchema = z.union([
  z.strictObject({
    status: z.literal("running"),
    extractionId: ExtractionIdSchema,
    selection: ManualExtractionSelectionSchema,
    phase: z.literal("manual"),
    elapsedMs: ExtractionElapsedMsSchema,
    remainingMs: ExtractionRemainingMsSchema,
    pumpCommand: z.literal("running"),
  }),
  z.strictObject({
    status: z.literal("running"),
    extractionId: ExtractionIdSchema,
    selection: ProfileExtractionSelectionSchema,
    phase: z.literal("pre-infusion"),
    elapsedMs: ExtractionElapsedMsSchema,
    remainingMs: ExtractionRemainingMsSchema,
    pumpCommand: z.literal("running"),
  }),
  z.strictObject({
    status: z.literal("running"),
    extractionId: ExtractionIdSchema,
    selection: ProfileExtractionSelectionSchema,
    phase: z.literal("soak"),
    elapsedMs: ExtractionElapsedMsSchema,
    remainingMs: ExtractionRemainingMsSchema,
    pumpCommand: z.literal("off"),
  }),
  z.strictObject({
    status: z.literal("running"),
    extractionId: ExtractionIdSchema,
    selection: ProfileExtractionSelectionSchema,
    phase: z.literal("main-extraction"),
    elapsedMs: ExtractionElapsedMsSchema,
    remainingMs: ExtractionRemainingMsSchema,
    pumpCommand: z.literal("running"),
  }),
]);

export const ExtractionOutcomeSchema = z.enum([
  "completed",
  "stopped",
  "failed",
]);
const TerminalExtractionBaseSchema = z.strictObject({
  status: z.literal("idle"),
  extractionId: ExtractionIdSchema,
  selection: ExtractionSelectionSchema,
  phase: z.literal("idle"),
  elapsedMs: ExtractionElapsedMsSchema,
  remainingMs: z.null(),
});
export const TerminalExtractionStateSchema = z.union([
  TerminalExtractionBaseSchema.extend({
    pumpCommand: z.literal("off"),
    outcome: z.enum(["completed", "stopped"]),
  }),
  TerminalExtractionBaseSchema.extend({
    pumpCommand: PumpCommandSchema,
    outcome: z.literal("failed"),
  }),
]);

export const ExtractionStateSchema = z.union([
  IdleExtractionStateSchema,
  RunningExtractionStateSchema,
  TerminalExtractionStateSchema,
]);

export const CompensationPhaseSchema = z.enum(["manual", "main-extraction"]);
export const InactiveCompensationStateSchema = z.strictObject({
  status: z.literal("inactive"),
  phase: z.null(),
});
export const ActiveCompensationStateSchema = z.strictObject({
  status: z.literal("active"),
  phase: CompensationPhaseSchema,
});
export const CompensationStateSchema = z.discriminatedUnion("status", [
  InactiveCompensationStateSchema,
  ActiveCompensationStateSchema,
]);

export const CooldownStatusSchema = z.enum([
  "idle",
  "pumping",
  "stabilizing",
]);
export const CooldownOutcomeSchema = z.enum([
  "target-reached",
  "cutoff",
  "stopped",
  "failed",
]);

const CooldownElapsedMsSchema = z
  .number()
  .int()
  .min(0)
  .max(COOLDOWN_MAX_DURATION_MS);

const InitialIdleCooldownStateSchema = z.strictObject({
  status: z.literal("idle"),
  cooldownId: z.null(),
  brewTargetC: z.null(),
  elapsedMs: z.literal(0),
  remainingMs: z.null(),
  pumpCommand: z.literal("off"),
  heaterInhibited: z.literal(false),
  outcome: z.null(),
});

const TerminalIdleCooldownBaseSchema = z.strictObject({
  status: z.literal("idle"),
  cooldownId: CooldownIdSchema,
  brewTargetC: BrewTargetSchema,
  elapsedMs: CooldownElapsedMsSchema,
  remainingMs: z.null(),
  heaterInhibited: z.literal(false),
});

const TerminalIdleCooldownStateSchema = z.union([
  TerminalIdleCooldownBaseSchema.extend({
    pumpCommand: z.literal("off"),
    outcome: z.enum(["target-reached", "cutoff", "stopped"]),
  }),
  TerminalIdleCooldownBaseSchema.extend({
    pumpCommand: PumpCommandSchema,
    outcome: z.literal("failed"),
  }),
]);

export const IdleCooldownStateSchema = z.union([
  InitialIdleCooldownStateSchema,
  TerminalIdleCooldownStateSchema,
]);

export const PumpingCooldownStateSchema = z
  .strictObject({
    status: z.literal("pumping"),
    cooldownId: CooldownIdSchema,
    brewTargetC: BrewTargetSchema,
    elapsedMs: z.number().int().min(0).max(COOLDOWN_PUMP_LIMIT_MS),
    remainingMs: z.number().int().min(0).max(COOLDOWN_PUMP_LIMIT_MS),
    pumpCommand: z.literal("running"),
    heaterInhibited: z.literal(true),
    outcome: z.null(),
  })
  .superRefine((state, context) => {
    if (state.elapsedMs + state.remainingMs !== COOLDOWN_PUMP_LIMIT_MS) {
      context.addIssue({
        code: "custom",
        path: ["remainingMs"],
        message:
          "Pumping elapsed and remaining timing must total the 45-second cutoff.",
      });
    }
  });

export const StabilizingCooldownStateSchema = z.strictObject({
  status: z.literal("stabilizing"),
  cooldownId: CooldownIdSchema,
  brewTargetC: BrewTargetSchema,
  elapsedMs: CooldownElapsedMsSchema,
  remainingMs: z.number().int().min(0).max(COOLDOWN_STABILIZATION_MS),
  pumpCommand: z.literal("off"),
  heaterInhibited: z.literal(true),
  outcome: z.enum(["target-reached", "cutoff", "stopped"]),
});

export const ActiveCooldownStateSchema = z.discriminatedUnion("status", [
  PumpingCooldownStateSchema,
  StabilizingCooldownStateSchema,
]);
export const CooldownStateSchema = z.union([
  IdleCooldownStateSchema,
  ActiveCooldownStateSchema,
]);

export const MachineStateV2Schema = z
  .strictObject({
    machine: MachineStateSchema,
    extraction: ExtractionStateSchema,
    compensation: CompensationStateSchema,
    cooldown: CooldownStateSchema,
  })
  .superRefine((state, context) => {
    if (
      state.extraction.status === "running" &&
      state.machine.activeMode !== "brew"
    ) {
      context.addIssue({
        code: "custom",
        path: ["extraction"],
        message: "An active extraction requires acknowledged Brew mode.",
      });
    }

    if (state.compensation.status === "active") {
      const extractionPhase =
        state.extraction.status === "running" ? state.extraction.phase : null;
      if (
        extractionPhase !== state.compensation.phase ||
        state.machine.activeMode !== "brew" ||
        !state.machine.heaterEnabled ||
        state.machine.status === "fault"
      ) {
        context.addIssue({
          code: "custom",
          path: ["compensation"],
          message:
            "Active compensation requires the matching Brew extraction phase, heater permission, and no machine fault.",
        });
      }
    }

    if (state.cooldown.status !== "idle") {
      if (
        state.extraction.status !== "idle" ||
        state.compensation.status !== "inactive" ||
        state.machine.activeMode !== "brew" ||
        state.machine.heaterActive ||
        state.machine.status === "fault"
      ) {
        context.addIssue({
          code: "custom",
          path: ["cooldown"],
          message:
            "An active cooldown requires idle extraction, inactive compensation, acknowledged Brew mode, a heater-off command, and no machine fault.",
        });
      }
    }

    if (
      state.cooldown.status === "idle" &&
      state.cooldown.outcome === "failed" &&
      state.machine.status !== "fault"
    ) {
      context.addIssue({
        code: "custom",
        path: ["cooldown", "outcome"],
        message:
          "A failed cooldown acknowledgement requires the machine fault state that keeps heating suppressed.",
      });
    }

    if (
      state.extraction.status === "idle" &&
      "outcome" in state.extraction &&
      state.extraction.outcome === "failed" &&
      state.machine.status !== "fault"
    ) {
      context.addIssue({
        code: "custom",
        path: ["extraction", "outcome"],
        message:
          "A failed extraction acknowledgement requires the machine fault state that keeps further output commands suppressed.",
      });
    }
  });

export const HistoryBootIdSchema = z
  .string()
  .length(32)
  .regex(/^[0-9a-f]{32}$/);
export const HistorySequenceSchema = z.number().int().nonnegative().safe();
export const HistoryContinuitySchema = z.enum([
  "initial",
  "continuous",
  "truncated",
  "reset",
]);
export const HistoryCursorSchema = z.strictObject({
  bootId: HistoryBootIdSchema,
  afterSequence: HistorySequenceSchema,
});

const historySampleShape = {
  sequence: HistorySequenceSchema,
  uptimeMs: z.number().int().nonnegative().safe(),
  boilerTemperatureC: z.number().finite(),
  brewTargetC: BrewTargetSchema,
  steamTargetC: SteamTargetSchema,
  activeMode: ModeSchema,
  heaterEnabled: z.boolean(),
  heaterActive: z.boolean(),
  pumpActive: z.boolean(),
};

export const HistorySampleSchema = z.discriminatedUnion("machineStatus", [
  z.strictObject({
    ...historySampleShape,
    machineStatus: z.literal("heating"),
    faultCode: z.null(),
  }),
  z.strictObject({
    ...historySampleShape,
    machineStatus: z.literal("ready"),
    faultCode: z.null(),
  }),
  z.strictObject({
    ...historySampleShape,
    machineStatus: z.literal("fault"),
    heaterActive: z.literal(false),
    faultCode: FaultCodeSchema,
  }),
]);

export const HistoryPageSchema = z
  .strictObject({
    deviceId: DeviceResponseSchema.shape.deviceId,
    bootId: HistoryBootIdSchema,
    capturedAtUptimeMs: z.number().int().nonnegative().safe(),
    oldestSequence: HistorySequenceSchema.nullable(),
    latestSequence: HistorySequenceSchema.nullable(),
    nextCursor: HistoryCursorSchema,
    hasMore: z.boolean(),
    continuity: HistoryContinuitySchema,
    samples: z.array(HistorySampleSchema).max(HISTORY_PAGE_SIZE),
  })
  .superRefine((page, context) => {
    if (page.nextCursor.bootId !== page.bootId) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor", "bootId"],
        message: "The next cursor must use the page boot ID.",
      });
    }
    if ((page.oldestSequence === null) !== (page.latestSequence === null)) {
      context.addIssue({
        code: "custom",
        path: ["oldestSequence"],
        message: "Oldest and latest sequence must both be null or both exist.",
      });
    }
    for (let index = 1; index < page.samples.length; index += 1) {
      if (page.samples[index].sequence <= page.samples[index - 1].sequence) {
        context.addIssue({
          code: "custom",
          path: ["samples", index, "sequence"],
          message: "History samples must be strictly sequence ordered.",
        });
      }
    }
    const last = page.samples.at(-1);
    if (last !== undefined && page.nextCursor.afterSequence !== last.sequence) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor", "afterSequence"],
        message: "The next cursor must acknowledge the last returned sample.",
      });
    }
  });

export const StartExtractionRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema,
  selection: ExtractionSelectionSchema,
});
export const StartExtractionResponseSchema = z.union([
  RunningExtractionStateSchema,
  TerminalExtractionStateSchema,
]);
export const StopExtractionResponseSchema = z.union([
  IdleExtractionStateSchema,
  TerminalExtractionStateSchema,
]);

export const StartCooldownRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema,
});
export const StartCooldownResponseSchema = CooldownStateSchema;
export const StopCooldownResponseSchema = CooldownStateSchema;

export const ApiV2ErrorCodeSchema = z.enum([
  "malformed_request",
  "unauthorized",
  "extraction_active",
  "cooldown_active",
  "brew_mode_required",
  "cooldown_not_required",
  "sensor_unavailable",
  "machine_faulted",
  "profile_not_configured",
  "idempotency_mismatch",
  "persistence_failure",
  "internal_error",
]);
export const ApiV2ErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: ApiV2ErrorCodeSchema,
    message: z.string().min(1).max(160),
  }),
});
export const ExtractionActiveConflictResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.literal("extraction_active"),
    message: z.string().min(1).max(160),
  }),
  activeExtraction: RunningExtractionStateSchema,
});
export const CooldownActiveConflictResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.literal("cooldown_active"),
    message: z.string().min(1).max(160),
  }),
  activeCooldown: ActiveCooldownStateSchema,
});

export type Mode = z.infer<typeof ModeSchema>;
export type MachineStatus = z.infer<typeof MachineStatusSchema>;
export type FaultCode = z.infer<typeof FaultCodeSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type DeviceResponse = z.infer<typeof DeviceResponseSchema>;
export type Fault = z.infer<typeof FaultSchema>;
export type MachineState = z.infer<typeof MachineStateSchema>;
export type TemperatureSettingsRequest = z.infer<
  typeof TemperatureSettingsRequestSchema
>;
export type TemperatureSettingsResponse = z.infer<
  typeof TemperatureSettingsResponseSchema
>;
export type OverTemperatureDismissResponse = z.infer<
  typeof OverTemperatureDismissResponseSchema
>;
export type ModeRequest = z.infer<typeof ModeRequestSchema>;
export type ModeResponse = z.infer<typeof ModeResponseSchema>;
export type HeaterSettingsRequest = z.infer<
  typeof HeaterSettingsRequestSchema
>;
export type HeaterSettingsResponse = z.infer<
  typeof HeaterSettingsResponseSchema
>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type ProfileSlotId = z.infer<typeof ProfileSlotIdSchema>;
export type ProfileName = z.infer<typeof ProfileNameSchema>;
export type ExtractionProfile = z.infer<typeof ExtractionProfileSchema>;
export type ProfileSet = z.infer<typeof ProfileSetSchema>;
export type ExtractionSelection = z.infer<typeof ExtractionSelectionSchema>;
export type PumpCommand = z.infer<typeof PumpCommandSchema>;
export type ExtractionPhase = z.infer<typeof ExtractionPhaseSchema>;
export type ExtractionState = z.infer<typeof ExtractionStateSchema>;
export type ExtractionOutcome = z.infer<typeof ExtractionOutcomeSchema>;
export type RunningExtractionState = z.infer<
  typeof RunningExtractionStateSchema
>;
export type TerminalExtractionState = z.infer<
  typeof TerminalExtractionStateSchema
>;
export type CompensationPhase = z.infer<typeof CompensationPhaseSchema>;
export type CompensationState = z.infer<typeof CompensationStateSchema>;
export type CooldownStatus = z.infer<typeof CooldownStatusSchema>;
export type CooldownOutcome = z.infer<typeof CooldownOutcomeSchema>;
export type IdleCooldownState = z.infer<typeof IdleCooldownStateSchema>;
export type ActiveCooldownState = z.infer<typeof ActiveCooldownStateSchema>;
export type CooldownState = z.infer<typeof CooldownStateSchema>;
export type MachineStateV2 = z.infer<typeof MachineStateV2Schema>;
export type HistoryBootId = z.infer<typeof HistoryBootIdSchema>;
export type HistorySequence = z.infer<typeof HistorySequenceSchema>;
export type HistoryContinuity = z.infer<typeof HistoryContinuitySchema>;
export type HistoryCursor = z.infer<typeof HistoryCursorSchema>;
export type HistorySample = z.infer<typeof HistorySampleSchema>;
export type HistoryPage = z.infer<typeof HistoryPageSchema>;
export type StartExtractionRequest = z.infer<
  typeof StartExtractionRequestSchema
>;
export type StartExtractionResponse = z.infer<
  typeof StartExtractionResponseSchema
>;
export type StopExtractionResponse = z.infer<typeof StopExtractionResponseSchema>;
export type StartCooldownRequest = z.infer<typeof StartCooldownRequestSchema>;
export type StartCooldownResponse = z.infer<typeof StartCooldownResponseSchema>;
export type StopCooldownResponse = z.infer<typeof StopCooldownResponseSchema>;
export type ApiV2ErrorCode = z.infer<typeof ApiV2ErrorCodeSchema>;
export type ApiV2ErrorResponse = z.infer<typeof ApiV2ErrorResponseSchema>;
export type ExtractionActiveConflictResponse = z.infer<
  typeof ExtractionActiveConflictResponseSchema
>;
export type CooldownActiveConflictResponse = z.infer<
  typeof CooldownActiveConflictResponseSchema
>;
