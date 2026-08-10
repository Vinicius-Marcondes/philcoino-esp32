import {
  ApiV2ErrorResponseSchema,
  CooldownActiveConflictResponseSchema,
  CompleteScaleCalibrationRequestSchema,
  ErrorResponseSchema,
  EXTRACTION_TELEMETRY_HEARTBEAT_INTERVAL_MS,
  ExtractionTelemetryCursorSchema,
  ExtractionActiveConflictResponseSchema,
  FaultCodeSchema,
  HeaterSettingsRequestSchema,
  HeaterSettingsResponseSchema,
  ModeRequestSchema,
  ModeResponseSchema,
  StartCooldownRequestSchema,
  StartExtractionRequestSchema,
  SteamControlSettingsRequestSchema,
  TemperatureCalibrationSessionIdSchema,
  TemperatureCalibrationSessionRequestSchema,
  TemperatureSettingsRequestSchema,
  UpdateTemperatureCalibrationCandidateRequestSchema,
  WeightedExtractionTraceCursorSchema,
  type ErrorCode,
  type ErrorResponse,
  type ApiV2ErrorCode,
  type ApiV2ErrorResponse,
  type ExtractionTelemetryCursor,
  type ExtractionTelemetryPage,
} from "@philcoino/protocol";
import { Hono, type Context, type Next } from "hono";

