import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";

import {
  ActiveCompensationStateSchema,
  ActiveCooldownStateSchema,
  ApiV2ErrorCodeSchema,
  ApiV2ErrorResponseSchema,
  BREW_TARGET_MAX_C,
  BREW_TARGET_MIN_C,
  BrewTargetSchema,
  COOLDOWN_MAX_DURATION_MS,
  COOLDOWN_PUMP_LIMIT_MS,
  COOLDOWN_STABILIZATION_MS,
  CompensationPhaseSchema,
  CompensationStateSchema,
  CooldownActiveConflictResponseSchema,
  CooldownOutcomeSchema,
  CooldownStateSchema,
  CooldownStatusSchema,
  DeviceResponseSchema,
  ErrorCodeSchema,
  ErrorResponseSchema,
  EXTRACTION_MAX_DURATION_MS,
  EXTRACTION_MAX_DURATION_SECONDS,
  ExtractionActiveConflictResponseSchema,
  ExtractionPhaseSchema,
  ExtractionProfileSchema,
  ExtractionStateSchema,
  FaultCodeSchema,
  HeaterSettingsRequestSchema,
  HeaterSettingsResponseSchema,
  HealthResponseSchema,
  IdempotencyKeySchema,
  IdleCooldownStateSchema,
  IdleExtractionStateSchema,
  InactiveCompensationStateSchema,
  MachineStateSchema,
  MachineStateV2Schema,
  MachineStatusSchema,
  ModeRequestSchema,
  ModeResponseSchema,
  ModeSchema,
  OverTemperatureDismissResponseSchema,
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_SLOT_IDS,
  ProfileNameSchema,
  ProfileSetSchema,
  ProfileSlotIdSchema,
  PumpCommandSchema,
  PumpingCooldownStateSchema,
  RunningExtractionStateSchema,
  STEAM_TARGET_MAX_C,
  STEAM_TARGET_MIN_C,
  SteamTargetSchema,
  StartExtractionRequestSchema,
  StartCooldownRequestSchema,
  StabilizingCooldownStateSchema,
  TemperatureSettingsRequestSchema,
  TemperatureSettingsResponseSchema,
} from "../src/index.ts";

type OpenApiSchema = {
  description?: string;
  enum?: unknown[];
  examples?: unknown[];
  maximum?: number;
  minimum?: number;
  properties?: Record<string, OpenApiSchema>;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: {
    schemas: Record<string, OpenApiSchema>;
  };
};

async function fixture(path: string): Promise<unknown> {
  return Bun.file(new URL(`../fixtures/${path}`, import.meta.url)).json();
}

const openApi = JSON.parse(
  await Bun.file(new URL("../openapi.yaml", import.meta.url)).text(),
) as OpenApiDocument;

const documentedSchemas: Record<string, ZodType> = {
  HealthResponse: HealthResponseSchema,
  DeviceResponse: DeviceResponseSchema,
  MachineState: MachineStateSchema,
  TemperatureSettingsRequest: TemperatureSettingsRequestSchema,
  TemperatureSettingsResponse: TemperatureSettingsResponseSchema,
  ModeRequest: ModeRequestSchema,
  ModeResponse: ModeResponseSchema,
  HeaterSettingsRequest: HeaterSettingsRequestSchema,
  HeaterSettingsResponse: HeaterSettingsResponseSchema,
  OverTemperatureDismissResponse: OverTemperatureDismissResponseSchema,
  ErrorResponse: ErrorResponseSchema,
  ProfileSet: ProfileSetSchema,
  IdleExtractionState: IdleExtractionStateSchema,
  RunningExtractionState: RunningExtractionStateSchema,
  MachineStateV2: MachineStateV2Schema,
  StartExtractionRequest: StartExtractionRequestSchema,
  ApiV2ErrorResponse: ApiV2ErrorResponseSchema,
  ExtractionActiveConflictResponse: ExtractionActiveConflictResponseSchema,
  InactiveCompensationState: InactiveCompensationStateSchema,
  ActiveCompensationState: ActiveCompensationStateSchema,
  IdleCooldownState: IdleCooldownStateSchema,
  PumpingCooldownState: PumpingCooldownStateSchema,
  StabilizingCooldownState: StabilizingCooldownStateSchema,
  StartCooldownRequest: StartCooldownRequestSchema,
  CooldownActiveConflictResponse: CooldownActiveConflictResponseSchema,
};

