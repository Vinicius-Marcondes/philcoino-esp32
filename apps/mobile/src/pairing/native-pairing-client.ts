import {
  MachineStateV4Schema,
  PairingCompleteResponseSchema,
  PairingSessionProofResponseSchema,
  PairingSessionStartResponseSchema,
} from "@philcoino/protocol";

import { secureTransport } from "../../modules/philcoino-secure-transport/src";
import { DeviceApiClient } from "../networking/device-api-client";
import { nativeDeviceFetch } from "../networking/native-device-fetch";
import { createNativeRequestId } from "../networking/native-request-id";
import { nativeTransportError } from "../networking/native-transport-error";
import { pairingLog, safePairingErrorDetails } from "./pairing-log";
import type {
  PairingClientFactory,
  PairingDeviceClient,
} from "./pairing-service";
import { pairingResponseError } from "./pairing-response-error";

const REQUEST_TIMEOUT_MS = 45_000;

export const createNativePairingClient: PairingClientFactory = ({
  address,
}): PairingDeviceClient => ({
  secureRandom(byteLength) {
    requireNativePairingV4();
    return secureTransport.secureRandom(byteLength);
  },
  async startSession(request, options) {
    const path = "/api/v4/pairing/sessions";
    const response = await jsonPairingRequest(address, path, request, undefined, options?.signal);
    if (response.status !== 200) throw pairingResponseError(response, path);
    return {
      presentedPin: response.presentedPin,
      session: PairingSessionStartResponseSchema.parse(
        JSON.parse(response.body) as unknown,
      ),
    };
  },

  async submitProof(sessionId, request, options) {
    const path = `/api/v4/pairing/sessions/${sessionId}/proof`;
    const response = await jsonPairingRequest(address, path, request, undefined, options?.signal);
    if (response.status !== 200) throw pairingResponseError(response, path);
    return {
      presentedPin: response.presentedPin,
      proof: PairingSessionProofResponseSchema.parse(
        JSON.parse(response.body) as unknown,
      ),
    };
  },

  async completeSession(sessionId, request, certificatePin, options) {
    const path = `/api/v4/pairing/sessions/${sessionId}/complete`;
    const response = await jsonPairingRequest(
      address,
      path,
      request,
      certificatePin,
      options?.signal,
    );
    if (response.status !== 200) throw pairingResponseError(response, path);
    return PairingCompleteResponseSchema.parse(
      JSON.parse(response.body) as unknown,
    );
  },

  async getState(credentials, options) {
    return MachineStateV4Schema.parse(
      await new DeviceApiClient({
        accessToken: credentials.accessToken,
        certificateSpkiSha256: credentials.certificatePin,
        fetch: nativeDeviceFetch,
        origin: address,
      }).getState(options),
    );
  },

  srpStart(sessionHandle, pairingCode) {
    requireNativePairingV4();
    return secureTransport.srpStart(sessionHandle, pairingCode);
  },
  srpProcessChallenge(sessionHandle, salt, serverPublicKey) {
    return secureTransport.srpProcessChallenge(sessionHandle, salt, serverPublicKey);
  },
  srpVerifyServer(sessionHandle, serverProof, deviceNonce) {
    return secureTransport.srpVerifyServer(sessionHandle, serverProof, deviceNonce);
  },
  srpDecrypt(sessionHandle, ciphertext) {
    return secureTransport.srpDecrypt(sessionHandle, ciphertext);
  },
  srpEncrypt(sessionHandle, plaintext) {
    return secureTransport.srpEncrypt(sessionHandle, plaintext);
  },
  srpDestroy(sessionHandle) {
    secureTransport.srpDestroy(sessionHandle);
  },
});

function requireNativePairingV4(): void {
  if (
    secureTransport.pairingProtocolVersion === 4 &&
    typeof secureTransport.secureRandom === "function" &&
    typeof secureTransport.srpStart === "function" &&
    typeof secureTransport.srpDestroy === "function"
  ) return;
  const error = new Error(
    "The installed native app does not provide pairing protocol v3.",
  );
  error.name = "NativePairingCapabilityError";
  Object.assign(error, { code: "native_pairing_v3_unavailable" });
  throw error;
}

function ensureNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("The pairing request was cancelled.");
    Object.assign(error, { kind: "cancelled" });
    throw error;
  }
}

async function jsonPairingRequest(
  origin: string,
  path: string,
  body: unknown,
  pin: string | undefined,
  signal: AbortSignal | undefined,
) {
  return pairingRequest(
    {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
      origin,
      path,
      ...(pin === undefined ? {} : { pin }),
      timeoutMs: REQUEST_TIMEOUT_MS,
    },
    signal,
  );
}

async function pairingRequest(
  request: Parameters<typeof secureTransport.request>[1],
  signal: AbortSignal | undefined,
) {
  ensureNotCancelled(signal);
  const requestId = createNativeRequestId();
  const cancel = () => secureTransport.cancelRequest(requestId);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    try {
      return await secureTransport.request(requestId, request);
    } catch (error) {
      pairingLog("connection", "failure", {
        operation: "native-https-request",
        ...safePairingErrorDetails(error),
      });
      throw nativeTransportError(error, signal);
    }
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
