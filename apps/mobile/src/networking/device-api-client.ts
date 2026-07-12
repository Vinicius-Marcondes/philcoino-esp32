import {
  ApiV2ErrorResponseSchema,
  DeviceResponseSchema,
  ErrorResponseSchema,
  ExtractionActiveConflictResponseSchema,
  HeaterSettingsRequestSchema,
  HeaterSettingsResponseSchema,
  HealthResponseSchema,
  MachineStateSchema,
  MachineStateV2Schema,
  ModeRequestSchema,
  ModeResponseSchema,
  OverTemperatureDismissResponseSchema,
  ProfileSetSchema,
  StartExtractionRequestSchema,
  StartExtractionResponseSchema,
  StopExtractionResponseSchema,
  TemperatureSettingsRequestSchema,
  TemperatureSettingsResponseSchema,
  type DeviceResponse,
  type HeaterSettingsRequest,
  type HeaterSettingsResponse,
  type HealthResponse,
  type MachineState,
  type MachineStateV2,
  type ModeRequest,
  type ModeResponse,
  type OverTemperatureDismissResponse,
  type ProfileSet,
  type StartExtractionRequest,
  type StartExtractionResponse,
  type StopExtractionResponse,
  type TemperatureSettingsRequest,
  type TemperatureSettingsResponse,
} from "@philcoino/protocol";

import { ApiClientError } from "./api-client-error";
import { normalizeDeviceAddress } from "./device-address";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;

type SafeParseResult<T> =
  | { data: T; success: true }
  | { success: false };

interface RuntimeSchema<T> {
  safeParse(value: unknown): SafeParseResult<T>;
}

export interface DeviceFetchRequestInit {
  body?: string;
  headers: Record<string, string>;
  method: "GET" | "PATCH" | "POST" | "PUT";
  signal: AbortSignal;
}

export interface DeviceFetchResponse {
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
}

export type FetchImplementation = (
  url: string,
  init: DeviceFetchRequestInit,
) => Promise<DeviceFetchResponse>;

export interface DeviceApiClientOptions {
  address: string;
  fetch: FetchImplementation;
  timeoutMs?: number;
  token?: string;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export class DeviceApiClient {
  readonly address: string;

  private readonly fetch: FetchImplementation;
  private readonly timeoutMs: number;
  private readonly token?: string;

  constructor(options: DeviceApiClientOptions) {
    this.address = normalizeDeviceAddress(options.address);
    this.timeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    if (options.token !== undefined && options.token.length === 0) {
      throw new TypeError("The bearer token must not be empty.");
    }

    this.token = options.token;
    this.fetch = options.fetch;
  }

  getHealth(options: RequestOptions = {}): Promise<HealthResponse> {
    return this.request("/healthz", HealthResponseSchema, {}, options);
  }

  getDevice(options: RequestOptions = {}): Promise<DeviceResponse> {
    return this.request("/api/v1/device", DeviceResponseSchema, {}, options);
  }

  getState(options: RequestOptions = {}): Promise<MachineState> {
    return this.request(
      "/api/v1/state",
      MachineStateSchema,
      { authenticated: true },
      options,
    );
  }

  getStateV2(options: RequestOptions = {}): Promise<MachineStateV2> {
    return this.request(
      "/api/v2/state",
      MachineStateV2Schema,
      { authenticated: true, errorVersion: "v2" },
      options,
    );
  }

  getProfiles(options: RequestOptions = {}): Promise<ProfileSet> {
    return this.request(
      "/api/v2/profiles",
      ProfileSetSchema,
      { authenticated: true, errorVersion: "v2" },
      options,
    );
  }

  async replaceProfiles(
    profiles: ProfileSet,
    options: RequestOptions = {},
  ): Promise<ProfileSet> {
    const parsed = ProfileSetSchema.safeParse(profiles);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The complete profile set is invalid.",
      );
    }
    return await this.request(
      "/api/v2/profiles",
      ProfileSetSchema,
      {
        authenticated: true,
        body: parsed.data,
        errorVersion: "v2",
        method: "PUT",
      },
      options,
    );
  }

  async startExtraction(
    request: StartExtractionRequest,
    options: RequestOptions = {},
  ): Promise<StartExtractionResponse> {
    const parsed = StartExtractionRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The extraction Start request is invalid.",
      );
    }
    return await this.request(
      "/api/v2/extractions/start",
      StartExtractionResponseSchema,
      {
        authenticated: true,
        body: parsed.data,
        errorVersion: "v2",
        method: "POST",
      },
      options,
    );
  }

  stopExtraction(
    options: RequestOptions = {},
  ): Promise<StopExtractionResponse> {
    return this.request(
      "/api/v2/extractions/stop",
      StopExtractionResponseSchema,
      { authenticated: true, errorVersion: "v2", method: "POST" },
      options,
    );
  }

  async updateTemperatureSettings(
    settings: TemperatureSettingsRequest,
    options: RequestOptions = {},
  ): Promise<TemperatureSettingsResponse> {
    const parsed = TemperatureSettingsRequestSchema.safeParse(settings);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The temperature settings request is invalid.",
      );
    }

    return await this.request(
      "/api/v1/settings/temperatures",
      TemperatureSettingsResponseSchema,
      {
        authenticated: true,
        body: parsed.data,
        method: "PATCH",
      },
      options,
    );
  }

  async setMode(
    request: ModeRequest,
    options: RequestOptions = {},
  ): Promise<ModeResponse> {
    const parsed = ModeRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError("invalid-request", "The mode request is invalid.");
    }

    return await this.request(
      "/api/v1/mode",
      ModeResponseSchema,
      {
        authenticated: true,
        body: parsed.data,
        method: "PUT",
      },
      options,
    );
  }

  async setHeaterEnabled(
    request: HeaterSettingsRequest,
    options: RequestOptions = {},
  ): Promise<HeaterSettingsResponse> {
    const parsed = HeaterSettingsRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The heater permission request is invalid.",
      );
    }

    return await this.request(
      "/api/v1/heater",
      HeaterSettingsResponseSchema,
      {
        authenticated: true,
        body: parsed.data,
        method: "PUT",
      },
      options,
    );
  }

  dismissOverTemperature(
    options: RequestOptions = {},
  ): Promise<OverTemperatureDismissResponse> {
    return this.request(
      "/api/v1/faults/over-temperature/dismiss",
      OverTemperatureDismissResponseSchema,
      {
        authenticated: true,
        method: "POST",
      },
      options,
    );
  }

  private async request<T>(
    path: string,
    schema: RuntimeSchema<T>,
    request: {
      authenticated?: boolean;
      body?: unknown;
      errorVersion?: "v1" | "v2";
      method?: "GET" | "PATCH" | "POST" | "PUT";
    },
    options: RequestOptions,
  ): Promise<T> {
    const abort = createRequestAbort(options.signal, this.timeoutMs);

    try {
      if (abort.controller.signal.aborted) {
        throw new ApiClientError(
          "cancelled",
          "The device request was cancelled.",
        );
      }

      const headers: Record<string, string> = { Accept: "application/json" };
      if (request.authenticated && this.token !== undefined) {
        headers.Authorization = `Bearer ${this.token}`;
      }
      if (request.body !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      const response = await this.fetch(`${this.address}${path}`, {
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
        headers,
        method: request.method ?? "GET",
        signal: abort.controller.signal,
      });

      if (!response.ok) {
        await throwResponseError(response, request.errorVersion ?? "v1");
      }

      return await parseResponse(response, schema);
    } catch (error) {
      if (abort.reason() === "timeout") {
        throw new ApiClientError("timeout", "The device request timed out.");
      }
      if (abort.reason() === "cancelled") {
        throw new ApiClientError("cancelled", "The device request was cancelled.");
      }
      if (error instanceof ApiClientError) {
        throw error;
      }
      throw new ApiClientError("offline", "The device could not be reached.");
    } finally {
      abort.dispose();
    }
  }
}

