import { z } from "zod";

export const BREW_TARGET_MIN_C = 85;
export const BREW_TARGET_MAX_C = 95;
export const STEAM_TARGET_MIN_C = 110;
export const STEAM_TARGET_MAX_C = 120;
export const STEAM_TIMEOUT_MS = 300_000;
export const EXTRACTION_MAX_DURATION_SECONDS = 60;
export const EXTRACTION_MAX_DURATION_MS =
  EXTRACTION_MAX_DURATION_SECONDS * 1_000;
export const PROFILE_NAME_MAX_LENGTH = 12;
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

export const ExtractionStateSchema = z.union([
  IdleExtractionStateSchema,
  RunningExtractionStateSchema,
]);

export const MachineStateV2Schema = z.strictObject({
  machine: MachineStateSchema,
  extraction: ExtractionStateSchema,
});

export const StartExtractionRequestSchema = z.strictObject({
  idempotencyKey: IdempotencyKeySchema,
  selection: ExtractionSelectionSchema,
});
export const StartExtractionResponseSchema = RunningExtractionStateSchema;
export const StopExtractionResponseSchema = IdleExtractionStateSchema;

export const ApiV2ErrorCodeSchema = z.enum([
  "malformed_request",
  "unauthorized",
  "extraction_active",
  "profile_not_configured",
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
export type RunningExtractionState = z.infer<
  typeof RunningExtractionStateSchema
>;
export type MachineStateV2 = z.infer<typeof MachineStateV2Schema>;
export type StartExtractionRequest = z.infer<
  typeof StartExtractionRequestSchema
>;
export type StartExtractionResponse = z.infer<
  typeof StartExtractionResponseSchema
>;
export type StopExtractionResponse = z.infer<typeof StopExtractionResponseSchema>;
export type ApiV2ErrorCode = z.infer<typeof ApiV2ErrorCodeSchema>;
export type ApiV2ErrorResponse = z.infer<typeof ApiV2ErrorResponseSchema>;
export type ExtractionActiveConflictResponse = z.infer<
  typeof ExtractionActiveConflictResponseSchema
>;