const validFixtures = [
  ["valid/health.json", HealthResponseSchema],
  ["valid/device.json", DeviceResponseSchema],
  ["valid/state.json", MachineStateSchema],
  ["valid/state-fault.json", MachineStateSchema],
  ["valid/temperatures-request.json", TemperatureSettingsRequestSchema],
  ["valid/temperatures-response.json", TemperatureSettingsResponseSchema],
  ["valid/mode-request.json", ModeRequestSchema],
  ["valid/mode-response.json", ModeResponseSchema],
  ["valid/heater-request.json", HeaterSettingsRequestSchema],
  ["valid/heater-response.json", HeaterSettingsResponseSchema],
  ["valid/error.json", ErrorResponseSchema],
  ["valid/profile-set.json", ProfileSetSchema],
  ["valid/extraction-idle.json", IdleExtractionStateSchema],
  ["valid/extraction-running.json", RunningExtractionStateSchema],
  ["valid/extraction-start-request.json", StartExtractionRequestSchema],
  [
    "valid/extraction-active-conflict.json",
    ExtractionActiveConflictResponseSchema,
  ],
  ["valid/compensation-inactive.json", InactiveCompensationStateSchema],
  ["valid/compensation-active.json", ActiveCompensationStateSchema],
  ["valid/cooldown-idle.json", IdleCooldownStateSchema],
  ["valid/cooldown-pumping.json", PumpingCooldownStateSchema],
  ["valid/cooldown-stabilizing.json", StabilizingCooldownStateSchema],
  ["valid/cooldown-terminal-replay.json", IdleCooldownStateSchema],
  ["valid/cooldown-start-request.json", StartCooldownRequestSchema],
  ["valid/cooldown-active-conflict.json", CooldownActiveConflictResponseSchema],
  ["valid/brew-mode-required-error.json", ApiV2ErrorResponseSchema],
  ["valid/profile-not-configured-error.json", ApiV2ErrorResponseSchema],
  ["valid/cooldown-not-required-error.json", ApiV2ErrorResponseSchema],
  ["valid/cooldown-sensor-unavailable-error.json", ApiV2ErrorResponseSchema],
  ["valid/cooldown-machine-faulted-error.json", ApiV2ErrorResponseSchema],
  ["valid/machine-v2-failed-cooldown.json", MachineStateV2Schema],
] as const;

const invalidFixtures = [
  ["invalid/device-api-version.json", DeviceResponseSchema],
  ["invalid/state-extra-property.json", MachineStateSchema],
  ["invalid/state-legacy-temperatures.json", MachineStateSchema],
  ["invalid/state-fault-heater-active.json", MachineStateSchema],
  ["invalid/state-fault-without-details.json", MachineStateSchema],
  ["invalid/temperatures-request-empty.json", TemperatureSettingsRequestSchema],
  ["invalid/brew-target-too-low.json", TemperatureSettingsRequestSchema],
  ["invalid/brew-target-fractional.json", TemperatureSettingsRequestSchema],
  ["invalid/steam-target-too-high.json", TemperatureSettingsRequestSchema],
  ["invalid/mode-invalid.json", ModeRequestSchema],
  ["invalid/heater-invalid.json", HeaterSettingsRequestSchema],
  ["invalid/error-extra-property.json", ErrorResponseSchema],
  ["invalid/profile-name-symbol.json", ExtractionProfileSchema],
  ["invalid/profile-name-too-long.json", ExtractionProfileSchema],
  ["invalid/profile-fractional-duration.json", ExtractionProfileSchema],
  ["invalid/profile-soak-without-preinfusion.json", ExtractionProfileSchema],
  ["invalid/profile-duration-overflow.json", ExtractionProfileSchema],
  ["invalid/profile-set-duplicate-slot.json", ProfileSetSchema],
  ["invalid/profile-set-extra-slot.json", ProfileSetSchema],
  ["invalid/extraction-start-key-short.json", StartExtractionRequestSchema],
  ["invalid/extraction-running-wrong-command.json", ExtractionStateSchema],
  [
    "invalid/extraction-conflict-with-idle.json",
    ExtractionActiveConflictResponseSchema,
  ],
  ["invalid/compensation-active-preinfusion.json", CompensationStateSchema],
  ["invalid/compensation-extra-property.json", CompensationStateSchema],
  ["invalid/cooldown-pumping-wrong-command.json", CooldownStateSchema],
  ["invalid/cooldown-pumping-inconsistent-timing.json", CooldownStateSchema],
  ["invalid/cooldown-pumping-time-overflow.json", CooldownStateSchema],
  [
    "invalid/cooldown-stabilizing-failed-outcome.json",
    CooldownStateSchema,
  ],
  ["invalid/cooldown-terminal-without-outcome.json", CooldownStateSchema],
  ["invalid/cooldown-start-key-short.json", StartCooldownRequestSchema],
  [
    "invalid/cooldown-conflict-with-idle.json",
    CooldownActiveConflictResponseSchema,
  ],
  ["invalid/machine-v2-steam-extraction.json", MachineStateV2Schema],
  ["invalid/machine-v2-active-workflows.json", MachineStateV2Schema],
  ["invalid/machine-v2-compensation-disabled.json", MachineStateV2Schema],
  [
    "invalid/machine-v2-failed-cooldown-without-fault.json",
    MachineStateV2Schema,
  ],
] as const;

