import {
  ExtractionTelemetryPageSchema,
  type ExtractionTelemetryPage,
} from "@philcoino/protocol";

const MAX_EVENT_BUFFER_LENGTH = 64 * 1024;

export class ExtractionSseProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionSseProtocolError";
  }
}

export class ExtractionSseParser {
  private buffer = "";
  private readonly decoder = new TextDecoder();

  push(chunk: Uint8Array): ExtractionTelemetryPage[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    const pages = this.drain(false);
    if (this.buffer.length > MAX_EVENT_BUFFER_LENGTH) {
      throw new ExtractionSseProtocolError("The SSE event exceeded its fixed limit.");
    }
    return pages;
  }

  finish(): ExtractionTelemetryPage[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(final: boolean): ExtractionTelemetryPage[] {
    const pages: ExtractionTelemetryPage[] = [];
    while (true) {
      const boundary = this.buffer.search(/\r?\n\r?\n/);
      if (boundary < 0) break;
      const match = this.buffer.slice(boundary).match(/^\r?\n\r?\n/);
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + (match?.[0].length ?? 2));
      const page = parseFrame(frame);
      if (page !== null) pages.push(page);
    }
    if (final && this.buffer.trim().length > 0) {
      throw new ExtractionSseProtocolError("The SSE stream ended inside an event.");
    }
    return pages;
  }
}

function parseFrame(frame: string): ExtractionTelemetryPage | null {
  const lines = frame.split(/\r?\n/);
  if (lines.every((line) => line.length === 0 || line.startsWith(":"))) {
    return null;
  }
  let eventName = "message";
  const data: string[] = [];
  for (const line of lines) {
    if (line.length === 0 || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value =
      colon < 0
        ? ""
        : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") eventName = value;
    else if (field === "data") data.push(value);
  }
  if (eventName !== "telemetry") {
    throw new ExtractionSseProtocolError("The device sent an unknown SSE event.");
  }
  if (data.length === 0) {
    throw new ExtractionSseProtocolError("The telemetry SSE event had no data.");
  }
  let value: unknown;
  try {
    value = JSON.parse(data.join("\n"));
  } catch {
    throw new ExtractionSseProtocolError("The telemetry SSE event was not JSON.");
  }
  const parsed = ExtractionTelemetryPageSchema.safeParse(value);
  if (!parsed.success) {
    throw new ExtractionSseProtocolError("The telemetry SSE event violated the protocol.");
  }
  return parsed.data;
}
