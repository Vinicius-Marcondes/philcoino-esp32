import { requireNativeModule } from "expo";

export interface SecureResponse {
  body: string;
  presentedPin: string;
  status: number;
}

export interface SecureRandomValue {
  base64Url: string;
  hex: string;
}

export interface SecureRequest {
  body?: string;
  headers?: Record<string, string>;
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  origin: string;
  path: string;
  pin?: string;
  timeoutMs: number;
}

export interface SseEvent {
  body?: string;
  requestId: string;
  type: "closed" | "data" | "error";
}

interface NativeTransport {
  readonly pairingProtocolVersion: number;
  secureRandom(byteLength: number): Promise<SecureRandomValue>;
  cancelRequest(requestId: string): void;
  cancelSse(requestId: string): void;
  srpStart(sessionHandle: string, pairingCode: string): Promise<string>;
  srpProcessChallenge(
    sessionHandle: string,
    saltBase64Url: string,
    serverPublicKeyBase64Url: string,
  ): Promise<string>;
  srpVerifyServer(
    sessionHandle: string,
    serverProofBase64Url: string,
    deviceNonceBase64Url: string,
  ): Promise<void>;
  srpDecrypt(
    sessionHandle: string,
    ciphertextBase64Url: string,
  ): Promise<string>;
  srpEncrypt(sessionHandle: string, plaintext: string): Promise<string>;
  srpDestroy(sessionHandle: string): void;
  request(requestId: string, request: SecureRequest): Promise<SecureResponse>;
  startSse(requestId: string, request: SecureRequest): Promise<void>;
  addListener(
    eventName: "onSseEvent",
    listener: (event: SseEvent) => void,
  ): { remove(): void };
}

export const secureTransport =
  requireNativeModule<NativeTransport>("PhilcoinoSecureTransport");
