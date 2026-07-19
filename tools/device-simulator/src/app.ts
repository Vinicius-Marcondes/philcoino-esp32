import {
  ApiV2ErrorResponseSchema,
  CooldownActiveConflictResponseSchema,
  ErrorResponseSchema,
  ExtractionActiveConflictResponseSchema,
  FaultCodeSchema,
  HeaterSettingsRequestSchema,
  HeaterSettingsResponseSchema,
  HistoryCursorSchema,
  ModeRequestSchema,
  ModeResponseSchema,
  ProfileSetSchema,
  StartCooldownRequestSchema,
  StartExtractionRequestSchema,
  TemperatureSettingsRequestSchema,
  type ErrorCode,
  type ErrorResponse,
  type ApiV2ErrorCode,
  type ApiV2ErrorResponse,
} from "@philcoino/protocol";
import { Hono, type Context, type Next } from "hono";

import {
  SimulatorMachine,
  type SimulatedOutputCommand,
  type SimulatorMachineOptions,
} from "./model.ts";

export const DEFAULT_SIMULATOR_TOKEN = "philcoino-dev-token";

export interface CreateSimulatorOptions extends SimulatorMachineOptions {
  token?: string;
}

export interface SimulatorApplication {
  app: Hono;
  machine: SimulatorMachine;
}

const MALFORMED_REQUEST_MESSAGE = "The JSON request body is malformed.";

