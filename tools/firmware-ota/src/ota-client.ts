import {
  ApiErrorResponseSchema,
  FirmwareUpdateAcceptedSchema,
  PairingClientBindingSchema,
  PairingCompleteResponseSchema,
  PairingDeviceBindingSchema,
  PairingSessionProofResponseSchema,
  PairingSessionStartResponseSchema,
  type FirmwareUpdateAccepted,
} from "../../../packages/protocol/src/index.ts";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { hostname } from "node:os";
import { connect, type TLSSocket } from "node:tls";

import { SrpClientSession } from "../../device-simulator/src/srp.ts";

export interface OtaRequest {
  body: Uint8Array;
  bodyWriteTimeoutMs?: number;
  connectTimeoutMs?: number;
  expectedPin?: string;
  headers?: Record<string, string>;
  method: "POST";
  onConnectionAttempt?: (attempt: number, maximumAttempts: number) => void;
  onProgress?: (sent: number, total: number) => void;
  origin: string;
  path: string;
  responseTimeoutMs?: number;
}

export interface OtaResponse {
  body: Uint8Array;
  presentedPin: string;
  status: number;
}

export interface OtaTransport {
  request(request: OtaRequest): Promise<OtaResponse>;
}

export interface PairedOtaCredential {
  accessToken: string;
  certificatePin: string;
  clientId: string;
  deviceId: string;
}

export type PairingStage =
  | "connection"
  | "srp-start"
  | "client-proof"
  | "server-proof"
  | "certificate-binding"
  | "token-issue";

export type PairingStageReporter = (
  stage: PairingStage,
  detail: string,
) => void;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const maximumFirmwareImageBytes = 1_966_080;
const tlsConnectTimeoutMs = 12_000;
const pairingResponseTimeoutMs = 45_000;
const uploadRequestTimeoutMs = 180_000;
const uploadBodyWriteTimeoutMs = 90_000;
const socketWriteTimeoutMs = 10_000;

export function normalizeOtaOrigin(value: string): string {
  const candidate = value.includes("://") ? value : `https://${value}`;
  const parsed = new URL(candidate);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("OTA origin must be an HTTPS host without credentials or a path.");
  }
  return parsed.origin;
}

export function stableUpdaterClientId(deviceId: string, macHostname = hostname()): string {
  return createHash("sha256")
    .update(`philcoino:v4:mac-ota:${macHostname}:${deviceId}`)
    .digest("hex")
    .slice(0, 32);
}

