import { z } from "zod";

export const BREW_TARGET_MIN_C = 85;
export const BREW_TARGET_MAX_C = 95;
export const STEAM_TARGET_MIN_C = 110;
export const STEAM_TARGET_MAX_C = 135;
export const STEAM_TIMEOUT_MS = 300_000;
export const STEAM_COMPENSATION_INITIAL_MIN_C = 0;
export const STEAM_COMPENSATION_INITIAL_MAX_C = 20;
export const STEAM_COMPENSATION_INITIAL_DEFAULT_C = 12;
export const STEAM_COMPENSATION_DECAY_MIN_MS = 60_000;
export const STEAM_COMPENSATION_DECAY_MAX_MS = 30 * 60_000;
export const STEAM_COMPENSATION_DECAY_DEFAULT_MS = 12 * 60_000;
export const STEAM_READY_TIMEOUT_MIN_MS = 60_000;
export const STEAM_READY_TIMEOUT_MAX_MS = 15 * 60_000;
export const STEAM_READY_TIMEOUT_DEFAULT_MS = STEAM_TIMEOUT_MS;
export const STEAM_SETTING_TIME_STEP_MS = 60_000;
export const TEMPERATURE_CALIBRATION_REFERENCE_C = 100;
export const TEMPERATURE_CALIBRATION_CANDIDATE_MIN_C = 90;
export const TEMPERATURE_CALIBRATION_CANDIDATE_MAX_C = 120;
export const TEMPERATURE_CALIBRATION_STEP_C = 1;
export const TEMPERATURE_CALIBRATION_OFFSET_MIN_C = -20;
export const TEMPERATURE_CALIBRATION_OFFSET_MAX_C = 10;
export const TEMPERATURE_CALIBRATION_SESSION_LEASE_MS = 15_000;
export const STEAM_OVER_TEMPERATURE_C = 135;
export const RAW_BOILER_OVER_TEMPERATURE_C = 135;
export const EXTRACTION_MAX_DURATION_SECONDS = 60;
export const EXTRACTION_MAX_DURATION_MS =
  EXTRACTION_MAX_DURATION_SECONDS * 1_000;
export const COOLDOWN_PUMP_LIMIT_MS = 45_000;
export const COOLDOWN_STABILIZATION_MS = 5_000;
export const COOLDOWN_MAX_DURATION_MS =
  COOLDOWN_PUMP_LIMIT_MS + COOLDOWN_STABILIZATION_MS;
export const PROFILE_NAME_MAX_LENGTH = 12;
export const HISTORY_PAGE_SIZE = 8;
export const HISTORY_RETENTION_SAMPLES = 600;
export const WEIGHTED_TRACE_PAGE_SIZE = 16;
export const WEIGHTED_TRACE_RETENTION_SAMPLES = 320;
export const WEIGHTED_TRACE_SAMPLE_INTERVAL_MS = 250;
export const WEIGHTED_TRACE_SETTLING_LIMIT_MS = 10_000;
export const EXTRACTION_TELEMETRY_PAGE_SIZE = 16;
export const EXTRACTION_TELEMETRY_RETENTION_SAMPLES = 320;
export const EXTRACTION_TELEMETRY_SAMPLE_INTERVAL_MS = 250;
export const EXTRACTION_TELEMETRY_SETTLING_LIMIT_MS = 10_000;
export const EXTRACTION_TELEMETRY_HEARTBEAT_INTERVAL_MS = 2_000;
export const WEIGHT_TARGET_MIN_DECIGRAMS = 50;
export const WEIGHT_TARGET_MAX_DECIGRAMS = 1_000;
export const WEIGHT_COMPENSATION_MIN_DECIGRAMS = 0;
export const WEIGHT_COMPENSATION_MAX_DECIGRAMS = 100;
export const CALIBRATION_REFERENCE_MIN_DECIGRAMS = 500;
export const CALIBRATION_REFERENCE_MAX_DECIGRAMS = 5_000;
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
  "temperature_target_unsafe",
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

export const SteamCompensationInitialSchema = z
  .number()
  .int()
  .min(STEAM_COMPENSATION_INITIAL_MIN_C)
  .max(STEAM_COMPENSATION_INITIAL_MAX_C);
