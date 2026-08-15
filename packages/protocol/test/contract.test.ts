import { describe, expect, it } from "bun:test";

import {
  ApiErrorResponseSchema,
  ExtractionTelemetryPageSchema,
  FirmwareUpdateAcceptedSchema,
  GrossWeightDecigramsSchema,
  MachineStateV4Schema,
  NetWeightDecigramsSchema,
  PairingClientBindingSchema,
  PairingCompleteResponseSchema,
  PairingDeviceBindingSchema,
  PairingSessionCompleteRequestSchema,
  PairingSessionProofRequestSchema,
  PairingSessionProofResponseSchema,
  PairingSessionStartRequestSchema,
  PairingSessionStartResponseSchema,
  SettingsRequestSchema,
} from "../src/index.ts";

const base64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const bootId = "00000000000000000000000000000001";

async function fixture(
  kind: "invalid" | "valid",
  name: string,
): Promise<unknown> {
  return Bun.file(
    new URL(`../fixtures/${kind}/${name}`, import.meta.url),
  ).json();
}

function state(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: "4",
    device: {
      deviceId: "philcoino-test",
      name: "Philcoino test",
      model: "espresso-machine",
      apiVersion: "4",
      firmwareVersion: "3.0.0",
    },
    bootId,
    revision: 7,
    capturedAtUptimeMs: 12_000,
    machine: {
      status: "heating",
      activeMode: "brew",
      boilerTemperatureC: null,
      steamTemperatureC: null,
      brewTargetC: 93,
      steamTargetC: 120,
      steamReadyTimeoutMs: 300_000,
      heaterEnabled: true,
      heaterActive: false,
      steamTimeoutRemainingMs: null,
      uptimeMs: 12_000,
      fault: null,
    },
    scale: {
      availability: "unavailable",
      calibrationStatus: "uncalibrated",
      stable: false,
      grossWeightDecigrams: null,
      netWeightDecigrams: null,
      activeExtraction: null,
      terminalExtraction: null,
      warning: null,
    },
    temperatureCalibrations: {
      boiler: {
        status: "uncalibrated",
        sensor: "boiler",
        savedOffsetC: 0,
        temperatureRawC: null,
        temperatureC: null,
        heaterActive: false,
        ready: false,
        safeTargetBounds: { minimumC: 85, maximumC: 95 },
      },
      steam: {
        status: "uncalibrated",
        sensor: "steam",
        savedOffsetC: 0,
        temperatureRawC: null,
        temperatureC: null,
        heaterActive: false,
        ready: false,
        safeTargetBounds: { minimumC: 110, maximumC: 135 },
      },
    },
    extraction: {
      status: "idle",
      extractionId: null,
      selection: null,
      phase: "idle",
      elapsedMs: 0,
      remainingMs: null,
      pumpCommand: "off",
    },
    compensation: { status: "inactive", phase: null },
    cooldown: {
      status: "idle",
      cooldownId: null,
      brewTargetC: null,
      elapsedMs: 0,
      remainingMs: null,
      pumpCommand: "off",
      heaterInhibited: false,
      outcome: null,
    },
    ...overrides,
  };
}

