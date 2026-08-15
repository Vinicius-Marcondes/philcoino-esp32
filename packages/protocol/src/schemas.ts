import { z } from "zod";

export const BREW_TARGET_MIN_C = 85;
export const BREW_TARGET_MAX_C = 95;
export const STEAM_TARGET_MIN_C = 110;
export const STEAM_TARGET_MAX_C = 135;
export const STEAM_TIMEOUT_MS = 300_000;
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
export const TemperatureSensorSchema = z.enum(["boiler", "steam"]);
export const MachineStatusSchema = z.enum(["heating", "ready", "fault"]);
export const FaultCodeSchema = z.enum([
  "sensor_failure",
  "over_temperature",
  "heating_timeout",
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
  apiVersion: z.literal("4"),
  firmwareVersion: z.string().min(1).max(32),
});

export const FaultSchema = z.strictObject({
  code: FaultCodeSchema,
  message: z.string().min(1).max(160),
  sensor: TemperatureSensorSchema.nullable(),
});

export const SteamReadyTimeoutSchema = z
  .number()
  .int()
  .min(STEAM_READY_TIMEOUT_MIN_MS)
  .max(STEAM_READY_TIMEOUT_MAX_MS)
  .multipleOf(STEAM_SETTING_TIME_STEP_MS);
const machineStateShape = {
  activeMode: ModeSchema,
  boilerTemperatureC: z.number().finite().min(-60).max(180).nullable(),
  steamTemperatureC: z.number().finite().min(-60).max(180).nullable(),
  brewTargetC: BrewTargetSchema,
  steamTargetC: SteamTargetSchema,
  steamReadyTimeoutMs: SteamReadyTimeoutSchema,
  heaterEnabled: z.boolean(),
  heaterActive: z.boolean(),
  steamTimeoutRemainingMs: z
    .number()
    .int()
    .nonnegative()
    .max(STEAM_READY_TIMEOUT_MAX_MS)
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
    minimumC: z.number().int(),
    maximumC: z.number().int(),
  })
  .refine(
    (bounds) => bounds.maximumC >= bounds.minimumC,
    { message: "Safe target maxima must not be below their minima." },
  );