export const SteamCompensationDecaySchema = z
  .number()
  .int()
  .min(STEAM_COMPENSATION_DECAY_MIN_MS)
  .max(STEAM_COMPENSATION_DECAY_MAX_MS)
  .multipleOf(STEAM_SETTING_TIME_STEP_MS);
export const SteamReadyTimeoutSchema = z
  .number()
  .int()
  .min(STEAM_READY_TIMEOUT_MIN_MS)
  .max(STEAM_READY_TIMEOUT_MAX_MS)
  .multipleOf(STEAM_SETTING_TIME_STEP_MS);
export const SteamControlSettingsSchema = z.strictObject({
  initialCompensationC: SteamCompensationInitialSchema,
  decayDurationMs: SteamCompensationDecaySchema,
  readyTimeoutMs: SteamReadyTimeoutSchema,
});
export const SteamControlSettingsRequestSchema = z.union([
  z.strictObject({
    initialCompensationC: SteamCompensationInitialSchema,
    decayDurationMs: SteamCompensationDecaySchema.optional(),
    readyTimeoutMs: SteamReadyTimeoutSchema.optional(),
  }),
  z.strictObject({
    initialCompensationC: SteamCompensationInitialSchema.optional(),
    decayDurationMs: SteamCompensationDecaySchema,
    readyTimeoutMs: SteamReadyTimeoutSchema.optional(),
  }),
  z.strictObject({
    initialCompensationC: SteamCompensationInitialSchema.optional(),
    decayDurationMs: SteamCompensationDecaySchema.optional(),
    readyTimeoutMs: SteamReadyTimeoutSchema,
  }),
]);
export const SteamControlStateSchema = z.strictObject({
  settings: SteamControlSettingsSchema,
  compensationActive: z.boolean(),
  appliedCompensationC: z
    .number()
    .finite()
    .min(STEAM_COMPENSATION_INITIAL_MIN_C)
    .max(STEAM_COMPENSATION_INITIAL_MAX_C),
  controlTemperatureC: z.number().finite().min(-40).max(180).nullable(),
  heatSoakElapsedMs: z.number().int().nonnegative().safe().nullable(),
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
    .max(STEAM_READY_TIMEOUT_MAX_MS)
    .nullable(),
  steamControl: SteamControlStateSchema,
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

export const TemperatureCalibrationSessionIdSchema = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/);
export const TemperatureCalibrationStatusSchema = z.enum([
  "uncalibrated",
  "calibrating",
  "calibrated",
]);
export const TemperatureCalibrationCandidateRawTargetSchema = z
  .number()
  .int()
  .min(TEMPERATURE_CALIBRATION_CANDIDATE_MIN_C)
  .max(TEMPERATURE_CALIBRATION_CANDIDATE_MAX_C);
export const TemperatureCalibrationOffsetSchema = z
  .number()
  .int()
  .min(TEMPERATURE_CALIBRATION_OFFSET_MIN_C)
  .max(TEMPERATURE_CALIBRATION_OFFSET_MAX_C);
export const TemperatureCalibrationSafeTargetBoundsSchema = z
  .strictObject({
    brewMinimumC: z.literal(BREW_TARGET_MIN_C),
    brewMaximumC: BrewTargetSchema,
    steamMinimumC: z.literal(STEAM_TARGET_MIN_C),
    steamMaximumC: SteamTargetSchema,
  })
  .refine(
    (bounds) =>
      bounds.brewMaximumC >= bounds.brewMinimumC &&
      bounds.steamMaximumC >= bounds.steamMinimumC,
    { message: "Safe target maxima must not be below their minima." },
  );

const temperatureCalibrationStateShape = {
  savedOffsetC: TemperatureCalibrationOffsetSchema,
  boilerTemperatureRawC: z.number().finite().min(-40).max(160).nullable(),
  boilerTemperatureC: z.number().finite().min(-60).max(170).nullable(),
  heaterActive: z.boolean(),
  ready: z.boolean(),
  safeTargetBounds: TemperatureCalibrationSafeTargetBoundsSchema,
};

export const UncalibratedTemperatureCalibrationStateSchema = z.strictObject({
  status: z.literal("uncalibrated"),
  ...temperatureCalibrationStateShape,
  savedOffsetC: z.literal(0),
});
export const CalibratedTemperatureCalibrationStateSchema = z.strictObject({
  status: z.literal("calibrated"),
  ...temperatureCalibrationStateShape,
});
export const ActiveTemperatureCalibrationStateSchema = z
  .strictObject({
    status: z.literal("calibrating"),
    ...temperatureCalibrationStateShape,
    calibrationId: TemperatureCalibrationSessionIdSchema,
    candidateRawTargetC: TemperatureCalibrationCandidateRawTargetSchema,
    offsetPreviewC: TemperatureCalibrationOffsetSchema,
    advisoryStableMs: z.number().int().nonnegative(),
    sessionLeaseRemainingMs: z
      .number()
      .int()
      .nonnegative()
      .max(TEMPERATURE_CALIBRATION_SESSION_LEASE_MS),
    previewSafeTargetBounds: TemperatureCalibrationSafeTargetBoundsSchema,
  })
  .superRefine((state, context) => {
    if (
      state.offsetPreviewC !==
      TEMPERATURE_CALIBRATION_REFERENCE_C - state.candidateRawTargetC
    ) {
      context.addIssue({
        code: "custom",
        path: ["offsetPreviewC"],
        message:
          "The offset preview must map the candidate raw target to 100°C.",
      });
    }
  });
export const TemperatureCalibrationStateSchema = z.discriminatedUnion(
  "status",
  [
    UncalibratedTemperatureCalibrationStateSchema,
    ActiveTemperatureCalibrationStateSchema,
    CalibratedTemperatureCalibrationStateSchema,
  ],
);
export const UpdateTemperatureCalibrationCandidateRequestSchema =
  z.strictObject({
    calibrationId: TemperatureCalibrationSessionIdSchema,
    candidateRawTargetC: TemperatureCalibrationCandidateRawTargetSchema,
  });
export const TemperatureCalibrationSessionRequestSchema = z.strictObject({
  calibrationId: TemperatureCalibrationSessionIdSchema,
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

export const WeightTargetDecigramsSchema = z
  .number()
  .int()
  .min(WEIGHT_TARGET_MIN_DECIGRAMS)
  .max(WEIGHT_TARGET_MAX_DECIGRAMS);
export const WeightCompensationDecigramsSchema = z
  .number()
  .int()
  .min(WEIGHT_COMPENSATION_MIN_DECIGRAMS)
  .max(WEIGHT_COMPENSATION_MAX_DECIGRAMS);
export const CalibrationReferenceDecigramsSchema = z
  .number()
  .int()
  .min(CALIBRATION_REFERENCE_MIN_DECIGRAMS)
  .max(CALIBRATION_REFERENCE_MAX_DECIGRAMS);

export const WeightControlSchema = z
  .strictObject({
    targetWeightDecigrams: WeightTargetDecigramsSchema,
    compensationDecigrams: WeightCompensationDecigramsSchema,
  })
  .superRefine((control, context) => {
    if (control.compensationDecigrams >= control.targetWeightDecigrams) {
      context.addIssue({
        code: "custom",
        path: ["compensationDecigrams"],
        message: "Compensation must be lower than the target weight.",
      });
    }
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

const machineStateV2Shape = {
  machine: MachineStateSchema,
  extraction: ExtractionStateSchema,
  compensation: CompensationStateSchema,
  cooldown: CooldownStateSchema,
};
const MachineStateV2BaseSchema = z.strictObject(machineStateV2Shape);

function refineMachineStateV2(
  state: z.infer<typeof MachineStateV2BaseSchema>,
  context: z.RefinementCtx,
): void {
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
}

export const MachineStateV2Schema =
  MachineStateV2BaseSchema.superRefine(refineMachineStateV2);

const ScaleWeightDecigramsSchema = z.number().int().min(-500).max(10_500);
export const ScaleAvailabilitySchema = z.enum([
  "unavailable",
  "unstable",
  "ready",
]);
export const ScaleCalibrationStatusSchema = z.enum([
  "uncalibrated",
  "calibrating",
  "calibrated",
]);
export const ScaleCompletionReasonSchema = z.enum([
  "weight-reached",
  "timer-fallback",
  "stopped",
  "safety-cutoff",
]);
export const ActiveWeightExtractionSchema = z.strictObject({
  extractionId: ExtractionIdSchema,
  mode: z.enum(["weight", "timer-fallback"]),
  targetWeightDecigrams: WeightTargetDecigramsSchema,
  compensationDecigrams: WeightCompensationDecigramsSchema,
  cutoffWeightDecigrams: z.number().int().min(1).max(WEIGHT_TARGET_MAX_DECIGRAMS),
  netWeightDecigrams: ScaleWeightDecigramsSchema.nullable(),
});
export const TerminalWeightExtractionSchema = z.strictObject({
  extractionId: ExtractionIdSchema,
  targetWeightDecigrams: WeightTargetDecigramsSchema,
  compensationDecigrams: WeightCompensationDecigramsSchema,
  cutoffWeightDecigrams: z.number().int().min(1).max(WEIGHT_TARGET_MAX_DECIGRAMS),
  finalWeightDecigrams: ScaleWeightDecigramsSchema.nullable(),
  settled: z.boolean(),
  completionReason: ScaleCompletionReasonSchema,
  fallbackOccurred: z.boolean(),
});
export const ScaleWarningSchema = z.strictObject({
  code: z.literal("scale_fallback"),
  extractionId: ExtractionIdSchema,
  acknowledged: z.literal(false),
});
export const ScaleStateSchema = z.strictObject({
  availability: ScaleAvailabilitySchema,
  calibrationStatus: ScaleCalibrationStatusSchema,
  stable: z.boolean(),
  grossWeightDecigrams: ScaleWeightDecigramsSchema.nullable(),
  netWeightDecigrams: ScaleWeightDecigramsSchema.nullable(),
  activeExtraction: ActiveWeightExtractionSchema.nullable(),
  terminalExtraction: TerminalWeightExtractionSchema.nullable(),
  warning: ScaleWarningSchema.nullable(),
});

export const WeightedExtractionTraceSequenceSchema = z
  .number()
  .int()
  .nonnegative()
  .safe();
export const WeightedExtractionTraceStatusSchema = z.enum([
  "running",
  "settling",
  "terminal",
]);
export const WeightedExtractionTracePhaseSchema = z.enum([
  "pre-infusion",
  "soak",
  "main-extraction",
  "settling",
]);
export const WeightedExtractionTraceCursorSchema = z.strictObject({
  extractionId: ExtractionIdSchema,
  bootId: z
    .string()
    .length(32)
    .regex(/^[0-9a-f]{32}$/),
  afterSequence: WeightedExtractionTraceSequenceSchema,
});
export const WeightedExtractionTraceSampleSchema = z.strictObject({
  sequence: WeightedExtractionTraceSequenceSchema,
  uptimeMs: z.number().int().nonnegative().safe(),
  elapsedMs: z
    .number()
    .int()
    .nonnegative()
    .max(EXTRACTION_MAX_DURATION_MS + WEIGHTED_TRACE_SETTLING_LIMIT_MS),
  phase: WeightedExtractionTracePhaseSchema,
  boilerTemperatureC: z.number().finite(),
  activeTargetC: BrewTargetSchema,
  netWeightDecigrams: ScaleWeightDecigramsSchema.nullable(),
  scaleAvailability: ScaleAvailabilitySchema,
  pumpCommand: PumpCommandSchema,
});
export const WeightedExtractionTracePageSchema = z
  .strictObject({
    deviceId: DeviceResponseSchema.shape.deviceId,
    extractionId: ExtractionIdSchema,
    bootId: WeightedExtractionTraceCursorSchema.shape.bootId,
    capturedAtUptimeMs: z.number().int().nonnegative().safe(),
    status: WeightedExtractionTraceStatusSchema,
    oldestSequence: WeightedExtractionTraceSequenceSchema,
    latestSequence: WeightedExtractionTraceSequenceSchema,
    nextCursor: WeightedExtractionTraceCursorSchema,
    hasMore: z.boolean(),
    continuity: z.enum(["initial", "continuous", "truncated", "reset"]),
    samples: z
      .array(WeightedExtractionTraceSampleSchema)
      .max(WEIGHTED_TRACE_PAGE_SIZE),
  })
  .superRefine((page, context) => {
    if (
      page.nextCursor.bootId !== page.bootId ||
      page.nextCursor.extractionId !== page.extractionId
    ) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor"],
        message: "The trace cursor must identify the returned boot and extraction.",
      });
    }
    if (page.oldestSequence > page.latestSequence) {
      context.addIssue({
        code: "custom",
        path: ["oldestSequence"],
        message: "The oldest trace sequence cannot exceed the latest sequence.",
      });
    }
    for (let index = 1; index < page.samples.length; index += 1) {
      if (page.samples[index].sequence <= page.samples[index - 1].sequence) {
        context.addIssue({
          code: "custom",
          path: ["samples", index, "sequence"],
          message: "Trace samples must be strictly sequence ordered.",
        });
      }
    }
    const last = page.samples.at(-1);
    if (
      last !== undefined &&
      page.nextCursor.afterSequence !== last.sequence
    ) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor", "afterSequence"],
        message: "The next trace cursor must acknowledge the last returned sample.",
      });
    }
  });
