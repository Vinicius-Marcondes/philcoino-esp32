import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";

import {
  BREW_TARGET_MAX_C,
  BREW_TARGET_MIN_C,
  BrewTargetSchema,
  DeviceResponseSchema,
  ErrorCodeSchema,
  ErrorResponseSchema,
  FaultCodeSchema,
  HealthResponseSchema,
  MachineStateSchema,
  MachineStatusSchema,
  ModeRequestSchema,
  ModeResponseSchema,
  ModeSchema,
  STEAM_TARGET_MAX_C,
  STEAM_TARGET_MIN_C,
  SteamTargetSchema,
  TemperatureSettingsRequestSchema,
  TemperatureSettingsResponseSchema,
} from "../src/index.ts";

type OpenApiSchema = {
  enum?: unknown[];
  examples?: unknown[];
  maximum?: number;
  minimum?: number;
};

type OpenApiDocument = {
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
  ErrorResponse: ErrorResponseSchema,
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
  ["valid/error.json", ErrorResponseSchema],
] as const;

const invalidFixtures = [
  ["invalid/device-api-version.json", DeviceResponseSchema],
  ["invalid/state-extra-property.json", MachineStateSchema],
  ["invalid/state-fault-heater-active.json", MachineStateSchema],
  ["invalid/state-fault-without-details.json", MachineStateSchema],
  ["invalid/temperatures-request-empty.json", TemperatureSettingsRequestSchema],
  ["invalid/brew-target-too-low.json", TemperatureSettingsRequestSchema],
  ["invalid/brew-target-fractional.json", TemperatureSettingsRequestSchema],
  ["invalid/steam-target-too-high.json", TemperatureSettingsRequestSchema],
  ["invalid/mode-invalid.json", ModeRequestSchema],
  ["invalid/error-extra-property.json", ErrorResponseSchema],
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
      ErrorResponse: [await fixture("valid/error.json")],
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