const temperatureCalibrationStateShape = {
  sensor: TemperatureSensorSchema,
  savedOffsetC: TemperatureCalibrationOffsetSchema,
  temperatureRawC: z.number().finite().min(-40).max(160).nullable(),
  temperatureC: z.number().finite().min(-60).max(170).nullable(),
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
export const TemperatureCalibrationsSchema = z
  .strictObject({
    boiler: TemperatureCalibrationStateSchema,
    steam: TemperatureCalibrationStateSchema,
  })
  .superRefine((calibrations, context) => {
    if (calibrations.boiler.sensor !== "boiler") {
      context.addIssue({
        code: "custom",
        path: ["boiler", "sensor"],
        message: "The Boiler calibration must identify the Boiler sensor.",
      });
    }
    if (calibrations.steam.sensor !== "steam") {
      context.addIssue({
        code: "custom",
        path: ["steam", "sensor"],
        message: "The Steam calibration must identify the Steam sensor.",
      });
    }
  });
export const UpdateTemperatureCalibrationCandidateRequestSchema =
  z.strictObject({
    calibrationId: TemperatureCalibrationSessionIdSchema,
    candidateRawTargetC: TemperatureCalibrationCandidateRawTargetSchema,
  });
export const TemperatureCalibrationSessionRequestSchema = z.strictObject({
  calibrationId: TemperatureCalibrationSessionIdSchema,
});

export const ModeRequestSchema = z.strictObject({
  mode: ModeSchema,
});

export const HeaterSettingsRequestSchema = z.strictObject({
  enabled: z.boolean(),
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

export const ManualExtractionSelectionSchema = z.strictObject({
  kind: z.literal("manual"),
});

export const ProfileExtractionSelectionSchema = z.strictObject({
  kind: z.literal("profile"),
  profileId: ProfileSlotIdSchema,
  profile: ExtractionProfileSchema,
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

const workflowStateShape = {
  machine: MachineStateSchema,
  extraction: ExtractionStateSchema,
  compensation: CompensationStateSchema,
  cooldown: CooldownStateSchema,
};
const WorkflowStateSchema = z.strictObject(workflowStateShape);

function refineWorkflowState(
  state: z.infer<typeof WorkflowStateSchema>,
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

export const GrossWeightDecigramsSchema = z.number().int().min(-500).max(10_500);
export const NetWeightDecigramsSchema = z.number().int().min(-11_000).max(11_000);
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
  netWeightDecigrams: NetWeightDecigramsSchema.nullable(),
});
export const TerminalWeightExtractionSchema = z.strictObject({
  extractionId: ExtractionIdSchema,
  targetWeightDecigrams: WeightTargetDecigramsSchema,
  compensationDecigrams: WeightCompensationDecigramsSchema,
  cutoffWeightDecigrams: z.number().int().min(1).max(WEIGHT_TARGET_MAX_DECIGRAMS),
  finalWeightDecigrams: NetWeightDecigramsSchema.nullable(),
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
  grossWeightDecigrams: GrossWeightDecigramsSchema.nullable(),
  netWeightDecigrams: NetWeightDecigramsSchema.nullable(),
  activeExtraction: ActiveWeightExtractionSchema.nullable(),
  terminalExtraction: TerminalWeightExtractionSchema.nullable(),
  warning: ScaleWarningSchema.nullable(),
});

export const TelemetrySequenceSchema = z
  .number()
  .int()
  .nonnegative()
  .safe();
export const BootIdSchema = z.string().length(32).regex(/^[0-9a-f]{32}$/);

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
  bootId: BootIdSchema,
  afterSequence: TelemetrySequenceSchema,
});
export const ExtractionTelemetrySampleSchema = z.strictObject({
  sequence: TelemetrySequenceSchema,
  uptimeMs: z.number().int().nonnegative().safe(),
  elapsedMs: z
    .number()
    .int()
    .nonnegative()
    .max(EXTRACTION_MAX_DURATION_MS + EXTRACTION_TELEMETRY_SETTLING_LIMIT_MS),
  extractionElapsedMs: ExtractionElapsedMsSchema,
  phase: ExtractionTelemetryPhaseSchema,
  boilerTemperatureC: z.number().finite().min(-60).max(180).nullable(),
  steamTemperatureC: z.number().finite().min(-60).max(180).nullable(),
  activeTargetC: BrewTargetSchema,
  heaterActive: z.boolean(),
  pumpCommand: PumpCommandSchema,
  scaleAvailability: ScaleAvailabilitySchema,
  netWeightDecigrams: NetWeightDecigramsSchema.nullable(),
});
export const ExtractionTelemetryPageSchema = z
  .strictObject({
    version: z.literal(2),
    deviceId: DeviceResponseSchema.shape.deviceId,
    extractionId: ExtractionIdSchema,
    bootId: ExtractionTelemetryCursorSchema.shape.bootId,
    capturedAtUptimeMs: z.number().int().nonnegative().safe(),
    selection: ExtractionSelectionSchema,
    controlMode: ExtractionTelemetryControlModeSchema,
    weightControl: WeightControlSchema.nullable(),
    baselineWeightDecigrams: GrossWeightDecigramsSchema.nullable(),
    status: ExtractionTelemetryStatusSchema,
    outcome: ExtractionOutcomeSchema.nullable(),
    terminalWeight: TerminalWeightExtractionSchema.nullable(),
    oldestSequence: TelemetrySequenceSchema,
    latestSequence: TelemetrySequenceSchema,
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

export const Base64Url256Schema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]{43}$/);

const Base64Url96Schema = z
  .string()
  .length(16)
  .regex(/^[A-Za-z0-9_-]{16}$/);

const Base64Url512Schema = z
  .string()
  .length(86)
  .regex(/^[A-Za-z0-9_-]{86}$/);

const SrpPublicKeySchema = z
  .string()
  .min(2)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((value) => value.length % 4 !== 1, "Malformed Base64URL value.");

const SrpSaltSchema = z
  .string()
  .min(22)
  .max(86)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((value) => value.length % 4 !== 1, "Malformed Base64URL value.");

const EncryptedPairingBindingSchema = z
  .string()
  .min(23)
  .max(1024)
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((value) => value.length % 4 !== 1, "Malformed Base64URL value.");

export const PairingSessionIdSchema = z
  .string()
  .length(32)
  .regex(/^[0-9a-f]{32}$/);

export const PairingClientIdSchema = z
  .string()
  .length(32)
  .regex(/^[0-9a-f]{32}$/);

export const PairingSessionStartRequestSchema = z.strictObject({
  clientName: z.string().trim().min(1).max(64),
  clientNonce: Base64Url256Schema,
  clientPublicKey: SrpPublicKeySchema,
});

export const PairingSessionStartResponseSchema = z.strictObject({
  sessionId: PairingSessionIdSchema,
  device: DeviceResponseSchema,
  serverPublicKey: SrpPublicKeySchema,
  salt: SrpSaltSchema,
  expiresAtUptimeMs: z.number().int().nonnegative().safe(),
});

export const PairingSessionProofRequestSchema = z.strictObject({
  clientProof: Base64Url512Schema,
});

export const PairingSessionProofResponseSchema = z.strictObject({
  serverProof: Base64Url512Schema,
  deviceNonce: Base64Url96Schema,
  encryptedDeviceBinding: EncryptedPairingBindingSchema,
});

export const PairingSessionCompleteRequestSchema = z.strictObject({
  clientId: PairingClientIdSchema,
  encryptedClientBinding: EncryptedPairingBindingSchema,
});

export const PairingCompleteResponseSchema = z.strictObject({
  device: DeviceResponseSchema,
  clientId: PairingClientIdSchema,
  accessToken: Base64Url256Schema,
  certificateSpkiSha256: Base64Url256Schema,
});

export const PairingDeviceBindingSchema = z.strictObject({
  domain: z.literal("philcoino:v4:device-binding"),
  sessionId: PairingSessionIdSchema,
  clientNonce: Base64Url256Schema,
  deviceId: DeviceResponseSchema.shape.deviceId,
  certificateSpkiSha256: Base64Url256Schema,
});

export const PairingClientBindingSchema = z.strictObject({
  domain: z.literal("philcoino:v4:client-binding"),
  sessionId: PairingSessionIdSchema,
  clientId: PairingClientIdSchema,
  clientNonce: Base64Url256Schema,
  deviceId: DeviceResponseSchema.shape.deviceId,
  certificateSpkiSha256: Base64Url256Schema,
});

export const SettingsRequestSchema = z
  .strictObject({
    brewTargetC: BrewTargetSchema.optional(),
    steamTargetC: SteamTargetSchema.optional(),
    steamReadyTimeoutMs: SteamReadyTimeoutSchema.optional(),
  })
  .refine((settings) => Object.values(settings).some((value) => value !== undefined), {
    message: "At least one setting is required.",
  });

const RevisionSchema = z.number().int().nonnegative().safe();

export const MachineStateV4Schema = z
  .strictObject({
    apiVersion: z.literal("4"),
    device: DeviceResponseSchema,
    bootId: BootIdSchema,
    revision: RevisionSchema,
    capturedAtUptimeMs: z.number().int().nonnegative().safe(),
    machine: MachineStateSchema,
    scale: ScaleStateSchema,
    temperatureCalibrations: TemperatureCalibrationsSchema,
    extraction: ExtractionStateSchema,
    compensation: CompensationStateSchema,
    cooldown: CooldownStateSchema,
  })
  .superRefine((state, context) =>
    refineWorkflowState(
      {
        machine: state.machine,
        extraction: state.extraction,
        compensation: state.compensation,
        cooldown: state.cooldown,
      },
      context,
    ),
  );

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
export const StartCooldownRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema,
});