export const ScaleTraceResponseSchema = z.strictObject({
  scale: ScaleStateSchema,
  trace: WeightedExtractionTracePageSchema.nullable(),
});

export const ExtractionTelemetryControlModeSchema = z.enum([
  "manual",
  "timed",
  "weight",
]);
export const ExtractionTelemetryStatusSchema = z.enum([
  "running",
  "settling",
  "terminal",
]);
export const ExtractionTelemetryPhaseSchema = z.enum([
  "manual",
  "pre-infusion",
  "soak",
  "main-extraction",
  "settling",
]);
export const ExtractionTelemetryCursorSchema = z.strictObject({
  extractionId: ExtractionIdSchema,
  bootId: WeightedExtractionTraceCursorSchema.shape.bootId,
  afterSequence: WeightedExtractionTraceSequenceSchema,
});
export const ExtractionTelemetrySampleSchema = z.strictObject({
  sequence: WeightedExtractionTraceSequenceSchema,
  uptimeMs: z.number().int().nonnegative().safe(),
  elapsedMs: z
    .number()
    .int()
    .nonnegative()
    .max(EXTRACTION_MAX_DURATION_MS + EXTRACTION_TELEMETRY_SETTLING_LIMIT_MS),
  extractionElapsedMs: ExtractionElapsedMsSchema,
  phase: ExtractionTelemetryPhaseSchema,
  boilerTemperatureC: z.number().finite(),
  activeTargetC: BrewTargetSchema,
  heaterActive: z.boolean(),
  pumpCommand: PumpCommandSchema,
  scaleAvailability: ScaleAvailabilitySchema,
  netWeightDecigrams: ScaleWeightDecigramsSchema.nullable(),
});
export const ExtractionTelemetryPageSchema = z
  .strictObject({
    version: z.literal(1),
    deviceId: DeviceResponseSchema.shape.deviceId,
    extractionId: ExtractionIdSchema,
    bootId: ExtractionTelemetryCursorSchema.shape.bootId,
    capturedAtUptimeMs: z.number().int().nonnegative().safe(),
    selection: ExtractionSelectionSchema,
    controlMode: ExtractionTelemetryControlModeSchema,
    weightControl: WeightControlSchema.nullable(),
    baselineWeightDecigrams: ScaleWeightDecigramsSchema.nullable(),
    status: ExtractionTelemetryStatusSchema,
    outcome: ExtractionOutcomeSchema.nullable(),
    terminalWeight: TerminalWeightExtractionSchema.nullable(),
    oldestSequence: WeightedExtractionTraceSequenceSchema,
    latestSequence: WeightedExtractionTraceSequenceSchema,
    nextCursor: ExtractionTelemetryCursorSchema,
    hasMore: z.boolean(),
    continuity: z.enum(["initial", "continuous", "truncated", "reset"]),
    samples: z
      .array(ExtractionTelemetrySampleSchema)
      .min(1)
      .max(EXTRACTION_TELEMETRY_PAGE_SIZE),
  })
  .superRefine((page, context) => {
    if (
      page.nextCursor.bootId !== page.bootId ||
      page.nextCursor.extractionId !== page.extractionId
    ) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor"],
        message: "The telemetry cursor must identify the returned boot and extraction.",
      });
    }
    if (page.oldestSequence > page.latestSequence) {
      context.addIssue({
        code: "custom",
        path: ["oldestSequence"],
        message: "The oldest telemetry sequence cannot exceed the latest sequence.",
      });
    }
    for (let index = 1; index < page.samples.length; index += 1) {
      if (page.samples[index].sequence <= page.samples[index - 1].sequence) {
        context.addIssue({
          code: "custom",
          path: ["samples", index, "sequence"],
          message: "Telemetry samples must be strictly sequence ordered.",
        });
      }
    }
    const first = page.samples[0];
    const last = page.samples.at(-1)!;
    if (
      first.sequence < page.oldestSequence ||
      last.sequence > page.latestSequence
    ) {
      context.addIssue({
        code: "custom",
        path: ["samples"],
        message: "Telemetry samples must remain within the retained sequence bounds.",
      });
    }
    if (page.nextCursor.afterSequence !== last.sequence) {
      context.addIssue({
        code: "custom",
        path: ["nextCursor", "afterSequence"],
        message: "The next telemetry cursor must acknowledge the last returned sample.",
      });
    }
    if (page.hasMore !== (last.sequence < page.latestSequence)) {
      context.addIssue({
        code: "custom",
        path: ["hasMore"],
        message: "Telemetry hasMore must match the returned and latest sequences.",
      });
    }
    const expectedMode =
      page.selection.kind === "manual"
        ? "manual"
        : page.weightControl === null
          ? "timed"
          : "weight";
    if (page.controlMode !== expectedMode) {
      context.addIssue({
        code: "custom",
        path: ["controlMode"],
        message: "Telemetry control mode must match the extraction selection and weight control.",
      });
    }
    if (page.controlMode !== "weight" && page.terminalWeight !== null) {
      context.addIssue({
        code: "custom",
        path: ["terminalWeight"],
        message: "Only weighted extraction telemetry may include a terminal weight result.",
      });
    }
    if (
      page.terminalWeight !== null &&
      page.terminalWeight.extractionId !== page.extractionId
    ) {
      context.addIssue({
        code: "custom",
        path: ["terminalWeight", "extractionId"],
        message: "The terminal weight result must identify the returned extraction.",
      });
    }
    if (
      (page.status === "running" && page.outcome !== null) ||
      (page.status !== "running" && page.outcome === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["outcome"],
        message: "Running telemetry has no outcome; settling and terminal telemetry require one.",
      });
    }
  });
