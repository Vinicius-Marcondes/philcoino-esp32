import {
  ApiErrorResponseSchema,
  CompleteScaleCalibrationRequestSchema,
  ExtractionTelemetryCursorSchema,
  HeaterSettingsRequestSchema,
  HealthResponseSchema,
  MachineStateV4Schema,
  ModeRequestSchema,
  SettingsRequestSchema,
  StartCooldownRequestSchema,
  StartExtractionRequestSchema,
  TemperatureCalibrationSessionRequestSchema,
  UpdateTemperatureCalibrationCandidateRequestSchema,
  type CompleteScaleCalibrationRequest,
  type ExtractionTelemetryCursor,
  type ExtractionTelemetryPage,
  type HealthResponse,
  type MachineStateV4,
  type ModeRequest,
  type SettingsRequest,
  type StartCooldownRequest,
  type StartExtractionRequest,
  type TemperatureCalibrationSessionRequest,
  type TemperatureSensor,
  type UpdateTemperatureCalibrationCandidateRequest,
} from "@philcoino/protocol";

import { ApiClientError } from "./api-client-error";
import { normalizeDeviceAddress } from "./device-address";
import {
  ExtractionSseParser,
  ExtractionSseProtocolError,
} from "../telemetry/extraction-sse-parser";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;

type SafeParseResult<T> =
  | { data: T; success: true }
  | { error?: unknown; success: false };

interface RuntimeSchema<T> {
  safeParse(value: unknown): SafeParseResult<T>;
}

export interface DeviceFetchRequestInit {
  body?: string;
  headers: Record<string, string>;
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  signal: AbortSignal;
}

export interface DeviceFetchResponse {
  body?: ReadableStream<Uint8Array> | null;
  json(): Promise<unknown>;
  ok: boolean;
  status: number;
}

export type FetchImplementation = (
  url: string,
  init: DeviceFetchRequestInit,
) => Promise<DeviceFetchResponse>;

export interface DeviceApiClientOptions {
  accessToken: string;
  certificateSpkiSha256: string;
  fetch: FetchImplementation;
  origin: string;
  timeoutMs?: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export class DeviceApiClient {
  readonly origin: string;

  private readonly accessToken: string;
  private readonly certificateSpkiSha256: string;
  private readonly fetch: FetchImplementation;
  private readonly timeoutMs: number;
  private acceptedBootId: string | null = null;
  private acceptedRevision = -1;

  constructor(options: DeviceApiClientOptions) {
    this.origin = normalizeDeviceAddress(options.origin);
    this.timeoutMs = validateTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (!/^[A-Za-z0-9_-]{43}$/u.test(options.accessToken)) {
      throw new TypeError("The access token must be a 256-bit base64url value.");
    }
    if (!/^[A-Za-z0-9_-]{43}$/u.test(options.certificateSpkiSha256)) {
      throw new TypeError("The certificate pin must be a SHA-256 base64url value.");
    }
    this.accessToken = options.accessToken;
    this.certificateSpkiSha256 = options.certificateSpkiSha256;
    this.fetch = options.fetch;
  }

  getHealth(options: RequestOptions = {}): Promise<HealthResponse> {
    return this.request("/healthz", HealthResponseSchema, "GET", undefined, options);
  }

  getState(options: RequestOptions = {}): Promise<MachineStateV4> {
    return this.requestState("/api/v4/state", "GET", undefined, options);
  }

  updateSettings(
    settings: SettingsRequest,
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    const parsed = SettingsRequestSchema.safeParse(settings);
    if (!parsed.success) {
      throw new ApiClientError("invalid-request", "The settings request is invalid.");
    }
    return this.requestState(
      "/api/v4/settings",
      "PATCH",
      parsed.data,
      options,
    );
  }

  updateTemperatureSettings(
    settings: Pick<SettingsRequest, "brewTargetC" | "steamTargetC">,
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    return this.updateSettings(settings, options);
  }

  updateSteamReadyTimeout(
    steamReadyTimeoutMs: NonNullable<SettingsRequest["steamReadyTimeoutMs"]>,
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    return this.updateSettings({ steamReadyTimeoutMs }, options);
  }

  setMode(
    request: ModeRequest,
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    const parsed = ModeRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError("invalid-request", "The mode request is invalid.");
    }
    return this.requestState("/api/v4/mode", "PUT", parsed.data, options);
  }

