import { z } from "zod";

export const BREW_TARGET_MIN_C = 85;
export const BREW_TARGET_MAX_C = 95;
export const STEAM_TARGET_MIN_C = 110;
export const STEAM_TARGET_MAX_C = 120;
export const STEAM_TIMEOUT_MS = 300_000;

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