export const CompleteScaleCalibrationRequestSchema = z.strictObject({
  referenceWeightDecigrams: CalibrationReferenceDecigramsSchema,
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

export const SelectedControllerSchema = z.enum(["legacy_curve", "pi"]);
export const ControllerSaturationSchema = z.enum(["none", "lower", "upper"]);
export const ControllerOperatingModeSchema = z.enum([
  "warmup",
  "idle_stable",
  "brewing",
  "post_brew_recovery",
  "steam",
  "inhibited",
  "fault",
]);
export const ControllerConfigurationSchema = z.strictObject({
  firmwareVersion: DeviceResponseSchema.shape.firmwareVersion,
  selectedController: SelectedControllerSchema,
  piKp: z.number().finite().min(0).max(16),
  piKi: z.number().finite().min(0).max(16),
  filterAlpha: z.number().finite().gt(0).max(1),
  controllerIntervalMs: z.literal(500),
  ssrWindowMs: z.literal(10_000),
});
export const ControllerDiagnosticsSchema = z
  .strictObject({
    temperatureRawC: z.number().finite().min(-40).max(160),
    temperatureFilteredC: z.number().finite().min(-40).max(180),
    baseTargetC: z.number().finite().min(0).max(STEAM_TARGET_MAX_C),
    privateTargetC: z.number().finite().min(0).max(STEAM_TARGET_MAX_C),
    errorC: z.number().finite().min(-200).max(200),
    selectedController: SelectedControllerSchema,
    legacyRequestedDuty: z.number().finite().min(0).max(1),
    piRequestedDuty: z.number().finite().min(0).max(1),
    proportionalContribution: z.number().finite().min(-16).max(16),
    integralContribution: z.number().finite().min(-16).max(16),
    integralState: z.number().finite().min(-10_000).max(10_000),
    piSaturation: ControllerSaturationSchema,
    piAntiWindupActive: z.boolean(),
    heaterCommandActive: z.boolean(),
    deliveredCommandDuty1s: z.number().finite().min(0).max(1),
    pumpCommand: PumpCommandSchema,
    extractionPhase: ExtractionPhaseSchema,
    operatingMode: ControllerOperatingModeSchema,
  })
  .superRefine((diagnostics, context) => {
    const expectedError =
      diagnostics.privateTargetC - diagnostics.temperatureFilteredC;
    if (Math.abs(diagnostics.errorC - expectedError) > 0.011) {
      context.addIssue({
        code: "custom",
        path: ["errorC"],
        message:
          "Controller error must equal the private target minus filtered temperature.",
      });
    }
    if (
      diagnostics.piAntiWindupActive &&
      diagnostics.piSaturation === "none"
    ) {
      context.addIssue({
        code: "custom",
        path: ["piAntiWindupActive"],
        message: "PI anti-windup requires a saturated PI output.",
      });
    }
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
  steamControl: SteamControlStateSchema,
  controllerDiagnostics: ControllerDiagnosticsSchema,
};

export const HistorySampleSchema = z
  .discriminatedUnion("machineStatus", [
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
  ])
  .superRefine((sample, context) => {
    if (
      sample.controllerDiagnostics.heaterCommandActive !== sample.heaterActive
    ) {
      context.addIssue({
        code: "custom",
        path: ["controllerDiagnostics", "heaterCommandActive"],
        message:
          "Controller heater command must match the acknowledged history command.",
      });
    }
    if (
      (sample.controllerDiagnostics.pumpCommand === "running") !==
      sample.pumpActive
    ) {
      context.addIssue({
        code: "custom",
        path: ["controllerDiagnostics", "pumpCommand"],
        message:
          "Controller pump command must match the acknowledged history command.",
      });
    }
  });

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
    controllerConfiguration: ControllerConfigurationSchema,
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
    for (const [index, sample] of page.samples.entries()) {
      if (
        sample.controllerDiagnostics.selectedController !==
        page.controllerConfiguration.selectedController
      ) {
        context.addIssue({
          code: "custom",
          path: ["samples", index, "controllerDiagnostics", "selectedController"],
          message:
            "Every sample must identify the page's compile-time Brew controller.",
        });
      }
    }
  });

const TimedExtractionStartRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema,
  selection: ExtractionSelectionSchema,
});
const WeightedExtractionStartRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema,
  selection: ProfileExtractionSelectionSchema,
  weightControl: WeightControlSchema,
});
export const StartExtractionRequestSchema = z.union([
  TimedExtractionStartRequestSchema,
  WeightedExtractionStartRequestSchema,
]);
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
  "scale_not_calibrated",
  "scale_not_stable",
  "scale_unavailable",
  "scale_warning_unacknowledged",
  "calibration_in_progress",
  "heater_disabled",
  "temperature_calibration_active",
  "temperature_calibration_inactive",
  "temperature_calibration_session_mismatch",
  "temperature_calibration_expired",
  "temperature_target_unsafe",
  "stream_unavailable",
  "stream_busy",
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
export type SteamControlSettings = z.infer<
  typeof SteamControlSettingsSchema