export const FirmwareUpdateAcceptedSchema = z.strictObject({
  status: z.literal("accepted"),
  rebooting: z.literal(true),
  bytesWritten: z.number().int().min(1).max(1_966_080),
});

export const ApiErrorCodeSchema = z.enum([
  "malformed_request",
  "unauthorized",
  "pairing_busy",
  "pairing_session_expired",
  "pairing_session_replayed",
  "pairing_stage_mismatch",
  "invalid_pairing_code",
  "extraction_active",
  "cooldown_active",
  "brew_mode_required",
  "cooldown_not_required",
  "sensor_unavailable",
  "machine_faulted",
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
  "firmware_update_unavailable",
  "firmware_metadata_invalid",
  "unsupported_media_type",
  "firmware_image_too_large",
  "firmware_update_busy",
  "output_shutdown_failed",
  "firmware_digest_mismatch",
  "firmware_image_invalid",
  "firmware_update_failed",
  "persistence_failure",
  "internal_error",
]);
export const ApiErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: ApiErrorCodeSchema,
    message: z.string().min(1).max(160),
  }),
});
export type Mode = z.infer<typeof ModeSchema>;
export type TemperatureSensor = z.infer<typeof TemperatureSensorSchema>;
export type MachineStatus = z.infer<typeof MachineStatusSchema>;
export type FaultCode = z.infer<typeof FaultCodeSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type DeviceResponse = z.infer<typeof DeviceResponseSchema>;
export type Fault = z.infer<typeof FaultSchema>;
export type MachineState = z.infer<typeof MachineStateSchema>;
export type TemperatureSettingsRequest = z.infer<
  typeof TemperatureSettingsRequestSchema
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
export type TemperatureCalibrations = z.infer<
  typeof TemperatureCalibrationsSchema
