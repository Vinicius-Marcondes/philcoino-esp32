import {
  ApiErrorResponseSchema,
  CompleteScaleCalibrationRequestSchema,
  EXTRACTION_TELEMETRY_HEARTBEAT_INTERVAL_MS,
  ExtractionTelemetryCursorSchema,
  FaultCodeSchema,
  FirmwareUpdateAcceptedSchema,
  HeaterSettingsRequestSchema,
  ModeRequestSchema,
  PairingClientBindingSchema,
  PairingSessionCompleteRequestSchema,
  PairingSessionProofRequestSchema,
  PairingSessionStartRequestSchema,
  SettingsRequestSchema,
  StartCooldownRequestSchema,
  StartExtractionRequestSchema,
  TemperatureCalibrationSessionIdSchema,
  TemperatureCalibrationSessionRequestSchema,
  TemperatureSettingsRequestSchema,
  UpdateTemperatureCalibrationCandidateRequestSchema,
  TemperatureSensorSchema,
  type ApiErrorCode,
  type ApiErrorResponse,
  type ExtractionTelemetryCursor,
  type ExtractionTelemetryPage,
  type TemperatureSettingsRequest,
  type TemperatureSensor,
} from "@philcoino/protocol";
import { Hono, type Context, type Next } from "hono";