  setHeaterEnabled(
    request: { enabled: boolean },
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    const parsed = HeaterSettingsRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The heater permission request is invalid.",
      );
    }
    return this.requestState(
      "/api/v4/heater-permission",
      "PUT",
      parsed.data,
      options,
    );
  }

  dismissOverTemperature(
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    return this.requestState(
      "/api/v4/faults/over-temperature/dismiss",
      "POST",
      undefined,
      options,
    );
  }

  startTemperatureCalibration(
    sensor: TemperatureSensor,
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    return this.requestState(
      `/api/v4/temperature-calibrations/${sensor}/current`,
      "POST",
      undefined,
      options,
    );
  }

  updateTemperatureCalibrationCandidate(
    sensor: TemperatureSensor,
    request: UpdateTemperatureCalibrationCandidateRequest,
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    const parsed =
      UpdateTemperatureCalibrationCandidateRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The temperature calibration candidate is invalid.",
      );
    }
    return this.requestState(
      `/api/v4/temperature-calibrations/${sensor}/current`,
      "PATCH",
      parsed.data,
      options,
    );
  }

  saveTemperatureCalibration(
    sensor: TemperatureSensor,
    request: TemperatureCalibrationSessionRequest,
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    return this.temperatureCalibrationMutation(sensor, "PUT", request, options);
  }

  cancelTemperatureCalibration(
    sensor: TemperatureSensor,
    request: TemperatureCalibrationSessionRequest,
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    return this.temperatureCalibrationMutation(sensor, "DELETE", request, options);
  }

  renewTemperatureCalibration(
    sensor: TemperatureSensor,
    request: TemperatureCalibrationSessionRequest,
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    return this.temperatureCalibrationMutation(sensor, "POST", request, options, true);
  }

  startScaleCalibration(
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    return this.requestState(
      "/api/v4/scale-calibrations/current",
      "POST",
      undefined,
      options,
    );
  }

  completeScaleCalibration(
    request: CompleteScaleCalibrationRequest,
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    const parsed = CompleteScaleCalibrationRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The calibration reference weight is invalid.",
      );
    }
    return this.requestState(
      "/api/v4/scale-calibrations/current",
      "PUT",
      parsed.data,
      options,
    );
  }

  cancelScaleCalibration(
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    return this.requestState(
      "/api/v4/scale-calibrations/current",
      "DELETE",
      undefined,
      options,
    );
  }

  acknowledgeScaleWarning(
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    return this.requestState(
      "/api/v4/scale/warnings/acknowledge",
      "POST",
      undefined,
      options,
    );
  }

  startExtraction(
    request: StartExtractionRequest,
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    const parsed = StartExtractionRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The extraction Start request is invalid.",
      );
    }
    return this.requestState(
      "/api/v4/extractions",
      "POST",
      parsed.data,
      options,
    );
  }

  stopExtraction(options: RequestOptions = {}): Promise<MachineStateV4> {
    return this.requestState(
      "/api/v4/extractions/current",
      "DELETE",
      undefined,
      options,
    );
  }

  startCooldown(
    request: StartCooldownRequest,
    options: RequestOptions = {},
  ): Promise<MachineStateV4> {
    const parsed = StartCooldownRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The cooldown Start request is invalid.",
      );
    }
    return this.requestState(
      "/api/v4/cooldowns",
      "POST",
      parsed.data,
      options,
    );
  }

  stopCooldown(options: RequestOptions = {}): Promise<MachineStateV4> {
    return this.requestState(
      "/api/v4/cooldowns/current",
      "DELETE",
      undefined,
      options,
    );
  }

  async streamExtractionTelemetry(
    cursor: ExtractionTelemetryCursor | undefined,
    options: RequestOptions & {
      onPage(page: ExtractionTelemetryPage): Promise<void> | void;
    },
  ): Promise<void> {
    if (
      cursor !== undefined &&
      !ExtractionTelemetryCursorSchema.safeParse(cursor).success
    ) {
      throw new ApiClientError("invalid-request", "The telemetry cursor is invalid.");
    }
    const query =
      cursor === undefined
        ? ""
        : `?extractionId=${encodeURIComponent(cursor.extractionId)}&bootId=${encodeURIComponent(cursor.bootId)}&afterSequence=${cursor.afterSequence}`;
    const endpoint = `/api/v4/extractions/current/stream${query}`;
    const abort = createRequestAbort(options.signal, this.timeoutMs);
    try {
      const response = await this.fetch(`${this.origin}${endpoint}`, {
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${this.accessToken}`,
          "X-Philcoino-SPKI-SHA256": this.certificateSpkiSha256,
        },
        method: "GET",
        signal: abort.controller.signal,
      });
      abort.disableTimeout();
      if (!response.ok) await throwResponseError(response, endpoint);
      if (response.body === undefined || response.body === null) {
        throw new ApiClientError("protocol", "The telemetry stream has no body.", {
          endpoint,
          status: response.status,
        });
      }
      const reader = response.body.getReader();
      const parser = new ExtractionSseParser();
      try {
        while (true) {
          const { done, value } = await reader.read();
          const pages = done ? parser.finish() : parser.push(value);
          for (const page of pages) await options.onPage(page);
          if (done) return;
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (abort.controller.signal.aborted) {
        throw abort.reason() === "timeout"
          ? new ApiClientError("timeout", "The telemetry stream timed out.", {
              endpoint,
            })
          : new ApiClientError("cancelled", "The telemetry stream was cancelled.", {
              endpoint,
            });
      }
      if (error instanceof ExtractionSseProtocolError) {
        throw new ApiClientError("protocol", error.message, { endpoint });
      }
      if (error instanceof ApiClientError) throw error;
      throw new ApiClientError("offline", "The telemetry stream disconnected.", {
        endpoint,
      });
    } finally {
      abort.dispose();
    }
  }

  private temperatureCalibrationMutation(
    sensor: TemperatureSensor,
    method: "DELETE" | "POST" | "PUT",
    request: TemperatureCalibrationSessionRequest,
    options: RequestOptions,
    lease = false,
  ): Promise<MachineStateV4> {
    const parsed = TemperatureCalibrationSessionRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new ApiClientError(
        "invalid-request",
        "The temperature calibration session is invalid.",
      );
    }
    return this.requestState(
      lease
        ? `/api/v4/temperature-calibrations/${sensor}/current/lease`
        : `/api/v4/temperature-calibrations/${sensor}/current`,
      method,
      parsed.data,
      options,
    );
  }

  private async requestState(
    path: string,
    method: DeviceFetchRequestInit["method"],
    body: unknown,
    options: RequestOptions,
  ): Promise<MachineStateV4> {
    const state = await this.request(
      path,
      MachineStateV4Schema,
      method,
      body,
      options,
    );
    if (this.acceptedBootId === state.bootId) {
      if (state.revision < this.acceptedRevision) {
        throw new ApiClientError(
          "protocol",
          "The device returned an older state revision.",
          { endpoint: path },
        );
      }
    } else {
      this.acceptedBootId = state.bootId;
      this.acceptedRevision = -1;
    }
    this.acceptedRevision = state.revision;
    return state;
  }

  private async request<T>(
    path: string,
    schema: RuntimeSchema<T>,
    method: DeviceFetchRequestInit["method"],
    body: unknown,
    options: RequestOptions,
  ): Promise<T> {
    const abort = createRequestAbort(options.signal, this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${this.accessToken}`,
        "X-Philcoino-SPKI-SHA256": this.certificateSpkiSha256,
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await this.fetch(`${this.origin}${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers,
        method,
        signal: abort.controller.signal,
      });
      if (!response.ok) await throwResponseError(response, path);
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) {
        throw new ApiClientError(
          "protocol",
          "The device response does not match API v4.",
          { endpoint: path, status: response.status },
        );
      }
      return parsed.data;
    } catch (error) {
      if (abort.controller.signal.aborted) {
        throw abort.reason() === "timeout"
          ? new ApiClientError("timeout", "The device request timed out.", {
              endpoint: path,
            })
          : new ApiClientError("cancelled", "The device request was cancelled.", {
              endpoint: path,
            });
      }
      if (error instanceof ApiClientError) throw error;
      throw new ApiClientError("offline", "The device could not be reached.", {
        endpoint: path,
      });
    } finally {
      abort.dispose();
    }
  }
}

async function throwResponseError(
  response: DeviceFetchResponse,
  endpoint: string,
): Promise<never> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiClientError("http", "The device rejected the request.", {
      endpoint,
      status: response.status,
    });
  }
  const parsed = ApiErrorResponseSchema.safeParse(body);
  if (parsed.success) {
    throw new ApiClientError(
      parsed.data.error.code === "unauthorized" ? "unauthorized" : "http",
      parsed.data.error.message,
      {
        endpoint,
        response: parsed.data,
        status: response.status,
      },
    );
  }
  throw new ApiClientError("http", "The device rejected the request.", {
    endpoint,
    status: response.status,
  });
}

function validateTimeout(timeoutMs: number): number {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new TypeError("The timeout must be a positive bounded integer.");
  }
  return timeoutMs;
}

function createRequestAbort(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let firstCause: "cancelled" | "timeout" | null = null;
  const cancel = () => {
    firstCause ??= "cancelled";
    controller.abort();
  };
  parent?.addEventListener("abort", cancel, { once: true });
  if (parent?.aborted) cancel();
  let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    firstCause ??= "timeout";
    controller.abort();
  }, timeoutMs);
  const disableTimeout = () => {
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
  };
  return {
    controller,
    disableTimeout,
    dispose() {
      disableTimeout();
      parent?.removeEventListener("abort", cancel);
    },
    reason: () => firstCause,
  };
}