>;
export type UpdateTemperatureCalibrationCandidateRequest = z.infer<
  typeof UpdateTemperatureCalibrationCandidateRequestSchema
>;
export type TemperatureCalibrationSessionRequest = z.infer<
  typeof TemperatureCalibrationSessionRequestSchema
>;
export type ModeRequest = z.infer<typeof ModeRequestSchema>;
export type HeaterSettingsRequest = z.infer<
  typeof HeaterSettingsRequestSchema
>;
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
export type CompleteScaleCalibrationRequest = z.infer<
  typeof CompleteScaleCalibrationRequestSchema
>;
export type ProfileSlotId = z.infer<typeof ProfileSlotIdSchema>;
export type ProfileName = z.infer<typeof ProfileNameSchema>;
export type ExtractionProfile = z.infer<typeof ExtractionProfileSchema>;
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
export type MachineStateV4 = z.infer<typeof MachineStateV4Schema>;
export type PairingSessionStartRequest = z.infer<typeof PairingSessionStartRequestSchema>;
export type PairingSessionStartResponse = z.infer<typeof PairingSessionStartResponseSchema>;
export type PairingSessionProofRequest = z.infer<typeof PairingSessionProofRequestSchema>;
export type PairingSessionProofResponse = z.infer<typeof PairingSessionProofResponseSchema>;
export type PairingSessionCompleteRequest = z.infer<typeof PairingSessionCompleteRequestSchema>;
export type PairingCompleteResponse = z.infer<typeof PairingCompleteResponseSchema>;
export type PairingDeviceBinding = z.infer<typeof PairingDeviceBindingSchema>;
export type PairingClientBinding = z.infer<typeof PairingClientBindingSchema>;
export type SettingsRequest = z.infer<typeof SettingsRequestSchema>;
export type StartExtractionRequest = z.infer<
  typeof StartExtractionRequestSchema
>;
export type StartCooldownRequest = z.infer<typeof StartCooldownRequestSchema>;
export type FirmwareUpdateAccepted = z.infer<
  typeof FirmwareUpdateAcceptedSchema
>;
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