import {
  SimulatorMachine,
  type SimulatedOutputCommand,
  type SimulatorMachineOptions,
  type TemperatureCalibrationOperationResult,
} from "./model.ts";
import {
  incrementNonce,
  SrpServerSession,
  type RandomBytes,
} from "./srp.ts";

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function random(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function randomHex(length: number): string {
  return [...random(length)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return encodeBase64Url(new Uint8Array(digest));
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    value.slice().buffer,
  ));
  return [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const DEFAULT_SIMULATOR_PAIRING_CODE = "12345678";
export const DEFAULT_SIMULATOR_CERTIFICATE_PIN =
  "U2ltdWxhdG9yU1BLSUZpbmdlcnByaW50MDAwMDAwMDA";

export interface CreateSimulatorOptions extends SimulatorMachineOptions {
  pairingCode?: string;
  pairingRandomBytes?: RandomBytes;
  pairingFailure?:
    | "altered-binding"
    | "forged-server-proof"
    | "token-issue";
  certificateSpkiSha256?: string;
}

export interface SimulatorApplication {
  app: Hono;
  machine: SimulatorMachine;
  rotatePairingCode(pairingCode: string): void;
}

const MALFORMED_REQUEST_MESSAGE = "The JSON request body is malformed.";

export function createSimulator(
  options: CreateSimulatorOptions = {},
): SimulatorApplication {
  const machine = new SimulatorMachine(options);
  let pairingCode = options.pairingCode ?? DEFAULT_SIMULATOR_PAIRING_CODE;
  const certificatePin =
    options.certificateSpkiSha256 ?? DEFAULT_SIMULATOR_CERTIFICATE_PIN;
  const app = new Hono();
  let extractionStreamActive = false;
  const clients: Array<{
    clientId: string;
    tokenHash: string;
    issued: number;
  }> = [];
  const sessions = new Map<
    string,
    {
      clientNonce: string;
      deviceNonce: Uint8Array | null;
      expiresAtUptimeMs: number;
      srp: SrpServerSession;
      stage: "proof" | "complete";
    }
  >();
  let issued = 0;

  if (!/^[0-9]{8}$/.test(pairingCode)) {
    throw new Error("The simulator pairing code must contain exactly eight digits.");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(certificatePin)) {
    throw new Error("The simulator certificate pin must be a SHA-256 base64url value.");
  }

  const requireBearer = async (c: Context, next: Next) => {
    const authorization = c.req.header("Authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);

    const supplied = match?.[1];
    const hash = supplied === undefined ? "" : await sha256(supplied);
    if (!match || !clients.some((client) => client.tokenHash === hash)) {
      c.header("WWW-Authenticate", 'Bearer realm="philcoino"');
      return contractApiError(
        c,
        401,
        "unauthorized",
        "A valid bearer token is required.",
      );
    }

    await next();
  };
  app.get("/healthz", (c) => c.json(machine.getHealth()));
  app.post("/api/v4/pairing/sessions", async (c) => {
    const now = machine.getHealth().uptimeMs;
    for (const [id, session] of sessions) {
      if (now >= session.expiresAtUptimeMs) sessions.delete(id);
    }
    if (sessions.size >= 2) {
      return contractApiError(
        c,
        409,
        "pairing_busy",
        "Two pairing sessions are already active.",
      );
    }
    const body = await readJson(c);
    const parsed = body.ok
      ? PairingSessionStartRequestSchema.safeParse(body.value)
      : null;
    if (parsed === null || !parsed.success) {
      return contractApiError(
        c,
        400,
        "malformed_request",
        "The SRP session request is malformed.",
      );
    }
    let srp: SrpServerSession;
    try {
      srp = await SrpServerSession.create(
        pairingCode,
        decodeBase64Url(parsed.data.clientPublicKey),
        options.pairingRandomBytes ?? random,
      );
    } catch {
      return contractApiError(
        c,
        400,
        "malformed_request",
        "The SRP client public key is invalid.",
      );
    }
    const sessionId = randomHex(16);
    const expiresAtUptimeMs = now + 90_000;
    sessions.set(sessionId, {
      clientNonce: parsed.data.clientNonce,
      deviceNonce: null,
      expiresAtUptimeMs,
      srp,
      stage: "proof",
    });
    return c.json({
      device: machine.getDevice(),
      expiresAtUptimeMs,
      salt: encodeBase64Url(srp.salt),
      serverPublicKey: encodeBase64Url(srp.serverPublicKey),
      sessionId,
    });
  });

  app.post("/api/v4/pairing/sessions/:sessionId/proof", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = sessions.get(sessionId);
    if (session === undefined) {
      return contractApiError(
        c,
        409,
        "pairing_session_replayed",
        "The pairing session is unavailable.",
      );
    }
    if (machine.getHealth().uptimeMs >= session.expiresAtUptimeMs) {
      sessions.delete(sessionId);
      return contractApiError(
        c,
        409,
        "pairing_session_expired",
        "The pairing session expired.",
      );
    }
    if (session.stage !== "proof") {
      sessions.delete(sessionId);
      return contractApiError(
        c,
        409,
        "pairing_stage_mismatch",
        "The pairing session is not awaiting a proof.",
      );
    }
    const body = await readJson(c);
    const parsed = body.ok
      ? PairingSessionProofRequestSchema.safeParse(body.value)
      : null;
    if (parsed === null || !parsed.success) {
      sessions.delete(sessionId);
      return contractApiError(
        c,
        400,
        "malformed_request",
        "The SRP proof request is malformed.",
      );
    }
    const verifiedProof = await session.srp.verify(
      decodeBase64Url(parsed.data.clientProof),
    );
    if (verifiedProof === null) {
      sessions.delete(sessionId);
      return contractApiError(
        c,
        401,
        "invalid_pairing_code",
        "The pairing code or SRP proof is invalid.",
      );
    }
    const deviceNonce = new Uint8Array(12);
    deviceNonce.set((options.pairingRandomBytes ?? random)(8), 0);
    deviceNonce[11] = 1;
    session.deviceNonce = deviceNonce;
    const binding = JSON.stringify({
      certificateSpkiSha256: certificatePin,
      clientNonce: session.clientNonce,
      deviceId: machine.getDevice().deviceId,
      domain: "philcoino:v4:device-binding",
      sessionId,
    });
    let encryptedBinding = await session.srp.encrypt(deviceNonce, binding);
    if (options.pairingFailure === "altered-binding") {
      encryptedBinding = encryptedBinding.slice();
      encryptedBinding[0] ^= 1;
    }
    let serverProof = verifiedProof;
    if (options.pairingFailure === "forged-server-proof") {
      serverProof = serverProof.slice();
      serverProof[0] ^= 1;
    }
    session.stage = "complete";
    return c.json({
      deviceNonce: encodeBase64Url(deviceNonce),
      encryptedDeviceBinding: encodeBase64Url(encryptedBinding),
      serverProof: encodeBase64Url(serverProof),
    });
  });

  app.post("/api/v4/pairing/sessions/:sessionId/complete", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = sessions.get(sessionId);
    if (session === undefined) {
      return contractApiError(
        c,
        409,
        "pairing_session_replayed",
        "The pairing session is unavailable.",
      );
    }
    if (machine.getHealth().uptimeMs >= session.expiresAtUptimeMs) {
      sessions.delete(sessionId);
      return contractApiError(
        c,
        409,
        "pairing_session_expired",
        "The pairing session expired.",
      );
    }
    if (session.stage !== "complete" || session.deviceNonce === null) {
      sessions.delete(sessionId);
      return contractApiError(
        c,
        409,
        "pairing_stage_mismatch",
        "The pairing session is not awaiting completion.",
      );
    }
    const body = await readJson(c);
    const parsed = body.ok
      ? PairingSessionCompleteRequestSchema.safeParse(body.value)
      : null;
    if (parsed === null || !parsed.success) {
      sessions.delete(sessionId);
      return contractApiError(
        c,
        400,
        "malformed_request",
        "The pairing completion request is malformed.",
      );
    }
    try {
      const plaintext = await session.srp.decrypt(
        incrementNonce(session.deviceNonce),
        decodeBase64Url(parsed.data.encryptedClientBinding),
      );
      const binding = PairingClientBindingSchema.parse(
        JSON.parse(plaintext) as unknown,
      );
      if (
        binding.sessionId !== sessionId ||
        binding.clientId !== parsed.data.clientId ||
        binding.clientNonce !== session.clientNonce ||
        binding.deviceId !== machine.getDevice().deviceId ||
        binding.certificateSpkiSha256 !== certificatePin
      ) {
        throw new Error("Binding mismatch.");
      }
    } catch {
      sessions.delete(sessionId);
      return contractApiError(
        c,
        401,
        "unauthorized",
        "The encrypted certificate binding is invalid.",
      );
    }
    sessions.delete(sessionId);
    if (options.pairingFailure === "token-issue") {
      return contractApiError(
        c,
        500,
        "internal_error",
        "Injected token-issuance failure.",
      );
    }
    const accessToken = encodeBase64Url(random(32));
    issued += 1;
    const existing = clients.findIndex(
      (client) => client.clientId === parsed.data.clientId,
    );
    if (existing >= 0) clients.splice(existing, 1);
    if (clients.length === 4) {
      clients.sort((left, right) => left.issued - right.issued);
      clients.shift();
    }
    clients.push({
      clientId: parsed.data.clientId,
      tokenHash: await sha256(accessToken),
      issued,
    });
    return c.json({
      accessToken,
      certificateSpkiSha256: certificatePin,
      clientId: parsed.data.clientId,
      device: machine.getDevice(),
    });
  });

  app.use("/api/v4/state", requireBearer);
  app.use("/api/v4/settings", requireBearer);
  app.use("/api/v4/mode", requireBearer);
  app.use("/api/v4/heater-permission", requireBearer);
  app.use("/api/v4/faults/over-temperature/dismiss", requireBearer);
  app.use("/api/v4/scale-calibrations/*", requireBearer);
  app.use("/api/v4/scale/*", requireBearer);
  app.use("/api/v4/extractions/*", requireBearer);
  app.use("/api/v4/cooldowns/*", requireBearer);
  app.use("/api/v4/temperature-calibrations/*", requireBearer);
  app.use("/api/v4/firmware-updates", requireBearer);

  app.post("/api/v4/firmware-updates", async (c) => {
    if (c.req.header("Content-Type") !== "application/octet-stream") {
      return contractApiError(
        c,
        415,
        "unsupported_media_type",
        "Firmware updates require application/octet-stream.",
      );
    }
    const expectedDigest = c.req.header("X-Philcoino-Image-SHA256");
    if (expectedDigest === undefined || !/^[0-9a-f]{64}$/u.test(expectedDigest)) {
      return contractApiError(
        c,
        400,
        "firmware_metadata_invalid",
        "A lowercase hexadecimal image SHA-256 is required.",
      );
    }
    const image = new Uint8Array(await c.req.arrayBuffer());
    if (image.length === 0) {
      return contractApiError(
        c,
        400,
        "firmware_metadata_invalid",
        "The firmware image is empty.",
      );
    }
    if (image.length > 1_966_080) {
      return contractApiError(
        c,
        413,
        "firmware_image_too_large",
        "The firmware image does not fit the inactive OTA slot.",
      );
    }
    const state = machine.getStateV4();
    if (
      state.extraction.status !== "idle" ||
      state.cooldown.status !== "idle" ||
      state.temperatureCalibrations.boiler.status === "calibrating" ||
      state.temperatureCalibrations.steam.status === "calibrating" ||
      state.scale.calibrationStatus === "calibrating"
    ) {
      return contractApiError(
        c,
        409,
        "firmware_update_busy",
        "Stop extraction, cooldown, and calibration before updating.",
      );
    }
    if (await sha256Hex(image) !== expectedDigest) {
      return contractApiError(
        c,
        422,
        "firmware_digest_mismatch",
        "The uploaded firmware SHA-256 does not match.",
      );
    }
    machine.setHeaterEnabled(false);
    return c.json(FirmwareUpdateAcceptedSchema.parse({
      bytesWritten: image.length,
      rebooting: true,
      status: "accepted",
    }), 202);
  });

  app.get("/api/v4/state", (c) => {
    if ([...new URL(c.req.url).searchParams.keys()].length > 0) {
      return contractApiError(
        c,
        400,
        "malformed_request",
        "The state query is malformed.",
      );
    }
    return c.json(machine.getStateV4());
  });

  app.patch("/api/v4/settings", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }

    const parsed = SettingsRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    if (machine.abortTemperatureCalibrationForConflict()) {
      return contractApiError(
        c,
        409,
        "sensor_unavailable",
        "Temperature calibration was cancelled before changing targets.",
      );
    }
    const temperatureUpdate: TemperatureSettingsRequest | null =
      parsed.data.brewTargetC !== undefined
        ? {
            brewTargetC: parsed.data.brewTargetC,
            ...(parsed.data.steamTargetC === undefined
              ? {}
              : { steamTargetC: parsed.data.steamTargetC }),
          }
        : parsed.data.steamTargetC !== undefined
          ? { steamTargetC: parsed.data.steamTargetC }
          : null;
    if (
      temperatureUpdate !== null &&
      !machine.temperatureTargetsAreSafe(temperatureUpdate)
    ) {
      return contractApiError(
        c,
        400,
        "temperature_target_unsafe",
        "The requested target would require a raw temperature above the cap.",
      );
    }

    if (parsed.data.steamReadyTimeoutMs !== undefined) {
      if (machine.getState().status === "fault") {
        return contractApiError(
          c,
          409,
          "machine_faulted",
          "Steam-control settings cannot change while a machine fault is latched.",
        );
      }
      if (!machine.updateSteamReadyTimeout(parsed.data.steamReadyTimeoutMs)) {
        return contractApiError(
          c,
          500,
          "persistence_failure",
          "Steam-control settings could not be persisted.",
        );
      }
    }
    if (temperatureUpdate !== null) {
      machine.updateTemperatureSettings(temperatureUpdate);
    }
    return c.json(machine.getStateV4());
  });

  app.put("/api/v4/mode", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }

    const parsed = ModeRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    if (machine.abortTemperatureCalibrationForConflict()) {
      return contractApiError(
        c,
        409,
        "sensor_unavailable",
        "Temperature calibration was cancelled before changing mode.",
      );
    }

    if (machine.getState().status === "fault") {
      return contractApiError(
        c,
        409,
        "sensor_unavailable",
        "Mode cannot be changed while a machine fault is latched.",
      );
    }
    if (parsed.data.mode === "steam" && machine.hasActiveWorkflow()) {
      return contractApiError(
        c,
        409,
        "sensor_unavailable",
        "Steam cannot be selected while extraction or cooldown is active.",
      );
    }

    if (machine.setMode(parsed.data.mode) === null) {
      return contractApiError(c, 409, "sensor_unavailable",
        "The target mode requires a current valid sensor sample.");
    }
    return c.json(machine.getStateV4());
  });

  app.put("/api/v4/heater-permission", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }

    const parsed = HeaterSettingsRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    if (machine.abortTemperatureCalibrationForConflict()) {
      return contractApiError(
        c,
        409,
        "sensor_unavailable",
        "Temperature calibration was cancelled before changing heater permission.",
      );
    }

    machine.setHeaterEnabled(parsed.data.enabled);
    return c.json(machine.getStateV4());
  });

  app.post("/api/v4/faults/over-temperature/dismiss", (c) => {
    if (!machine.dismissOverTemperature()) {
      return contractApiError(
        c,
        409,
        "sensor_unavailable",
        "Over-temperature can only be dismissed after the active temperature returns to target.",
      );
    }
    return c.json(machine.getStateV4());
  });

  app.post("/api/v4/temperature-calibrations/:sensor/current", (c) => {
    const sensor = temperatureCalibrationSensor(c);
    if (sensor === null) return contractApiError(c, 400, "malformed_request", "Unknown temperature sensor.");
    const result = machine.startTemperatureCalibration(sensor);
    return result.ok
      ? c.json(machine.getStateV4())
      : temperatureCalibrationError(c, result.reason);
  });

  app.patch("/api/v4/temperature-calibrations/:sensor/current", async (c) => {
    const sensor = temperatureCalibrationSensor(c);
    if (sensor === null) return contractApiError(c, 400, "malformed_request", "Unknown temperature sensor.");
    const body = await readJson(c);
    const parsed = body.ok
      ? UpdateTemperatureCalibrationCandidateRequestSchema.safeParse(
          body.value,
        )
      : null;
    if (parsed === null || !parsed.success) {
      return contractApiError(
        c,
        400,
        "malformed_request",
        "The calibration candidate request is malformed.",
      );
    }
    const result = machine.updateTemperatureCalibrationCandidate(
      sensor,
      parsed.data.calibrationId,
      parsed.data.candidateRawTargetC,
    );
    return result.ok
      ? c.json(machine.getStateV4())
      : temperatureCalibrationError(c, result.reason);
  });

  const readCalibrationSession = async (c: Context) => {
    const body = await readJson(c);
    return body.ok
      ? TemperatureCalibrationSessionRequestSchema.safeParse(body.value)
      : null;
  };
  app.put("/api/v4/temperature-calibrations/:sensor/current", async (c) => {
    const sensor = temperatureCalibrationSensor(c);
    if (sensor === null) return contractApiError(c, 400, "malformed_request", "Unknown temperature sensor.");
    const parsed = await readCalibrationSession(c);
    if (parsed === null || !parsed.success) {
      return contractApiError(c, 400, "malformed_request",
        "The calibration session request is malformed.");
    }
    const result = machine.saveTemperatureCalibration(sensor, parsed.data.calibrationId);
    return result.ok
      ? c.json(machine.getStateV4())
      : temperatureCalibrationError(c, result.reason);
  });
  app.delete("/api/v4/temperature-calibrations/:sensor/current", async (c) => {
    const sensor = temperatureCalibrationSensor(c);
    if (sensor === null) return contractApiError(c, 400, "malformed_request", "Unknown temperature sensor.");
    const parsed = await readCalibrationSession(c);
    if (parsed === null || !parsed.success) {
      return contractApiError(c, 400, "malformed_request",
        "The calibration session request is malformed.");
    }
    const result = machine.cancelTemperatureCalibration(
      sensor,
      parsed.data.calibrationId,
    );
    return result.ok
      ? c.json(machine.getStateV4())
      : temperatureCalibrationError(c, result.reason);
  });
  app.post("/api/v4/temperature-calibrations/:sensor/current/lease", async (c) => {
    const sensor = temperatureCalibrationSensor(c);
    if (sensor === null) return contractApiError(c, 400, "malformed_request", "Unknown temperature sensor.");
    const parsed = await readCalibrationSession(c);
    if (parsed === null || !parsed.success) {
      return contractApiError(c, 400, "malformed_request",
        "The calibration session request is malformed.");
    }
    const result = machine.getTemperatureCalibration(sensor, parsed.data.calibrationId);
    return result.ok
      ? c.json(machine.getStateV4())
      : temperatureCalibrationError(c, result.reason);
  });

  app.post("/api/v4/scale-calibrations/current", (c) => {
    if (machine.abortTemperatureCalibrationForConflict()) {
      return contractApiError(
        c,
        409,
        "temperature_calibration_active",
        "Temperature calibration was cancelled before starting scale calibration.",
      );
    }
    const result = machine.startScaleCalibration();
    if (result === "ok") {
      return c.json(machine.getStateV4());
    }
    return contractApiError(
      c,
      409,
      result === "active"
        ? "extraction_active"
        : result === "unavailable"
          ? "scale_unavailable"
          : "scale_not_stable",
      result === "active"
        ? "Scale calibration requires all workflows to be idle."
        : result === "unavailable"
          ? "The scale is unavailable."
          : "The scale must be stable before calibration.",
    );
  });

  app.put("/api/v4/scale-calibrations/current", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractApiError(
        c,
        400,
        "malformed_request",
        MALFORMED_REQUEST_MESSAGE,
      );
    }
    const parsed = CompleteScaleCalibrationRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return contractApiError(
        c,
        400,
        "malformed_request",
        "The calibration reference weight is invalid.",
      );
    }
    const result = machine.completeScaleCalibration(
      parsed.data.referenceWeightDecigrams,
    );
    if (result === "ok") {
      return c.json(machine.getStateV4());
    }
    if (result === "persistence") {
      return contractApiError(
        c,
        500,
        "persistence_failure",
        "The scale calibration could not be persisted.",
      );
    }
    return contractApiError(
      c,
      409,
      result === "not-started"
        ? "calibration_in_progress"
        : result === "unavailable"
          ? "scale_unavailable"
          : "scale_not_stable",
      result === "not-started"
        ? "Start calibration before applying the reference load."
        : result === "unavailable"
          ? "The scale is unavailable."
          : "The reference load must be stable.",
    );
  });

  app.delete("/api/v4/scale-calibrations/current", (c) => {
    machine.cancelScaleCalibration();
    return c.json(machine.getStateV4());
  });

  app.post("/api/v4/scale/warnings/acknowledge", (c) => {
    machine.acknowledgeScaleWarning();
    return c.json(machine.getStateV4());
  });

  app.post("/api/v4/extractions", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractApiError(
        c,
        400,
        "malformed_request",
        MALFORMED_REQUEST_MESSAGE,
      );
    }
    const parsed = StartExtractionRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return contractApiError(
        c,
        400,
        "malformed_request",
        "The extraction Start request is invalid.",
      );
    }
    if (machine.abortTemperatureCalibrationForConflict()) {
      return contractApiError(
        c,
        409,
        "temperature_calibration_active",
        "Temperature calibration was cancelled before starting extraction.",
      );
    }

    const result = machine.startExtraction(
      parsed.data.idempotencyKey,
      parsed.data.selection,
      "weightControl" in parsed.data ? parsed.data.weightControl : null,
    );
    if (!result.ok && result.reason === "active") {
      return contractApiError(
        c,
        409,
        "extraction_active",
        "A different extraction is already active.",
      );
    }
    if (!result.ok && result.reason === "cooldown-active") {
      return contractApiError(
        c,
        409,
        "cooldown_active",
        "Extraction cannot start while cooldown is active.",
      );
    }
    if (!result.ok && result.reason === "brew-mode-required") {
      return contractApiError(
        c,
        409,
        "brew_mode_required",
        "Switch the machine to Brew before starting extraction.",
      );
    }
    if (!result.ok && result.reason === "idempotency-mismatch") {
      return contractApiError(
        c,
        409,
        "idempotency_mismatch",
        "The idempotency key was already used with a different selection.",
      );
    }
    if (!result.ok && result.reason.startsWith("scale-")) {
      const code = result.reason.replaceAll("-", "_") as ApiErrorCode;
      return contractApiError(
        c,
        409,
        code,
        result.reason === "scale-not-calibrated"
          ? "Calibrate the scale before weighted extraction."
          : result.reason === "scale-not-stable"
            ? "The scale must be stable for automatic tare."
            : result.reason === "scale-unavailable"
              ? "The scale is unavailable."
              : "Acknowledge the scale fallback warning before another weighted extraction.",
      );
    }
    if (!result.ok) {
      return contractApiError(
        c,
        500,
        "internal_error",
        "The simulator could not start the validated extraction.",
      );
    }
    return c.json(machine.getStateV4());
  });

  app.delete("/api/v4/extractions/current", (c) => {
    machine.stopExtraction();
    return c.json(machine.getStateV4());
  });

  app.get("/api/v4/extractions/current/stream", (c) => {
    const cursor = extractionTelemetryCursor(c.req.url);
    if (!cursor.ok) {
      return contractApiError(
        c,
        400,
        "malformed_request",
        "The extraction telemetry cursor is malformed.",
      );
    }
    if (extractionStreamActive) {
      return contractApiError(
        c,
        409,
        "stream_busy",
        "Another authenticated extraction telemetry subscriber is active.",
      );
    }
    const initial = machine.getExtractionTelemetryPage(cursor.value);
    if (!initial.ok) {
      return contractApiError(
        c,
        409,
        "stream_unavailable",
        initial.reason === "unavailable"
          ? "No retained extraction telemetry is available."
          : "The extraction telemetry cursor is outside the retained sequence.",
      );
    }

    extractionStreamActive = true;
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let released = false;
    let activeCursor = cursor.value;
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let lastSendAt = Date.now();
    const encoder = new TextEncoder();

    const release = () => {
      if (released) {
        return;
      }
      released = true;
      extractionStreamActive = false;
      unsubscribe?.();
      unsubscribe = null;
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    };
    const sendPage = (page: ExtractionTelemetryPage) => {
      if (controller !== null && (controller.desiredSize ?? 0) <= 0) {
        release();
        controller.error(new Error("The extraction telemetry subscriber is too slow."));
        return;
      }
      controller?.enqueue(
        encoder.encode(
          `id: ${page.bootId}.${page.extractionId}.${page.nextCursor.afterSequence}\nevent: telemetry\ndata: ${JSON.stringify(page)}\n\n`,
        ),
      );
      lastSendAt = Date.now();
      activeCursor = page.nextCursor;
    };
    const drain = () => {
      while (!released) {
        const result = machine.getExtractionTelemetryPage(activeCursor);
        if (!result.ok) {
          release();
          controller?.error(new Error("Extraction telemetry became unavailable."));
          return;
        }
        if (result.page === null) {
          return;
        }
        sendPage(result.page);
        if (released) {
          return;
        }
        if (!result.page.hasMore) {
          if (result.page.status === "terminal") {
            release();
            controller?.close();
          }
          return;
        }
      }
    };

    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        if (initial.page !== null) {
          sendPage(initial.page);
          if (initial.page.hasMore) {
            drain();
          }
          if (released) {
            return;
          }
          if (initial.page.status === "terminal" && !initial.page.hasMore) {
            release();
            streamController.close();
            return;
          }
        }
        unsubscribe = machine.subscribeExtractionTelemetry(drain);
        heartbeat = setInterval(() => {
          if (
            !released &&
            Date.now() - lastSendAt >=
              EXTRACTION_TELEMETRY_HEARTBEAT_INTERVAL_MS
          ) {
            streamController.enqueue(encoder.encode(": heartbeat\n\n"));
            lastSendAt = Date.now();
          }
        }, EXTRACTION_TELEMETRY_HEARTBEAT_INTERVAL_MS);
      },
      cancel() {
        release();
      },
    }, {
      highWaterMark: 320,
      size: () => 1,
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
        "X-Accel-Buffering": "no",
      },
    });
  });

  app.post("/api/v4/cooldowns", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractApiError(
        c,
        400,
        "malformed_request",
        MALFORMED_REQUEST_MESSAGE,
      );
    }
    const parsed = StartCooldownRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return contractApiError(
        c,
        400,
        "malformed_request",
        "The cooldown Start request is invalid.",
      );
    }
    if (machine.abortTemperatureCalibrationForConflict()) {
      return contractApiError(
        c,
        409,
        "temperature_calibration_active",
        "Temperature calibration was cancelled before starting cooldown.",
      );
    }

    const result = machine.startCooldown(parsed.data.idempotencyKey);
    if (result.ok) {
      return c.json(machine.getStateV4());
    }
    if (result.reason === "extraction-active") {
      return contractApiError(
        c,
        409,
        "extraction_active",
        "Cooldown cannot start while extraction is active.",
      );
    }
    if (result.reason === "cooldown-active") {
      return contractApiError(
        c,
        409,
        "cooldown_active",
        "A different cooldown is already active.",
      );
    }
    if (result.reason === "cooldown-not-required") {
      return contractApiError(
        c,
        409,
        "cooldown_not_required",
        "The Brew-effective temperature must be above the current Brew target.",
      );
    }
    if (result.reason === "sensor-unavailable") {
      return contractApiError(
        c,
        409,
        "sensor_unavailable",
        "Cooldown requires a valid boiler temperature reading.",
      );
    }
    if (result.reason === "machine-faulted") {
      return contractApiError(
        c,
        409,
        "machine_faulted",
        "Cooldown cannot start while a machine fault is latched.",
      );
    }
    return contractApiError(
      c,
      500,
      "internal_error",
      "The simulator could not apply the cooldown output commands.",
    );
  });

  app.delete("/api/v4/cooldowns/current", (c) => {
    const result = machine.stopCooldown();
    return result.ok
      ? c.json(machine.getStateV4())
      : contractApiError(
          c,
          500,
          "internal_error",
          "The simulator could not apply the cooldown pump-off command.",
        );
  });

  app.post("/_simulator/reset", (c) => {
    machine.reset();
    return c.json(machine.getState());
  });

  app.post("/_simulator/power-cycle", (c) => {
    machine.powerCycle();
    return c.json(machine.getState());
  });

  app.post("/_simulator/advance", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isAdvanceRequest(body.value)) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    machine.advance(body.value.milliseconds);
    return c.json(machine.getState());
  });

  app.put("/_simulator/temperatures", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isTemperatureControlRequest(body.value)) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    if (body.value.boilerTemperatureC !== undefined) {
      machine.setTemperature(body.value.boilerTemperatureC);
    }
    if (body.value.steamTemperatureC !== undefined) {
      machine.setSteamTemperature(body.value.steamTemperatureC);
    }
    return c.json(machine.getState());
  });

  app.put("/_simulator/raw-temperature", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isRawTemperatureControlRequest(body.value)) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    if (body.value.boilerTemperatureRawC !== undefined) {
      machine.setTemperature(body.value.boilerTemperatureRawC);
    }
    if (body.value.steamTemperatureRawC !== undefined) {
      machine.setSteamTemperature(body.value.steamTemperatureRawC);
    }
    return c.json(machine.getRawTemperature());
  });

  app.put("/_simulator/fault", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isFaultRequest(body.value)) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    const code = FaultCodeSchema.safeParse(body.value.code);
    if (!code.success) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    machine.injectFault(code.data, body.value.sensor ?? null);
    return c.json(machine.getState());
  });

  app.post("/_simulator/fail-next-temperature-calibration-save", (c) => {
    machine.injectNextTemperatureCalibrationSaveFailure();
    return c.json({ status: "armed" });
  });

  app.post("/_simulator/fail-next-steam-control-save", (c) => {
    machine.injectNextSteamControlSaveFailure();
    return c.json({ status: "armed" });
  });

  app.post("/_simulator/corrupt-temperature-calibration", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isSensorRequest(body.value)) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    machine.corruptTemperatureCalibrationStorage(body.value.sensor);
    return c.json({ sensor: body.value.sensor, status: "corrupted" });
  });

  app.put("/_simulator/sensor-availability", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isSensorAvailabilityRequest(body.value)) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    machine.setSensorAvailable(body.value.sensor, body.value.available);
    return c.json(machine.getState());
  });

  app.post("/_simulator/corrupt-steam-control", (c) => {
    machine.corruptSteamControlStorage();
    return c.json({ status: "corrupted" });
  });

  app.post("/_simulator/fail-next-output-command", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isOutputFailureRequest(body.value)) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    machine.injectNextOutputFailure(body.value.command);
    return c.json({ command: body.value.command, status: "armed" });
  });

  app.put("/_simulator/scale", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isScaleControlRequest(body.value)) {
      return contractApiError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    machine.setScaleState(body.value);
    return c.json(machine.getScaleState());
  });

  return {
    app,
    machine,
    rotatePairingCode(nextPairingCode: string) {
      if (!/^[0-9]{8}$/.test(nextPairingCode)) {
        throw new Error(
          "The simulator pairing code must contain exactly eight digits.",
        );
      }
      if (nextPairingCode === pairingCode) return;
      pairingCode = nextPairingCode;
      clients.splice(0);
      sessions.clear();
    },
  };
}