async function parseResponse<T>(
  response: DeviceFetchResponse,
  schema: RuntimeSchema<T>,
): Promise<T> {
  const body = await readJson(response);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiClientError(
      "protocol",
      "The device returned an invalid response.",
      { status: response.status },
    );
  }
  return parsed.data;
}

async function throwResponseError(
  response: DeviceFetchResponse,
  version: "v1" | "v2",
): Promise<never> {
  if (response.status === 404) {
    throw new ApiClientError("not-found", "No Philcoino device was found.", {
      status: response.status,
    });
  }

  const body = await readJson(response);
  const parsed =
    version === "v1"
      ? ErrorResponseSchema.safeParse(body)
      : parseV2ErrorResponse(body);
  if (!parsed.success) {
    throw new ApiClientError(
      "protocol",
      "The device returned an invalid error response.",
      { status: response.status },
    );
  }

  if (response.status === 401) {
    if (parsed.data.error.code !== "unauthorized") {
      throw new ApiClientError(
        "protocol",
        "The device returned an inconsistent authentication response.",
        { status: response.status },
      );
    }
    throw new ApiClientError("unauthorized", "The bearer token was rejected.", {
      response: parsed.data,
      status: response.status,
    });
  }

  throw new ApiClientError("http", "The device rejected the request.", {
    response: parsed.data,
    status: response.status,
  });
}

function parseV2ErrorResponse(body: unknown) {
  const activeConflict = ExtractionActiveConflictResponseSchema.safeParse(body);
  if (activeConflict.success) {
    return activeConflict;
  }
  return ApiV2ErrorResponseSchema.safeParse(body);
}

async function readJson(response: DeviceFetchResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiClientError(
      "protocol",
      "The device returned a non-JSON response.",
      { status: response.status },
    );
  }
}

function createRequestAbort(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let abortReason: "cancelled" | "timeout" | null = null;

  const abort = (reason: "cancelled" | "timeout") => {
    if (abortReason === null) {
      abortReason = reason;
      controller.abort();
    }
  };

  const abortFromCaller = () => abort("cancelled");
  if (externalSignal?.aborted) {
    abortFromCaller();
  } else {
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeout = setTimeout(() => abort("timeout"), timeoutMs);

  return {
    controller,
    dispose: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    },
    reason: () => abortReason,
  };
}

function validateTimeout(timeoutMs: number): number {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      `Request timeout must be a whole number from 1 to ${MAX_TIMEOUT_MS} milliseconds.`,
    );
  }
  return timeoutMs;
}