describe("API v4 contract", () => {
  it("keeps the stored v4 fixtures executable and rejects their negative pairs", async () => {
    const validState = await fixture("valid", "state-v4.json");
    const validSettings = await fixture("valid", "settings-v4.json");
    const validSession = await fixture("valid", "pairing-session-v4.json");
    const validProof = await fixture("valid", "pairing-proof-v4.json");
    const validComplete = await fixture("valid", "pairing-complete-v4.json");
    const validError = await fixture("valid", "error-v4.json");
    const validTelemetry = await fixture("valid", "telemetry-page-v4.json");
    const validWeights = await fixture("valid", "weight-boundaries-v4.json") as {
      gross: number[];
      net: number[];
    };
    const validFirmwareUpdate = await fixture(
      "valid",
      "firmware-update-accepted-v4.json",
    );

    expect(MachineStateV4Schema.safeParse(validState).success).toBe(true);
    expect(SettingsRequestSchema.safeParse(validSettings).success).toBe(true);
    expect(PairingSessionStartResponseSchema.safeParse(validSession).success).toBe(true);
    expect(PairingSessionProofResponseSchema.safeParse(validProof).success).toBe(true);
    expect(PairingCompleteResponseSchema.safeParse(validComplete).success).toBe(true);
    expect(ApiErrorResponseSchema.safeParse(validError).success).toBe(true);
    expect(ExtractionTelemetryPageSchema.safeParse(validTelemetry).success).toBe(true);
    expect(FirmwareUpdateAcceptedSchema.safeParse(validFirmwareUpdate).success).toBe(true);
    expect(validWeights.gross.every((value) =>
      GrossWeightDecigramsSchema.safeParse(value).success)).toBe(true);
    expect(validWeights.net.every((value) =>
      NetWeightDecigramsSchema.safeParse(value).success)).toBe(true);

    expect(SettingsRequestSchema.safeParse(
      await fixture("invalid", "settings-unknown-v4.json"),
    ).success).toBe(false);
    expect(PairingSessionProofRequestSchema.safeParse(
      await fixture("invalid", "pairing-malformed-proof-v4.json"),
    ).success).toBe(false);
    expect(ApiErrorResponseSchema.safeParse(
      await fixture("invalid", "error-extra-field-v4.json"),
    ).success).toBe(false);
    expect(FirmwareUpdateAcceptedSchema.safeParse(
      await fixture("invalid", "firmware-update-extra-field-v4.json"),
    ).success).toBe(false);

    const invalidContinuity = await fixture(
      "invalid",
      "telemetry-continuity-v4.json",
    ) as { continuity: string };
    expect(ExtractionTelemetryPageSchema.safeParse({
      ...(validTelemetry as Record<string, unknown>),
      continuity: invalidContinuity.continuity,
    }).success).toBe(false);

    const invalidWeights = await fixture(
      "invalid",
      "weight-boundaries-v4.json",
    ) as { gross: number[]; net: number[] };
    expect(invalidWeights.gross.every((value) =>
      !GrossWeightDecigramsSchema.safeParse(value).success)).toBe(true);
    expect(invalidWeights.net.every((value) =>
      !NetWeightDecigramsSchema.safeParse(value).success)).toBe(true);
  });

  it("accepts one coherent snapshot with unavailable readings represented by null", () => {
    expect(MachineStateV4Schema.parse(state()).machine.boilerTemperatureC).toBeNull();
  });

  it("rejects unknown snapshot and settings fields", () => {
    expect(MachineStateV4Schema.safeParse(state({ legacy: true })).success).toBe(false);
    expect(SettingsRequestSchema.safeParse({ brewTargetC: 93, legacy: true }).success).toBe(false);
  });

  it("enforces distinct gross and net weight boundaries", () => {
    expect(GrossWeightDecigramsSchema.safeParse(-500).success).toBe(true);
    expect(GrossWeightDecigramsSchema.safeParse(10_500).success).toBe(true);
    expect(GrossWeightDecigramsSchema.safeParse(-501).success).toBe(false);
    expect(NetWeightDecigramsSchema.safeParse(-11_000).success).toBe(true);
    expect(NetWeightDecigramsSchema.safeParse(11_000).success).toBe(true);
    expect(NetWeightDecigramsSchema.safeParse(11_001).success).toBe(false);
  });

  it("validates the strict three-stage SRP session and encrypted bindings", () => {
    const startRequest = PairingSessionStartRequestSchema.parse({
      clientName: "Philcoino mobile",
      clientNonce: base64,
      clientPublicKey: "A".repeat(512),
    });
    const session = PairingSessionStartResponseSchema.parse({
      sessionId: bootId,
      device: state().device,
      serverPublicKey: "B".repeat(512),
      salt: "C".repeat(22),
      expiresAtUptimeMs: 90_000,
    });
    const proofRequest = PairingSessionProofRequestSchema.parse({
      clientProof: "D".repeat(86),
    });
    const proof = PairingSessionProofResponseSchema.parse({
      serverProof: "E".repeat(86),
      deviceNonce: "F".repeat(16),
      encryptedDeviceBinding: "G".repeat(64),
    });
    const completeRequest = PairingSessionCompleteRequestSchema.parse({
      clientId: bootId,
      encryptedClientBinding: "H".repeat(64),
    });
    const complete = PairingCompleteResponseSchema.parse({
      device: session.device,
      clientId: completeRequest.clientId,
      accessToken: base64,
      certificateSpkiSha256: base64,
    });
    const deviceBinding = PairingDeviceBindingSchema.parse({
      domain: "philcoino:v4:device-binding",
      sessionId: session.sessionId,
      clientNonce: startRequest.clientNonce,
      deviceId: session.device.deviceId,
      certificateSpkiSha256: complete.certificateSpkiSha256,
    });
    expect(PairingClientBindingSchema.safeParse({
      ...deviceBinding,
      domain: "philcoino:v4:client-binding",
      clientId: completeRequest.clientId,
    }).success).toBe(true);
    expect(proofRequest.clientProof).toHaveLength(86);
    expect(proof.deviceNonce).toHaveLength(16);
    expect(complete.accessToken).toHaveLength(43);
  });

  it("rejects unknown SRP fields and malformed Base64URL", () => {
    expect(PairingSessionStartRequestSchema.safeParse({
      clientName: "iPhone",
      clientNonce: base64,
      clientPublicKey: "A===",
    }).success).toBe(false);
    expect(PairingSessionCompleteRequestSchema.safeParse({
      clientId: bootId,
      encryptedClientBinding: "A".repeat(64),
      legacyProof: base64,
    }).success).toBe(false);
  });

  it("validates strict API error payloads", () => {
    expect(ApiErrorResponseSchema.parse({
      error: { code: "unauthorized", message: "Pair again." },
    }).error.code).toBe("unauthorized");
    expect(ApiErrorResponseSchema.safeParse({
      error: { code: "unauthorized", message: "Pair again." }, extra: true,
    }).success).toBe(false);
  });

  it("accepts nullable acquisition data and strict SSE continuity", () => {
    const page = ExtractionTelemetryPageSchema.parse({
      version: 2,
      deviceId: "philcoino-test",
      extractionId: "extraction-0001",
      bootId,
      capturedAtUptimeMs: 250,
      selection: { kind: "manual" },
      controlMode: "manual",
      weightControl: null,
      baselineWeightDecigrams: null,
      status: "running",
      outcome: null,
      terminalWeight: null,
      oldestSequence: 1,
      latestSequence: 1,
      nextCursor: { extractionId: "extraction-0001", bootId, afterSequence: 1 },
      hasMore: false,
      continuity: "initial",
      samples: [{
        sequence: 1,
        uptimeMs: 250,
        elapsedMs: 250,
        extractionElapsedMs: 250,
        phase: "manual",
        boilerTemperatureC: null,
        steamTemperatureC: null,
        activeTargetC: 93,
        heaterActive: false,
        pumpCommand: "running",
        scaleAvailability: "unavailable",
        netWeightDecigrams: null,
      }],
    });
    expect(page.continuity).toBe("initial");
    expect(page.samples[0].boilerTemperatureC).toBeNull();
  });
});