function extractionTelemetryCursor(
  requestUrl: string,
):
  | { ok: true; value: ExtractionTelemetryCursor | undefined }
  | { ok: false } {
  const parameters = new URL(requestUrl).searchParams;
  const allowed = new Set(["extractionId", "bootId", "afterSequence"]);
  for (const key of parameters.keys()) {
    if (!allowed.has(key) || parameters.getAll(key).length !== 1) {
      return { ok: false };
    }
  }
  const extractionId = parameters.get("extractionId");
  const bootId = parameters.get("bootId");
  const sequenceText = parameters.get("afterSequence");
  if (
    extractionId === null &&
    bootId === null &&
    sequenceText === null
  ) {
    return { ok: true, value: undefined };
  }
  if (
    extractionId === null ||
    bootId === null ||
    sequenceText === null ||
    !/^(0|[1-9][0-9]*)$/.test(sequenceText)
  ) {
    return { ok: false };
  }
  const parsed = ExtractionTelemetryCursorSchema.safeParse({
    extractionId,
    bootId,
    afterSequence: Number(sequenceText),
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

function temperatureCalibrationQuery(
  requestUrl: string,
):
  | { ok: true; value: string | undefined }
  | { ok: false } {
  const parameters = new URL(requestUrl).searchParams;
  for (const key of parameters.keys()) {
    if (
      key !== "calibrationId" ||
      parameters.getAll(key).length !== 1
    ) {
      return { ok: false };
    }
  }
  const calibrationId = parameters.get("calibrationId");
  if (calibrationId === null) {
    return { ok: true, value: undefined };
  }
  const parsed =
    TemperatureCalibrationSessionIdSchema.safeParse(calibrationId);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false };
}

function temperatureCalibrationSensor(c: Context): TemperatureSensor | null {
  const parsed = TemperatureSensorSchema.safeParse(c.req.param("sensor"));
  return parsed.success ? parsed.data : null;
}

function temperatureCalibrationError(
  c: Context,
  reason: Extract<
    TemperatureCalibrationOperationResult,
    { ok: false }
  >["reason"],
): Response {
  const mapping: Record<
    typeof reason,
    { code: ApiErrorCode; message: string; status: 409 | 500 }
  > = {
    active: {
      code: "temperature_calibration_active",
      message: "A temperature calibration session is already active.",
      status: 409,
    },
    inactive: {
      code: "temperature_calibration_inactive",
      message: "No temperature calibration session is active.",
      status: 409,
    },
    "session-mismatch": {
      code: "temperature_calibration_session_mismatch",
      message: "The calibration identifier does not own the active session.",
      status: 409,
    },
    expired: {
      code: "temperature_calibration_expired",
      message: "The temperature calibration session expired from inactivity.",
      status: 409,
    },
    "machine-faulted": {
      code: "machine_faulted",
      message: "Temperature calibration cannot run while a fault is latched.",
      status: 409,
    },
    "sensor-unavailable": {
      code: "sensor_unavailable",
      message: "Temperature calibration requires a valid raw sensor reading.",
      status: 409,
    },
    "heater-disabled": {
      code: "heater_disabled",
      message: "Enable firmware heater permission before calibration.",
      status: 409,
    },
    "steam-mode": {
      code: "brew_mode_required",
      message: "Switch to Brew before starting temperature calibration.",
      status: 409,
    },
    "extraction-active": {
      code: "extraction_active",
      message: "Temperature calibration requires extraction to be idle.",
      status: 409,
    },
    "cooldown-active": {
      code: "cooldown_active",
      message: "Temperature calibration requires cooldown to be idle.",
      status: 409,
    },
    "scale-calibration-active": {
      code: "calibration_in_progress",
      message: "Finish or cancel scale calibration first.",
      status: 409,
    },
    "unsafe-target": {
      code: "temperature_target_unsafe",
      message:
        "The saved targets would require a raw temperature above the cap.",
      status: 409,
    },
    persistence: {
      code: "persistence_failure",
      message: "Temperature calibration could not be persisted.",
      status: 500,
    },
  };
  const error = mapping[reason];
  return contractApiError(
    c,
    error.status,
    error.code,
    error.message,
  );
}

function contractApiError(
  c: Context,
  status: 400 | 401 | 409 | 413 | 415 | 422 | 429 | 500,
  code: ApiErrorCode,
  message: string,
): Response {
  const payload: ApiErrorResponse = ApiErrorResponseSchema.parse({
    error: { code, message },
  });
  return c.json(payload, status);
}

function isScaleControlRequest(
  value: unknown,
): value is {
  available?: boolean;
  stable?: boolean;
  weightDecigrams?: number;
} {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length === 0 ||
    keys.some(
      (key) =>
        key !== "available" &&
        key !== "stable" &&
        key !== "weightDecigrams",
    )
  ) {
    return false;
  }
  return (
    (record.available === undefined || typeof record.available === "boolean") &&
    (record.stable === undefined || typeof record.stable === "boolean") &&
    (record.weightDecigrams === undefined ||
      (Number.isInteger(record.weightDecigrams) &&
        (record.weightDecigrams as number) >= -500 &&
        (record.weightDecigrams as number) <= 10_500))
  );
}

async function readJson(
  c: Context,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await c.req.json<unknown>() };
  } catch {
    return { ok: false };
  }
}