import {
  SimulatorMachine,
  type SimulatedOutputCommand,
  type SimulatorMachineOptions,
  type TemperatureCalibrationOperationResult,
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
  let extractionStreamActive = false;

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
  app.use("/api/v2/settings/steam-control", requireBearerV2);
  app.use("/api/v2/scale", requireBearerV2);
  app.use("/api/v2/scale/*", requireBearerV2);
  app.use("/api/v2/extractions/start", requireBearerV2);
  app.use("/api/v2/extractions/stop", requireBearerV2);
  app.use("/api/v2/extractions/stream", requireBearerV2);
  app.use("/api/v2/cooldowns/start", requireBearerV2);
  app.use("/api/v2/cooldowns/stop", requireBearerV2);
  app.use("/api/v2/temperature-calibration", requireBearerV2);
  app.use("/api/v2/temperature-calibration/*", requireBearerV2);

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
    if (machine.abortTemperatureCalibrationForConflict()) {
      return contractError(
        c,
        409,
        "sensor_unavailable",
        "Temperature calibration was cancelled before changing targets.",
      );
    }
    if (!machine.temperatureTargetsAreSafe(parsed.data)) {
      return contractError(
        c,
        400,
        "temperature_target_unsafe",
        "The requested target would require a raw temperature above the cap.",
      );
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
    if (machine.abortTemperatureCalibrationForConflict()) {
      return contractError(
        c,
        409,
        "sensor_unavailable",
        "Temperature calibration was cancelled before changing mode.",
      );
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
    if (machine.abortTemperatureCalibrationForConflict()) {
      return contractError(
        c,
        409,
        "sensor_unavailable",
        "Temperature calibration was cancelled before changing heater permission.",
      );
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

  app.get("/api/v2/state", (c) => {
    const query = new URL(c.req.url).searchParams;
    if ([...query.keys()].length > 0) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        "The state query is malformed.",
      );
    }
    return c.json(machine.getStateV2());
  });

  app.get("/api/v2/settings/steam-control", (c) =>
    c.json(machine.getSteamControlState()),
  );

  app.patch("/api/v2/settings/steam-control", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        MALFORMED_REQUEST_MESSAGE,
      );
    }
    const parsed = SteamControlSettingsRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        "Steam-control settings must use the documented whole-degree and whole-minute ranges.",
      );
    }
    if (machine.getState().status === "fault") {
      return contractV2Error(
        c,
        409,
        "machine_faulted",
        "Steam-control settings cannot change while a machine fault is latched.",
      );
    }
    const state = machine.updateSteamControlSettings(parsed.data);
    return state === null
      ? contractV2Error(
          c,
          500,
          "internal_error",
          "The simulator failed off while persisting steam-control settings.",
        )
      : c.json(state);
  });

  app.get("/api/v2/temperature-calibration", (c) => {
    const calibrationId = temperatureCalibrationQuery(c.req.url);
    if (!calibrationId.ok) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        "The temperature calibration query is malformed.",
      );
    }
    const result = machine.getTemperatureCalibration(calibrationId.value);
    return result.ok
      ? c.json(result.state)
      : temperatureCalibrationError(c, result.reason);
  });

  app.post("/api/v2/temperature-calibration/start", (c) => {
    const result = machine.startTemperatureCalibration();
    return result.ok
      ? c.json(result.state)
      : temperatureCalibrationError(c, result.reason);
  });

  app.put("/api/v2/temperature-calibration/candidate", async (c) => {
    const body = await readJson(c);
    const parsed = body.ok
      ? UpdateTemperatureCalibrationCandidateRequestSchema.safeParse(
          body.value,
        )
      : null;
    if (parsed === null || !parsed.success) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        "The calibration candidate request is malformed.",
      );
    }
    const result = machine.updateTemperatureCalibrationCandidate(
      parsed.data.calibrationId,
      parsed.data.candidateRawTargetC,
    );
    return result.ok
      ? c.json(result.state)
      : temperatureCalibrationError(c, result.reason);
  });

  for (const operation of ["save", "cancel"] as const) {
    app.post(
      `/api/v2/temperature-calibration/${operation}`,
      async (c) => {
        const body = await readJson(c);
        const parsed = body.ok
          ? TemperatureCalibrationSessionRequestSchema.safeParse(body.value)
          : null;
        if (parsed === null || !parsed.success) {
          return contractV2Error(
            c,
            400,
            "malformed_request",
            "The calibration session request is malformed.",
          );
        }
        const result =
          operation === "save"
            ? machine.saveTemperatureCalibration(
                parsed.data.calibrationId,
              )
            : machine.cancelTemperatureCalibration(
                parsed.data.calibrationId,
              );
        return result.ok
          ? c.json(result.state)
          : temperatureCalibrationError(c, result.reason);
      },
    );
  }

  app.get("/api/v2/scale", (c) => c.json(machine.getScaleState()));
  app.get("/api/v2/scale/trace", (c) => {
    const cursor = weightedTraceCursor(c.req.url);
    if (!cursor.ok) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        "The weighted trace cursor is malformed.",
      );
    }
    const response = machine.getScaleTrace(cursor.value);
    return response === null
      ? contractV2Error(
          c,
          400,
          "malformed_request",
          "The weighted trace cursor is outside the retained sequence.",
        )
      : c.json(response);
  });

  app.post("/api/v2/scale/calibration/start", (c) => {
    if (machine.abortTemperatureCalibrationForConflict()) {
      return contractV2Error(
        c,
        409,
        "temperature_calibration_active",
        "Temperature calibration was cancelled before starting scale calibration.",
      );
    }
    const result = machine.startScaleCalibration();
    if (result === "ok") {
      return c.json(machine.getScaleState());
    }
    return contractV2Error(
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

  app.post("/api/v2/scale/calibration/complete", async (c) => {
    const body = await readJson(c);
    if (!body.ok) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        MALFORMED_REQUEST_MESSAGE,
      );
    }
    const parsed = CompleteScaleCalibrationRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      return contractV2Error(
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
      return c.json(machine.getScaleState());
    }
    if (result === "persistence") {
      return contractV2Error(
        c,
        500,
        "persistence_failure",
        "The scale calibration could not be persisted.",
      );
    }
    return contractV2Error(
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

  app.post("/api/v2/scale/calibration/cancel", (c) => {
    machine.cancelScaleCalibration();
    return c.json(machine.getScaleState());
  });

  app.post("/api/v2/scale/warnings/acknowledge", (c) => {
    machine.acknowledgeScaleWarning();
    return c.json(machine.getScaleState());
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
    if (machine.abortTemperatureCalibrationForConflict()) {
      return contractV2Error(
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
    if (!result.ok && result.reason.startsWith("scale-")) {
      const code = result.reason.replaceAll("-", "_") as ApiV2ErrorCode;
      return contractV2Error(
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
      return contractV2Error(
        c,
        500,
        "internal_error",
        "The simulator could not start the validated extraction.",
      );
    }
    return c.json(result.extraction);
  });

  app.post("/api/v2/extractions/stop", (c) =>
    c.json(machine.stopExtraction()),
  );

  app.get("/api/v2/extractions/stream", (c) => {
    const cursor = extractionTelemetryCursor(c.req.url);
    if (!cursor.ok) {
      return contractV2Error(
        c,
        400,
        "malformed_request",
        "The extraction telemetry cursor is malformed.",
      );
    }
    if (extractionStreamActive) {
      return contractV2Error(
        c,
        409,
        "stream_busy",
        "Another authenticated extraction telemetry subscriber is active.",
      );
    }
    const initial = machine.getExtractionTelemetryPage(cursor.value);
    if (!initial.ok) {
      return contractV2Error(
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
        encoder.encode(`event: telemetry\ndata: ${JSON.stringify(page)}\n\n`),
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
    if (machine.abortTemperatureCalibrationForConflict()) {
      return contractV2Error(
        c,
        409,
        "temperature_calibration_active",
        "Temperature calibration was cancelled before starting cooldown.",
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

  app.put("/_simulator/raw-temperature", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isRawTemperatureControlRequest(body.value)) {
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    machine.setTemperature(body.value.boilerTemperatureRawC);
    return c.json(machine.getRawTemperature());
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

  app.post("/_simulator/fail-next-temperature-calibration-save", (c) => {
    machine.injectNextTemperatureCalibrationSaveFailure();
    return c.json({ status: "armed" });
  });

  app.post("/_simulator/fail-next-steam-control-save", (c) => {
    machine.injectNextSteamControlSaveFailure();
    return c.json({ status: "armed" });
  });

  app.post("/_simulator/corrupt-temperature-calibration", (c) => {
    machine.corruptTemperatureCalibrationStorage();
    return c.json({ status: "corrupted" });
  });

  app.post("/_simulator/corrupt-steam-control", (c) => {
    machine.corruptSteamControlStorage();
    return c.json({ status: "corrupted" });
  });

  app.post("/_simulator/fail-next-output-command", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isOutputFailureRequest(body.value)) {
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    machine.injectNextOutputFailure(body.value.command);
    return c.json({ command: body.value.command, status: "armed" });
  });

  app.put("/_simulator/scale", async (c) => {
    const body = await readJson(c);
    if (!body.ok || !isScaleControlRequest(body.value)) {
      return contractError(c, 400, "malformed_request", MALFORMED_REQUEST_MESSAGE);
    }
    machine.setScaleState(body.value);
    return c.json(machine.getScaleState());
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

function weightedTraceCursor(
  requestUrl: string,
):
  | {
      ok: true;
      value:
        | undefined
        | { extractionId: string; bootId: string; afterSequence: number };
    }
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
  const parsed = WeightedExtractionTraceCursorSchema.safeParse({
    extractionId,
    bootId,
    afterSequence: Number(sequenceText),
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
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

function temperatureCalibrationError(
  c: Context,
  reason: Extract<
    TemperatureCalibrationOperationResult,
    { ok: false }
  >["reason"],
): Response {
  const mapping: Record<
    typeof reason,
    { code: ApiV2ErrorCode; message: string; status: 409 | 500 }
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
  return contractV2Error(
    c,
    error.status,
    error.code,
    error.message,
  );
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

function isRawTemperatureControlRequest(value: unknown): value is {
  boilerTemperatureRawC: number;
} {
  return (
    isExactObject(value, ["boilerTemperatureRawC"]) &&
    typeof value.boilerTemperatureRawC === "number" &&
    Number.isFinite(value.boilerTemperatureRawC) &&
    value.boilerTemperatureRawC >= -40 &&
    value.boilerTemperatureRawC <= 160
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