export function createSimulator(
  options: CreateSimulatorOptions = {},
): SimulatorApplication {
  const machine = new SimulatorMachine(options);
  const token = options.token ?? DEFAULT_SIMULATOR_TOKEN;
  const app = new Hono();

  if (token.length === 0) {
    throw new Error("The simulator bearer token must not be empty.");
  }

  const requireBearer = async (c: Context, next: Next) => {
    const authorization = c.req.header("Authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);

    if (!match || match[1] !== token) {
      c.header("WWW-Authenticate", 'Bearer realm="philcoino"');
      return contractError(
        c,
        401,
        "unauthorized",
        "A valid bearer token is required.",
      );
    }

    await next();
  };
  const requireBearerV2 = async (c: Context, next: Next) => {
    const authorization = c.req.header("Authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);

    if (!match || match[1] !== token) {
      c.header("WWW-Authenticate", 'Bearer realm="philcoino"');
      return contractV2Error(
        c,
        401,
        "unauthorized",
        "A valid bearer token is required.",
      );
    }

    await next();
  };

  app.get("/healthz", (c) => c.json(machine.getHealth()));
  app.get("/api/v1/device", (c) => c.json(machine.getDevice()));

  app.use("/api/v1/state", requireBearer);
  app.use("/api/v1/settings/temperatures", requireBearer);
  app.use("/api/v1/mode", requireBearer);
  app.use("/api/v1/heater", requireBearer);
  app.use("/api/v1/faults/over-temperature/dismiss", requireBearer);
  app.use("/api/v2/state", requireBearerV2);
  app.use("/api/v2/history", requireBearerV2);
  app.use("/api/v2/profiles", requireBearerV2);
  app.use("/api/v2/extractions/start", requireBearerV2);
  app.use("/api/v2/extractions/stop", requireBearerV2);
  app.use("/api/v2/cooldowns/start", requireBearerV2);
  app.use("/api/v2/cooldowns/stop", requireBearerV2);

  app.get("/api/v1/state", (c) => c.json(machine.getState()));

  app.patch("/api/v1/settings/temperatures", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }

    const parsed = TemperatureSettingsRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      if (isTemperatureConstraintViolation(body.value)) {
        return contractError(
          c,
          400,
          "temperature_out_of_range",
          "Temperature targets must be whole values within their allowed ranges.",
        );
      }
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }

    return c.json(machine.updateTemperatureSettings(parsed.data));
  });

  app.put("/api/v1/mode", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }

    const parsed = ModeRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }

    if (machine.getState().status === "fault") {
      return contractError(
        c,
        409,
        "sensor_unavailable",
        "Mode cannot be changed while a machine fault is latched.",
      );
    }
    if (parsed.data.mode === "steam" && machine.hasActiveWorkflow()) {
      return contractError(
        c,
        409,
        "sensor_unavailable",
        "Steam cannot be selected while extraction or cooldown is active.",
      );
    }

    return c.json(ModeResponseSchema.parse({ mode: machine.setMode(parsed.data.mode) }));
  });

  app.put("/api/v1/heater", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }

    const parsed = HeaterSettingsRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }

    return c.json(
      HeaterSettingsResponseSchema.parse(
        machine.setHeaterEnabled(parsed.data.heaterEnabled),
      ),
    );
  });

  app.post("/api/v1/faults/over-temperature/dismiss", (c) => {
    const state = machine.dismissOverTemperature();
    if (state === null) {
      return contractError(
        c,
        409,
        "sensor_unavailable",
        "Over-temperature can only be dismissed after the active temperature returns to target.",
      );
    }
    return c.json(state);
  });

  app.get("/api/v2/state", (c) => c.json(machine.getStateV2()));

  app.get("/api/v2/history", (c) => {
    const cursor = historyCursor(c.req.url);
    if (!cursor.ok) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        "The history cursor is malformed.",
      );
    }
    const page = machine.getHistoryPage(cursor.value);
    if (page === null) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        "The history cursor is outside the current sequence.",
      );
    }
    return c.json(page);
  });

  app.get("/api/v2/profiles", (c) => c.json(machine.getProfiles()));

  app.put("/api/v2/profiles", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        MALFORMED_REQUEST_MESSAGE,
      );
    }
    const parsed = ProfileSetSchema.safeParse(body.value);
    if (!parsed.success) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        "The complete profile set is invalid.",
      );
    }

    const result = machine.replaceProfiles(parsed.data);
    if (!result.ok && result.reason === "active") {
      return extractionActiveConflict(
        c,
        result.activeExtraction,
        "Profiles cannot be replaced while extraction is active.",
      );
    }
    if (!result.ok && result.reason === "cooldown-active") {
      return cooldownActiveConflict(
        c,
        result.activeCooldown,
        "Profiles cannot be replaced while cooldown is active.",
      );
    }
    if (!result.ok) {
      return contractV2Error(
        c,
        500,
        "persistence_failure",
        "The complete profile set could not be persisted.",
      );
    }
    return c.json(result.profiles);
  });

  app.post("/api/v2/extractions/start", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        MALFORMED_REQUEST_MESSAGE,
      );
    }
    const parsed = StartExtractionRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        "The extraction Start request is invalid.",
      );
    }

    const result = machine.startExtraction(
      parsed.data.idempotencyKey,
      parsed.data.selection,
    );
    if (!result.ok && result.reason === "active") {
      return extractionActiveConflict(
        c,
        result.activeExtraction,
        "A different extraction is already active.",
      );
    }
    if (!result.ok && result.reason === "cooldown-active") {
      return cooldownActiveConflict(
        c,
        result.activeCooldown,
        "Extraction cannot start while cooldown is active.",
      );
    }
    if (!result.ok && result.reason === "brew-mode-required") {
      return contractV2Error(
        c,
        409,
        "brew_mode_required",
        "Switch the machine to Brew before starting extraction.",
      );
    }
    if (!result.ok && result.reason === "idempotency-mismatch") {
      return contractV2Error(
        c,
        409,
        "idempotency_mismatch",
        "The idempotency key was already used with a different selection.",
      );
    }
    if (!result.ok) {
      return contractV2Error(
        c,
        409,
        "profile_not_configured",
        "The selected custom profile slot is empty.",
      );
    }
    return c.json(result.extraction);
  });

  app.post("/api/v2/extractions/stop", (c) =>
    c.json(machine.stopExtraction()),
  );

  app.post("/api/v2/cooldowns/start", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        MALFORMED_REQUEST_MESSAGE,
      );
    }
    const parsed = StartCooldownRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        "The cooldown Start request is invalid.",
      );
    }

    const result = machine.startCooldown(parsed.data.idempotencyKey);
    if (result.ok) {
      return c.json(result.cooldown);
    }
    if (result.reason === "extraction-active") {
      return extractionActiveConflict(
        c,
        result.activeExtraction,
        "Cooldown cannot start while extraction is active.",
      );
    }
    if (result.reason === "cooldown-active") {
      return cooldownActiveConflict(
        c,
        result.activeCooldown,
        "A different cooldown is already active.",
      );
    }
    if (result.reason === "cooldown-not-required") {
      return contractV2Error(
        c,
        409,
        "cooldown_not_required",
        "The Brew-effective temperature must be above the current Brew target.",
      );
    }
    if (result.reason === "sensor-unavailable") {
      return contractV2Error(
        c,
        409,
        "sensor_unavailable",
        "Cooldown requires a valid boiler temperature reading.",
      );
    }
    if (result.reason === "machine-faulted") {
      return contractV2Error(
        c,
        409,
        "machine_faulted",
        "Cooldown cannot start while a machine fault is latched.",
      );
    }
    return contractV2Error(
      c,
      500,
      "internal_error",
      "The simulator could not apply the cooldown output commands.",
    );
  });

  app.post("/api/v2/cooldowns/stop", (c) => {
    const result = machine.stopCooldown();
    return result.ok
      ? c.json(result.cooldown)
      : contractV2Error(
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
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    machine.advance(body.value.milliseconds);
    return c.json(machine.getState());
  });

  app.put("/_simulator/temperatures", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isTemperatureControlRequest(body.value)) {
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    machine.setTemperature(body.value.boilerTemperatureC);
    return c.json(machine.getState());
  });

  app.put("/_simulator/fault", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isExactObject(body.value, ["code"])) {
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    const code = FaultCodeSchema.safeParse(body.value.code);
    if (!code.success) {
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    machine.injectFault(code.data);
    return c.json(machine.getState());
  });

  app.post("/_simulator/fail-next-profile-save", (c) => {
    machine.injectNextProfileSaveFailure();
    return c.json({ status: "armed" });
  });

  app.post("/_simulator/fail-next-output-command", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isOutputFailureRequest(body.value)) {
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    machine.injectNextOutputFailure(body.value.command);
    return c.json({ command: body.value.command, status: "armed" });
  });

  return { app, machine };
}