describe("contract fixtures", () => {
  for (const [path, schema] of validFixtures) {
    test(`${path} parses`, async () => {
      expect(schema.safeParse(await fixture(path)).success).toBe(true);
    });
  }

  for (const [path, schema] of invalidFixtures) {
    test(`${path} is rejected`, async () => {
      expect(schema.safeParse(await fixture(path)).success).toBe(false);
    });
  }
});

describe("documented OpenAPI examples", () => {
  for (const [schemaName, zodSchema] of Object.entries(documentedSchemas)) {
    test(`${schemaName} examples parse with Zod`, () => {
      const examples = openApi.components.schemas[schemaName]?.examples;

      expect(examples?.length).toBeGreaterThan(0);
      for (const example of examples ?? []) {
        expect(zodSchema.safeParse(example).success).toBe(true);
      }
    });
  }

  test("examples remain aligned with valid fixtures", async () => {
    const fixturesBySchema = {
      HealthResponse: [await fixture("valid/health.json")],
      DeviceResponse: [await fixture("valid/device.json")],
      MachineState: [
        await fixture("valid/state.json"),
        await fixture("valid/state-fault.json"),
      ],
      TemperatureSettingsRequest: [
        await fixture("valid/temperatures-request.json"),
      ],
      TemperatureSettingsResponse: [
        await fixture("valid/temperatures-response.json"),
      ],
      ModeRequest: [await fixture("valid/mode-request.json")],
      ModeResponse: [await fixture("valid/mode-response.json")],
      HeaterSettingsRequest: [await fixture("valid/heater-request.json")],
      HeaterSettingsResponse: [await fixture("valid/heater-response.json")],
      OverTemperatureDismissResponse: [
        openApi.components.schemas.OverTemperatureDismissResponse.examples?.[0],
      ],
      ErrorResponse: [await fixture("valid/error.json")],
      ProfileSet: [await fixture("valid/profile-set.json")],
      IdleExtractionState: [await fixture("valid/extraction-idle.json")],
      RunningExtractionState: [await fixture("valid/extraction-running.json")],
      MachineStateV2: [
        openApi.components.schemas.MachineStateV2.examples?.[0],
      ],
      StartExtractionRequest: [
        await fixture("valid/extraction-start-request.json"),
      ],
      ApiV2ErrorResponse: [
        await fixture("valid/profile-not-configured-error.json"),
        await fixture("valid/brew-mode-required-error.json"),
        await fixture("valid/cooldown-not-required-error.json"),
        await fixture("valid/cooldown-sensor-unavailable-error.json"),
        await fixture("valid/cooldown-machine-faulted-error.json"),
      ],
      ExtractionActiveConflictResponse: [
        await fixture("valid/extraction-active-conflict.json"),
      ],
      InactiveCompensationState: [
        await fixture("valid/compensation-inactive.json"),
      ],
      ActiveCompensationState: [
        await fixture("valid/compensation-active.json"),
      ],
      IdleCooldownState: [
        await fixture("valid/cooldown-idle.json"),
        await fixture("valid/cooldown-terminal-replay.json"),
      ],
      PumpingCooldownState: [await fixture("valid/cooldown-pumping.json")],
      StabilizingCooldownState: [
        await fixture("valid/cooldown-stabilizing.json"),
      ],
      StartCooldownRequest: [
        await fixture("valid/cooldown-start-request.json"),
      ],
      CooldownActiveConflictResponse: [
        await fixture("valid/cooldown-active-conflict.json"),
      ],
    };

    for (const [schemaName, examples] of Object.entries(fixturesBySchema)) {
      expect(openApi.components.schemas[schemaName]?.examples).toEqual(examples);
    }
  });

  test("protocol documentation JSON examples parse with Zod", async () => {
    const documentation = await Bun.file(
      new URL("../../../docs/protocol/api-v1-outline.md", import.meta.url),
    ).text();
    const jsonBlocks = [...documentation.matchAll(/```json\n([\s\S]*?)\n```/g)].map(
      ([, json]) => JSON.parse(json),
    );

    expect(jsonBlocks).toHaveLength(2);
    expect(MachineStateSchema.safeParse(jsonBlocks[0]).success).toBe(true);
    expect(ErrorResponseSchema.safeParse(jsonBlocks[1]).success).toBe(true);
  });
});