export async function pairForFirmwareUpdate(
  originInput: string,
  pairingCode: string,
  transport: OtaTransport = tlsOtaTransport,
  reportStage: PairingStageReporter = () => undefined,
): Promise<PairedOtaCredential> {
  if (!/^[0-9]{8}$/u.test(pairingCode)) {
    throw new Error("The pairing code must contain exactly eight digits.");
  }
  const origin = normalizeOtaOrigin(originInput);
  const clientNonce = randomBytes(32);
  const srp = new SrpClientSession(pairingCode, (length) => randomBytes(length));
  reportStage("connection", `Opening HTTPS connection to ${new URL(origin).host}`);
  reportStage("srp-start", "Starting SRP session");
  const startedResponse = await transport.request({
    body: jsonBytes({
      clientName: "Philcoino Mac OTA",
      clientNonce: encodeBase64Url(clientNonce),
      clientPublicKey: encodeBase64Url(srp.publicKey),
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    onConnectionAttempt: (attempt, maximumAttempts) =>
      reportStage("connection", `TLS attempt ${attempt}/${maximumAttempts}`),
    origin,
    path: "/api/v4/pairing/sessions",
    responseTimeoutMs: pairingResponseTimeoutMs,
  });
  ensureStatus(startedResponse, 200, "SRP session start");
  const started = PairingSessionStartResponseSchema.parse(
    parseJson(startedResponse.body),
  );
  reportStage("client-proof", "Calculating and sending client proof");
  const clientProof = await srp.processChallenge(
    decodeBase64Url(started.salt),
    decodeBase64Url(started.serverPublicKey),
  );
  const proofResponse = await transport.request({
    body: jsonBytes({ clientProof: encodeBase64Url(clientProof) }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    origin,
    path: `/api/v4/pairing/sessions/${started.sessionId}/proof`,
    responseTimeoutMs: pairingResponseTimeoutMs,
  });
  ensureStatus(proofResponse, 200, "SRP proof");
  if (proofResponse.presentedPin !== startedResponse.presentedPin) {
    throw new Error("The certificate changed during pairing.");
  }
  const proof = PairingSessionProofResponseSchema.parse(
    parseJson(proofResponse.body),
  );
  reportStage("server-proof", "Verifying server proof");
  const deviceNonce = decodeBase64Url(proof.deviceNonce);
  if (!srp.verifyServer(decodeBase64Url(proof.serverProof), deviceNonce)) {
    throw new Error("The ESP32 SRP server proof is invalid.");
  }
  reportStage("certificate-binding", "Verifying authenticated certificate binding");
  const deviceBinding = PairingDeviceBindingSchema.parse(JSON.parse(
    await srp.decrypt(decodeBase64Url(proof.encryptedDeviceBinding)),
  ) as unknown);
  if (
    deviceBinding.sessionId !== started.sessionId ||
    deviceBinding.clientNonce !== encodeBase64Url(clientNonce) ||
    deviceBinding.deviceId !== started.device.deviceId ||
    deviceBinding.certificateSpkiSha256 !== proofResponse.presentedPin
  ) {
    throw new Error("The SRP-authenticated device certificate binding is invalid.");
  }
  const clientId = stableUpdaterClientId(started.device.deviceId);
  const clientBinding = PairingClientBindingSchema.parse({
    certificateSpkiSha256: deviceBinding.certificateSpkiSha256,
    clientId,
    clientNonce: deviceBinding.clientNonce,
    deviceId: deviceBinding.deviceId,
    domain: "philcoino:v4:client-binding",
    sessionId: started.sessionId,
  });
  reportStage("token-issue", "Requesting pinned OTA credential");
  const completedResponse = await transport.request({
    body: jsonBytes({
      clientId,
      encryptedClientBinding: encodeBase64Url(
        await srp.encrypt(JSON.stringify(clientBinding)),
      ),
    }),
    expectedPin: deviceBinding.certificateSpkiSha256,
    headers: { "Content-Type": "application/json" },
    method: "POST",
    origin,
    path: `/api/v4/pairing/sessions/${started.sessionId}/complete`,
    responseTimeoutMs: pairingResponseTimeoutMs,
  });
  ensureStatus(completedResponse, 200, "pairing completion");
  const completed = PairingCompleteResponseSchema.parse(
    parseJson(completedResponse.body),
  );
  if (
    completed.clientId !== clientId ||
    completed.device.deviceId !== started.device.deviceId ||
    completed.certificateSpkiSha256 !== deviceBinding.certificateSpkiSha256
  ) {
    throw new Error("The issued OTA credential does not match the paired ESP32.");
  }
  return {
    accessToken: completed.accessToken,
    certificatePin: completed.certificateSpkiSha256,
    clientId: completed.clientId,
    deviceId: completed.device.deviceId,
  };
}

export async function uploadFirmwareImage(
  originInput: string,
  image: Uint8Array,
  credential: PairedOtaCredential,
  transport: OtaTransport = tlsOtaTransport,
  onProgress?: (sent: number, total: number) => void,
): Promise<FirmwareUpdateAccepted> {
  if (image.length === 0) throw new Error("The firmware image is empty.");
  if (image.length > maximumFirmwareImageBytes) {
    throw new Error("The firmware image is larger than the ESP32 OTA slot.");
  }
  if (image[0] !== 0xe9) {
    throw new Error("The file is not an ESP-IDF application image.");
  }
  const origin = normalizeOtaOrigin(originInput);
  const digest = createHash("sha256").update(image).digest("hex");
  const response = await transport.request({
    body: image,
    expectedPin: credential.certificatePin,
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      "Content-Type": "application/octet-stream",
      "X-Philcoino-Image-SHA256": digest,
    },
    method: "POST",
    onProgress,
    origin,
    path: "/api/v4/firmware-updates",
    bodyWriteTimeoutMs: uploadBodyWriteTimeoutMs,
    responseTimeoutMs: uploadRequestTimeoutMs,
  });
  ensureStatus(response, 202, "firmware upload");
  return FirmwareUpdateAcceptedSchema.parse(parseJson(response.body));
}

export const tlsOtaTransport: OtaTransport = {
  request: tlsRequest,
};

async function tlsRequest(request: OtaRequest): Promise<OtaResponse> {
  const origin = new URL(normalizeOtaOrigin(request.origin));
  const connectTimeoutMs = request.connectTimeoutMs ?? tlsConnectTimeoutMs;
  const responseTimeoutMs =
    request.responseTimeoutMs ?? pairingResponseTimeoutMs;
  const socket = await connectTlsSocket(
    origin,
    connectTimeoutMs,
    request.onConnectionAttempt,
  );
  const presentedPin = certificatePin(socket);
  if (request.expectedPin !== undefined && presentedPin !== request.expectedPin) {
    socket.destroy();
    throw new Error("The ESP32 certificate pin does not match the paired device.");
  }

  const headers = {
    ...(request.headers ?? {}),
    Connection: "close",
    "Content-Length": String(request.body.length),
    Host: origin.host,
  };
  const head = [
    `${request.method} ${request.path} HTTP/1.1`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    "",
    "",
  ].join("\r\n");
  await writeSocket(socket, Buffer.from(head, "utf8"), socketWriteTimeoutMs);
  const bodyWriteTimeoutMs =
    request.bodyWriteTimeoutMs ?? socketWriteTimeoutMs;
  const chunkSize = 16 * 1024;
  for (let offset = 0; offset < request.body.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, request.body.length);
    await writeSocket(
      socket,
      request.body.subarray(offset, end),
      bodyWriteTimeoutMs,
    );
    request.onProgress?.(end, request.body.length);
  }
  const responseBytes = await readSocket(
    socket,
    responseTimeoutMs,
    origin.host,
  );
  const parsed = parseHttpResponse(responseBytes);
  return { ...parsed, presentedPin };
}

async function connectTlsSocket(
  origin: URL,
  timeoutMs: number,
  onAttempt?: (attempt: number, maximumAttempts: number) => void,
): Promise<TLSSocket> {
  let lastError: Error | null = null;
  const maximumAttempts = 2;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    onAttempt?.(attempt, maximumAttempts);
    const socket = connect({
      ALPNProtocols: ["http/1.1"],
      host: origin.hostname,
      port: Number(origin.port || 443),
      rejectUnauthorized: false,
      ...(isIP(origin.hostname) === 0 ? { servername: origin.hostname } : {}),
    });
    try {
      await waitForSecureConnect(socket, timeoutMs, origin.host);
      return socket;
    } catch (error) {
      socket.destroy();
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maximumAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  throw new Error(
    `HTTPS connection failed after two bounded attempts: ${lastError?.message ?? "unknown TLS error"}`,
  );
}

function waitForSecureConnect(
  socket: TLSSocket,
  timeoutMs: number,
  host: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("error", fail);
      socket.off("secureConnect", connected);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(new Error(`HTTPS connection to ${host} failed: ${error.message}`));
    };
    const connected = () => {
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error(
        `HTTPS connection to ${host} timed out after ${timeoutMs} ms. ` +
        "Check TCP port 443 and the ESP32 HTTPS service.",
      ));
    }, timeoutMs);
    socket.once("error", fail);
    socket.once("secureConnect", connected);
  });
}