>;
export type SteamControlSettingsRequest = z.infer<
  typeof SteamControlSettingsRequestSchema
>;
export type SteamControlState = z.infer<typeof SteamControlStateSchema>;
export type TemperatureSettingsRequest = z.infer<
  typeof TemperatureSettingsRequestSchema
>;
export type TemperatureSettingsResponse = z.infer<
  typeof TemperatureSettingsResponseSchema
>;
export type TemperatureCalibrationSessionId = z.infer<
  typeof TemperatureCalibrationSessionIdSchema
>;
export type TemperatureCalibrationStatus = z.infer<
  typeof TemperatureCalibrationStatusSchema
>;
export type TemperatureCalibrationCandidateRawTarget = z.infer<
  typeof TemperatureCalibrationCandidateRawTargetSchema
>;
export type TemperatureCalibrationOffset = z.infer<
  typeof TemperatureCalibrationOffsetSchema
>;
export type TemperatureCalibrationSafeTargetBounds = z.infer<
  typeof TemperatureCalibrationSafeTargetBoundsSchema
>;
export type UncalibratedTemperatureCalibrationState = z.infer<
  typeof UncalibratedTemperatureCalibrationStateSchema
>;
export type ActiveTemperatureCalibrationState = z.infer<
  typeof ActiveTemperatureCalibrationStateSchema