describe("temperature boundaries and drift", () => {
  test("documents mode-dependent effective boiler temperature semantics", () => {
    const description =
      openApi.components.schemas.MachineState.properties?.boilerTemperatureC
        ?.description;

    expect(description).toContain("Brew mode reports the raw boiler-base reading");
    expect(description).toContain(
      "Steam mode reports that raw reading plus the firmware-configured Steam offset",
    );
    expect(description).toContain(
      "change this value by 5 degrees Celsius without a new physical sensor reading",
    );
  });

  test("accepts every inclusive whole-degree boundary", () => {
    expect(BrewTargetSchema.parse(BREW_TARGET_MIN_C)).toBe(85);
    expect(BrewTargetSchema.parse(BREW_TARGET_MAX_C)).toBe(95);
    expect(SteamTargetSchema.parse(STEAM_TARGET_MIN_C)).toBe(110);
    expect(SteamTargetSchema.parse(STEAM_TARGET_MAX_C)).toBe(120);
  });

  test("rejects adjacent and fractional values", () => {
    for (const value of [84, 85.5, 96]) {
      expect(BrewTargetSchema.safeParse(value).success).toBe(false);
    }

    for (const value of [109, 110.5, 121]) {
      expect(SteamTargetSchema.safeParse(value).success).toBe(false);
    }
  });

  test("OpenAPI limits match exported Zod limits", () => {
    expect(openApi.components.schemas.BrewTarget).toMatchObject({
      minimum: BREW_TARGET_MIN_C,
      maximum: BREW_TARGET_MAX_C,
    });
    expect(openApi.components.schemas.SteamTarget).toMatchObject({
      minimum: STEAM_TARGET_MIN_C,
      maximum: STEAM_TARGET_MAX_C,
    });
  });

  test("OpenAPI enums match exported Zod enums", () => {
    expect(openApi.components.schemas.Mode.enum).toEqual(ModeSchema.options);
    expect(openApi.components.schemas.MachineStatus.enum).toEqual(
      MachineStatusSchema.options,
    );
    expect(openApi.components.schemas.FaultCode.enum).toEqual(
      FaultCodeSchema.options,
    );
    expect(openApi.components.schemas.ErrorCode.enum).toEqual(
      ErrorCodeSchema.options,
    );
  });
});

