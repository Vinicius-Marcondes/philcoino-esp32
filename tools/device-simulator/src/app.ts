import {
  ErrorResponseSchema,
  FaultCodeSchema,
  ModeRequestSchema,
  ModeResponseSchema,
  TemperatureSettingsRequestSchema,
  type ErrorCode,
  type ErrorResponse,
} from "@philcoino/protocol";
import { Hono, type Context, type Next } from "hono";

import { SimulatorMachine, type SimulatorMachineOptions } from "./model.ts";

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

  app.get("/healthz", (c) => c.json(machine.getHealth()));
  app.get("/api/v1/device", (c) => c.json(machine.getDevice()));

  app.use("/api/v1/state", requireBearer);
  app.use("/api/v1/settings/temperatures", requireBearer);
  app.use("/api/v1/mode", requireBearer);

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

    return c.json(ModeResponseSchema.parse({ mode: machine.setMode(parsed.data.mode) }));
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
    machine.setTemperatures(body.value);
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
  brewTemperatureC?: number;
  steamTemperatureC?: number;
} {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every(
      (key) => key === "brewTemperatureC" || key === "steamTemperatureC",
    ) &&
    keys.every(
      (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
    )
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