>;
export type CalibratedTemperatureCalibrationState = z.infer<
  typeof CalibratedTemperatureCalibrationStateSchema
>;
export type TemperatureCalibrationState = z.infer<
  typeof TemperatureCalibrationStateSchema
>;
export type UpdateTemperatureCalibrationCandidateRequest = z.infer<
  typeof UpdateTemperatureCalibrationCandidateRequestSchema
>;
export type TemperatureCalibrationSessionRequest = z.infer<
  typeof TemperatureCalibrationSessionRequestSchema
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
export type WeightControl = z.infer<typeof WeightControlSchema>;
export type ScaleAvailability = z.infer<typeof ScaleAvailabilitySchema>;
export type ScaleCalibrationStatus = z.infer<
  typeof ScaleCalibrationStatusSchema
>;
export type ScaleCompletionReason = z.infer<
  typeof ScaleCompletionReasonSchema
>;
export type ActiveWeightExtraction = z.infer<
  typeof ActiveWeightExtractionSchema
>;
export type TerminalWeightExtraction = z.infer<
  typeof TerminalWeightExtractionSchema
>;
export type ScaleState = z.infer<typeof ScaleStateSchema>;
export type ScaleTraceResponse = z.infer<typeof ScaleTraceResponseSchema>;
export type ExtractionTelemetryControlMode = z.infer<
  typeof ExtractionTelemetryControlModeSchema