describe("strict payload handling", () => {
  test("rejects unknown properties", () => {
    expect(
      ModeRequestSchema.safeParse({ mode: "brew", optimistic: true }).success,
    ).toBe(false);
    expect(
      DeviceResponseSchema.safeParse({
        deviceId: "device-1",
        name: "Machine",
        model: "philcoino-esp32-c3",
        apiVersion: "1",
        firmwareVersion: "1.0.0",
        token: "must-not-leak",
      }).success,
    ).toBe(false);
  });

  test("requires at least one temperature target", () => {
    expect(TemperatureSettingsRequestSchema.safeParse({}).success).toBe(false);
    expect(
      TemperatureSettingsRequestSchema.safeParse({ brewTargetC: 93 }).success,
    ).toBe(true);
    expect(
      TemperatureSettingsRequestSchema.safeParse({ steamTargetC: 115 }).success,
    ).toBe(true);
  });
});

describe("API v2 profile boundaries and drift", () => {
  test("keeps exactly four immutable lowercase slot identifiers", () => {
    expect(PROFILE_SLOT_IDS).toEqual([
      "profile-1",
      "profile-2",
      "profile-3",
      "profile-4",
    ]);
    expect(openApi.components.schemas.ProfileSlotId.enum).toEqual(
      ProfileSlotIdSchema.options,
    );
    expect(ProfileSlotIdSchema.safeParse("Profile-1").success).toBe(false);
    expect(ProfileSlotIdSchema.safeParse("profile-5").success).toBe(false);
  });

  test("accepts only bounded ASCII alphanumeric names", () => {
    expect(ProfileNameSchema.parse("A")).toBe("A");
    expect(ProfileNameSchema.parse("Abc123456789")).toHaveLength(
      PROFILE_NAME_MAX_LENGTH,
    );
    for (const name of ["", "Abc1234567890", "Pre 5", "Café", "slot_one"]) {
      expect(ProfileNameSchema.safeParse(name).success).toBe(false);
    }
  });

  test("enforces whole-second phase combinations and total duration", () => {
    const base = {
      name: "Boundary",
      preInfusionSeconds: 5,
      soakSeconds: 5,
      mainExtractionSeconds: 50,
    };
    expect(ExtractionProfileSchema.safeParse(base).success).toBe(true);
    expect(
      ExtractionProfileSchema.safeParse({
        ...base,
        preInfusionSeconds: 0,
        soakSeconds: 0,
        mainExtractionSeconds: EXTRACTION_MAX_DURATION_SECONDS,
      }).success,
    ).toBe(true);
    expect(
      ExtractionProfileSchema.safeParse({ ...base, mainExtractionSeconds: 51 })
        .success,
    ).toBe(false);
    expect(
      ExtractionProfileSchema.safeParse({
        ...base,
        preInfusionSeconds: 0,
        soakSeconds: 1,
      }).success,
    ).toBe(false);
    expect(
      ExtractionProfileSchema.safeParse({
        ...base,
        mainExtractionSeconds: 0,
      }).success,
    ).toBe(false);
  });
});

describe("API v2 extraction acknowledgement boundaries", () => {
  test("requires bounded client-generated idempotency keys", () => {
    expect(IdempotencyKeySchema.safeParse("start-01J2ABCDEF1234").success).toBe(
      true,
    );
    for (const key of ["short", "contains spaces key", `a${"b".repeat(64)}`]) {
      expect(IdempotencyKeySchema.safeParse(key).success).toBe(false);
    }
  });

  test("binds phases to the GPIO command semantics", () => {
    expect(PumpCommandSchema.options).toEqual(["running", "off"]);
    expect(ExtractionPhaseSchema.options).toEqual([
      "idle",
      "manual",
      "pre-infusion",
      "soak",
      "main-extraction",
    ]);
    expect(
      RunningExtractionStateSchema.safeParse({
        status: "running",
        extractionId: "run-1",
        selection: { kind: "profile", profileId: "profile-1" },
        phase: "soak",
        elapsedMs: 5000,
        remainingMs: EXTRACTION_MAX_DURATION_MS - 5000,
        pumpCommand: "off",
      }).success,
    ).toBe(true);
  });

  test("keeps v1 paths temperature-control-only while adding v2", () => {
    const v1Paths = Object.keys(openApi.paths)
      .filter((path) => path.startsWith("/api/v1/"))
      .sort();
    expect(v1Paths).toEqual([
      "/api/v1/device",
      "/api/v1/faults/over-temperature/dismiss",
      "/api/v1/heater",
      "/api/v1/mode",
      "/api/v1/settings/temperatures",
      "/api/v1/state",
    ]);
    expect(v1Paths.some((path) => path.includes("extraction"))).toBe(false);
    expect(ApiV2ErrorCodeSchema.options).toContain("extraction_active");
    expect(ErrorCodeSchema.options).not.toContain("extraction_active");
  });
});