function certificatePin(socket: TLSSocket): string {
  const raw = socket.getPeerCertificate(true).raw;
  if (raw === undefined) throw new Error("The ESP32 did not present a certificate.");
  const certificate = new X509Certificate(raw);
  const spki = certificate.publicKey.export({ format: "der", type: "spki" });
  return createHash("sha256").update(spki).digest("base64url");
}

function writeSocket(
  socket: TLSSocket,
  value: Uint8Array,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("error", fail);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(new Error(`HTTPS request write timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    socket.once("error", fail);
    socket.write(value, (error) => {
      cleanup();
      if (error !== undefined && error !== null) reject(error);
      else resolve();
    });
  });
}

function readSocket(
  socket: TLSSocket,
  timeoutMs: number,
  host: string,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", receive);
      socket.off("error", fail);
      socket.off("end", finish);
      socket.off("close", closed);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      resolve(Buffer.concat(chunks));
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const receive = (chunk: Buffer) => {
      chunks.push(chunk);
      const response = Buffer.concat(chunks);
      const completeLength = completeHttpResponseByteLength(response);
      if (completeLength !== null) {
        chunks.length = 0;
        chunks.push(response.subarray(0, completeLength));
        succeed();
      }
    };
    const finish = () => succeed();
    const closed = () => {
      if (chunks.length > 0) succeed();
      else fail(new Error(`HTTPS connection to ${host} closed without a response.`));
    };
    const timer = setTimeout(() => {
      socket.destroy();
      fail(new Error(
        `HTTPS response from ${host} timed out after ${timeoutMs} ms.`,
      ));
    }, timeoutMs);
    socket.on("data", receive);
    socket.once("error", fail);
    socket.once("end", finish);
    socket.once("close", closed);
  });
}

export function completeHttpResponseByteLength(
  value: Uint8Array,
): number | null {
  const buffer = Buffer.from(value);
  const separator = buffer.indexOf("\r\n\r\n");
  if (separator < 0) return null;

  const head = buffer.subarray(0, separator).toString("ascii");
  const lines = head.split("\r\n");
  const statusMatch = lines[0]?.match(/^HTTP\/1\.[01] ([0-9]{3})/u);
  if (statusMatch === null || statusMatch === undefined) return null;

  const headers = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const index = line.indexOf(":");
    if (index > 0) {
      headers.set(
        line.slice(0, index).trim().toLowerCase(),
        line.slice(index + 1).trim(),
      );
    }
  }

  const bodyOffset = separator + 4;
  const status = Number.parseInt(statusMatch[1], 10);
  if ((status >= 100 && status < 200) || status === 204 || status === 304) {
    return bodyOffset;
  }

  const contentLengthHeader = headers.get("content-length");
  if (contentLengthHeader !== undefined) {
    if (!/^[0-9]+$/u.test(contentLengthHeader)) return null;
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (!Number.isSafeInteger(contentLength)) return null;
    const responseLength = bodyOffset + contentLength;
    return buffer.length >= responseLength ? responseLength : null;
  }

  if (headers.get("transfer-encoding")?.toLowerCase() === "chunked") {
    const chunkedLength = completeChunkedBodyByteLength(
      buffer.subarray(bodyOffset),
    );
    return chunkedLength === null ? null : bodyOffset + chunkedLength;
  }

  return null;
}

function completeChunkedBodyByteLength(value: Uint8Array): number | null {
  const buffer = Buffer.from(value);
  let offset = 0;
  while (true) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd < 0) return null;
    const sizeText = buffer
      .subarray(offset, lineEnd)
      .toString("ascii")
      .split(";", 1)[0];
    if (sizeText === undefined || !/^[0-9a-f]+$/iu.test(sizeText)) return null;
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isSafeInteger(size)) return null;
    offset = lineEnd + 2;
    if (size === 0) {
      return buffer.length >= offset + 2 ? offset + 2 : null;
    }
    if (buffer.length < offset + size + 2) return null;
    if (buffer.subarray(offset + size, offset + size + 2).toString("ascii") !== "\r\n") {
      return null;
    }
    offset += size + 2;
  }
}

export function parseHttpResponse(value: Uint8Array): {
  body: Uint8Array;
  status: number;
} {
  const buffer = Buffer.from(value);
  const separator = buffer.indexOf("\r\n\r\n");
  if (separator < 0) throw new Error("The ESP32 returned a malformed HTTP response.");
  const head = buffer.subarray(0, separator).toString("utf8");
  const lines = head.split("\r\n");
  const statusMatch = lines[0]?.match(/^HTTP\/1\.[01] ([0-9]{3})/u);
  if (statusMatch === null || statusMatch === undefined) {
    throw new Error("The ESP32 returned a malformed HTTP status.");
  }
  const headers = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const index = line.indexOf(":");
    if (index > 0) {
      headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
    }
  }
  const encodedBody = buffer.subarray(separator + 4);
  const body = headers.get("transfer-encoding")?.toLowerCase() === "chunked"
    ? decodeChunked(encodedBody)
    : encodedBody;
  return { body, status: Number.parseInt(statusMatch[1], 10) };
}

function decodeChunked(value: Uint8Array): Uint8Array {
  const buffer = Buffer.from(value);
  const chunks: Buffer[] = [];
  let offset = 0;
  while (true) {
    const end = buffer.indexOf("\r\n", offset);
    if (end < 0) throw new Error("The ESP32 returned malformed chunked data.");
    const size = Number.parseInt(buffer.subarray(offset, end).toString("ascii"), 16);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("The ESP32 returned an invalid HTTP chunk size.");
    }
    offset = end + 2;
    if (size === 0) break;
    if (offset + size + 2 > buffer.length) {
      throw new Error("The ESP32 returned a truncated HTTP chunk.");
    }
    chunks.push(buffer.subarray(offset, offset + size));
    offset += size + 2;
  }
  return Buffer.concat(chunks);
}

function ensureStatus(response: OtaResponse, expected: number, stage: string): void {
  if (response.status === expected) return;
  const parsed = ApiErrorResponseSchema.safeParse(safeParseJson(response.body));
  const detail = parsed.success
    ? `${parsed.data.error.code}: ${parsed.data.error.message}`
    : `HTTP ${response.status}`;
  throw new Error(`${stage} failed (${detail}).`);
}

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function parseJson(value: Uint8Array): unknown {
  return JSON.parse(decoder.decode(value)) as unknown;
}

function safeParseJson(value: Uint8Array): unknown {
  try {
    return parseJson(value);
  } catch {
    return null;
  }
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): Uint8Array {
  return Buffer.from(value, "base64url");
}