>;
export type ExtractionTelemetryStatus = z.infer<
  typeof ExtractionTelemetryStatusSchema
>;
export type ExtractionTelemetryPhase = z.infer<
  typeof ExtractionTelemetryPhaseSchema
>;
export type ExtractionTelemetryCursor = z.infer<
  typeof ExtractionTelemetryCursorSchema
>;
export type ExtractionTelemetrySample = z.infer<
  typeof ExtractionTelemetrySampleSchema
>;
export type ExtractionTelemetryPage = z.infer<
  typeof ExtractionTelemetryPageSchema
>;
export type WeightedExtractionTraceCursor = z.infer<
  typeof WeightedExtractionTraceCursorSchema
>;
export type WeightedExtractionTracePage = z.infer<
  typeof WeightedExtractionTracePageSchema
>;
export type WeightedExtractionTracePhase = z.infer<
  typeof WeightedExtractionTracePhaseSchema
>;
export type WeightedExtractionTraceSample = z.infer<
  typeof WeightedExtractionTraceSampleSchema
>;
export type WeightedExtractionTraceStatus = z.infer<
  typeof WeightedExtractionTraceStatusSchema
>;
export type CompleteScaleCalibrationRequest = z.infer<
  typeof CompleteScaleCalibrationRequestSchema
>;
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
export type SelectedController = z.infer<typeof SelectedControllerSchema>;
export type ControllerSaturation = z.infer<
  typeof ControllerSaturationSchema
>;
export type ControllerOperatingMode = z.infer<
  typeof ControllerOperatingModeSchema
>;
export type ControllerConfiguration = z.infer<
  typeof ControllerConfigurationSchema
>;
export type ControllerDiagnostics = z.infer<
  typeof ControllerDiagnosticsSchema
>;
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