describe("API v2 thermal workflow boundaries", () => {
  test("exposes compensation activity without a runtime bias value", () => {
    expect(CompensationPhaseSchema.options).toEqual([
      "manual",
      "main-extraction",
    ]);
    expect(
      Object.keys(
        openApi.components.schemas.ActiveCompensationState.properties ?? {},
      ),
    ).toEqual(["status", "phase"]);
    expect(
      ActiveCompensationStateSchema.safeParse({
        status: "active",
        phase: "pre-infusion",
      }).success,
    ).toBe(false);
  });

  test("binds cooldown phases to command and inhibit states", () => {
    expect(CooldownStatusSchema.options).toEqual([
      "idle",
      "pumping",
      "stabilizing",
    ]);
    expect(CooldownOutcomeSchema.options).toEqual([
      "target-reached",
      "cutoff",
      "stopped",
      "failed",
    ]);
    expect(ActiveCooldownStateSchema.safeParse({
      status: "pumping",
      cooldownId: "cooldown-boundary",
      brewTargetC: 93,
      elapsedMs: COOLDOWN_PUMP_LIMIT_MS,
      remainingMs: 0,
      pumpCommand: "running",
      heaterInhibited: true,
      outcome: null,
    }).success).toBe(true);
    expect(StabilizingCooldownStateSchema.safeParse({
      status: "stabilizing",
      cooldownId: "cooldown-boundary",
      brewTargetC: 93,
      elapsedMs: COOLDOWN_MAX_DURATION_MS,
      remainingMs: 0,
      pumpCommand: "off",
      heaterInhibited: true,
      outcome: "cutoff",
    }).success).toBe(true);
    expect(COOLDOWN_STABILIZATION_MS).toBe(5_000);
  });

  test("requires strict cooldown idempotency keys", () => {
    expect(
      StartCooldownRequestSchema.safeParse({
        idempotencyKey: "cooldown-01J2ABCDEF1",
      }).success,
    ).toBe(true);
    expect(
      StartCooldownRequestSchema.safeParse({
        idempotencyKey: "cooldown-01J2ABCDEF1",
        restartDeadline: true,
      }).success,
    ).toBe(false);
  });

  test("documents replay as returning retained state without a new deadline", () => {
    const operation = openApi.paths["/api/v2/cooldowns/start"]?.post;
    const description = operation?.description;
    const responseSchema = (
      operation?.responses as Record<
        string,
        { content?: Record<string, { schema?: { $ref?: string } }> }
      >
    )?.["200"]?.content?.["application/json"]?.schema;

    expect(description).toContain("without restarting the 45-second pump deadline");
    expect(responseSchema?.$ref).toBe("#/components/schemas/CooldownState");
  });

  test("keeps workflow conflicts distinguishable and versioned", () => {
    expect(ApiV2ErrorCodeSchema.options).toEqual(
      openApi.components.schemas.ApiV2ErrorCode.enum,
    );
    for (const code of [
      "brew_mode_required",
      "cooldown_active",
      "cooldown_not_required",
      "machine_faulted",
    ]) {
      expect(ApiV2ErrorCodeSchema.options).toContain(code);
      expect(ErrorCodeSchema.options).not.toContain(code);
    }
    expect(ApiV2ErrorCodeSchema.options).toContain("sensor_unavailable");
    expect(ErrorCodeSchema.options).toContain("sensor_unavailable");
  });

  test("adds only the approved API v2 cooldown paths", () => {
    const v2Paths = Object.keys(openApi.paths)
      .filter((path) => path.startsWith("/api/v2/"))
      .sort();
    expect(v2Paths).toEqual([
      "/api/v2/cooldowns/start",
      "/api/v2/cooldowns/stop",
      "/api/v2/extractions/start",
      "/api/v2/extractions/stop",
      "/api/v2/profiles",
      "/api/v2/state",
    ]);
  });
});