function contractError(
  c: Context,
  status: 400 | 401 | 409,
  code: ErrorCode,
  message: string,
): Response {
  const payload: ErrorResponse = ErrorResponseSchema.parse({
    error: { code, message },
  });
  return c.json(payload, status);
}

function historyCursor(
  requestUrl: string,
): { ok: true; value: undefined | { bootId: string; afterSequence: number } } | { ok: false } {
  const parameters = new URL(requestUrl).searchParams;
  for (const key of parameters.keys()) {
    if (key !== "bootId" && key !== "afterSequence") {
      return { ok: false };
    }
    if (parameters.getAll(key).length !== 1) {
      return { ok: false };
    }
  }
  const bootId = parameters.get("bootId");
  const sequenceText = parameters.get("afterSequence");
  if (bootId === null && sequenceText === null) {
    return { ok: true, value: undefined };
  }
  if (
    bootId === null ||
    sequenceText === null ||
    !/^(0|[1-9][0-9]*)$/.test(sequenceText)
  ) {
    return { ok: false };
  }
  const parsed = HistoryCursorSchema.safeParse({
    bootId,
    afterSequence: Number(sequenceText),
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

function contractV2Error(
  c: Context,
  status: 400 | 401 | 409 | 500,
  code: ApiV2ErrorCode,
  message: string,
): Response {
  const payload: ApiV2ErrorResponse = ApiV2ErrorResponseSchema.parse({
    error: { code, message },
  });
  return c.json(payload, status);
}

function extractionActiveConflict(
  c: Context,
  activeExtraction: ReturnType<SimulatorMachine["getExtractionState"]>,
  message: string,
): Response {
  const payload = ExtractionActiveConflictResponseSchema.parse({
    error: { code: "extraction_active", message },
    activeExtraction,
  });
  return c.json(payload, 409);
}

function cooldownActiveConflict(
  c: Context,
  activeCooldown: ReturnType<SimulatorMachine["getCooldownState"]>,
  message: string,
): Response {
  const payload = CooldownActiveConflictResponseSchema.parse({
    error: { code: "cooldown_active", message },
    activeCooldown,
  });
  return c.json(payload, 409);
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

function isTemperatureConstraintViolation(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((key) => key === "brewTargetC" || key === "steamTargetC") &&
    keys.every((key) => typeof value[key] === "number")
  );
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
  boilerTemperatureC: number;
} {
  return (
    isExactObject(value, ["boilerTemperatureC"]) &&
    typeof value.boilerTemperatureC === "number" &&
    Number.isFinite(value.boilerTemperatureC)
  );
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