function isAdvanceRequest(value: unknown): value is { milliseconds: number } {
  return (
    isExactObject(value, ["milliseconds"]) &&
    typeof value.milliseconds === "number" &&
    Number.isInteger(value.milliseconds) &&
    value.milliseconds >= 0 &&
    value.milliseconds <= 3_600_000
  );
}

function isTemperatureControlRequest(value: unknown): value is {
  boilerTemperatureC?: number;
  steamTemperatureC?: number;
} {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => key !== "boilerTemperatureC" && key !== "steamTemperatureC")) return false;
  return keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function isRawTemperatureControlRequest(value: unknown): value is {
  boilerTemperatureRawC?: number;
  steamTemperatureRawC?: number;
} {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => key !== "boilerTemperatureRawC" && key !== "steamTemperatureRawC")) return false;
  return keys.every((key) =>
    typeof value[key] === "number" && Number.isFinite(value[key]) &&
    (value[key] as number) >= -40 && (value[key] as number) <= 160);
}

function isSensorRequest(value: unknown): value is { sensor: TemperatureSensor } {
  return isExactObject(value, ["sensor"]) && TemperatureSensorSchema.safeParse(value.sensor).success;
}

function isSensorAvailabilityRequest(value: unknown): value is {
  sensor: TemperatureSensor;
  available: boolean;
} {
  return isExactObject(value, ["sensor", "available"]) &&
    TemperatureSensorSchema.safeParse(value.sensor).success &&
    typeof value.available === "boolean";
}

function isFaultRequest(value: unknown): value is {
  code: unknown;
  sensor?: TemperatureSensor;
} {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length < 1 || keys.length > 2 || !keys.includes("code") ||
      keys.some((key) => key !== "code" && key !== "sensor")) return false;
  return value.sensor === undefined || TemperatureSensorSchema.safeParse(value.sensor).success;
}

function isOutputFailureRequest(
  value: unknown,
): value is { command: SimulatedOutputCommand } {
  return (
    isExactObject(value, ["command"]) &&
    (value.command === "heater-off" ||
      value.command === "pump-running" ||
      value.command === "pump-off")
  );
}

function isExactObject(value: unknown, expectedKeys: string[]): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    keys.every((key) => expectedKeys.includes(key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
