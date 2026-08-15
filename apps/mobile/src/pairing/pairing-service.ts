import {
  PairingClientBindingSchema,
  PairingCompleteResponseSchema,
  PairingDeviceBindingSchema,
  type DeviceResponse,
  type MachineStateV4,
  type PairingSessionCompleteRequest,
  type PairingSessionProofRequest,
  type PairingSessionProofResponse,
  type PairingSessionStartRequest,
  type PairingSessionStartResponse,
} from "@philcoino/protocol";

import type { DiscoveredDevice } from "../discovery/device-discovery";
import { ApiClientError } from "../networking/api-client-error";
import { pairingLog, safePairingErrorDetails } from "./pairing-log";
import { normalizeDeviceAddress } from "../networking/device-address";
import type { RequestOptions } from "../networking/device-api-client";
import type {
  SelectedDevice,
  SelectedDeviceRepository,
} from "../storage/selected-device-repository";

export interface PairingDeviceClient {
  secureRandom(byteLength: number): Promise<{ base64Url: string; hex: string }>;
  startSession(
    request: PairingSessionStartRequest,
    options?: RequestOptions,
  ): Promise<{ presentedPin: string; session: PairingSessionStartResponse }>;
  submitProof(
    sessionId: string,
    request: PairingSessionProofRequest,
    options?: RequestOptions,
  ): Promise<{ presentedPin: string; proof: PairingSessionProofResponse }>;
  completeSession(
    sessionId: string,
    request: PairingSessionCompleteRequest,
    certificatePin: string,
    options?: RequestOptions,
  ): Promise<ReturnType<typeof PairingCompleteResponseSchema.parse>>;
  getState(
    credentials: { accessToken: string; certificatePin: string },
    options?: RequestOptions,
  ): Promise<MachineStateV4>;
  srpStart(sessionHandle: string, pairingCode: string): Promise<string>;
  srpProcessChallenge(
    sessionHandle: string,
    salt: string,
    serverPublicKey: string,
  ): Promise<string>;
  srpVerifyServer(
    sessionHandle: string,
    serverProof: string,
    deviceNonce: string,
  ): Promise<void>;
  srpDecrypt(sessionHandle: string, ciphertext: string): Promise<string>;
  srpEncrypt(sessionHandle: string, plaintext: string): Promise<string>;
  srpDestroy(sessionHandle: string): void;
}

export type PairingClientFactory = (options: { address: string }) => PairingDeviceClient;

export interface PairingCandidate extends DeviceResponse {
  address: string;
  identitySource?: "authenticated" | "discovery" | "manual" | "remembered";
}

export type PairingStage =
  | "connection"
  | "srp-start"
  | "client-proof"
  | "server-proof"
  | "certificate-binding"
  | "token-issue"
  | "authenticated-state"
  | "secure-save";

export type PairingErrorCode =
  | "certificate_changed"
  | "connection_failed"
  | "identity_changed"
  | "invalid_pairing_code_format"
  | "invalid_pairing_code"
  | "invalid_server_proof"
  | "invalid_certificate_binding"
  | "srp_start_failed"
  | "client_proof_failed"
  | "token_issue_failed"
  | "authenticated_state_failed"
  | "secure_store_failed";

export type FindDeviceById = (
  deviceId: string,
  options: {
    onDevice?: (device: DiscoveredDevice) => void;
    signal?: AbortSignal;
  },
) => Promise<DiscoveredDevice | null>;

export class PairingError extends Error {
  readonly code: PairingErrorCode;
  readonly stage: PairingStage;

  constructor(
    stage: PairingStage,
    code: PairingErrorCode,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options);
    this.name = "PairingError";
    this.stage = stage;
    this.code = code;
  }
}

export async function inspectDevice(
  address: string,
  _createClient: PairingClientFactory,
  _signal?: AbortSignal,
): Promise<PairingCandidate> {
  const origin = normalizeDeviceAddress(address);
  return {
    address: origin,
    apiVersion: "4",
    deviceId: "unverified",
    firmwareVersion: "unknown",
    identitySource: "manual",
    model: "espresso-machine",
    name: origin,
  };
}

export async function authenticateAndSave(
  candidate: PairingCandidate,
  pairingCodeInput: string,
  dependencies: {
    createClient: PairingClientFactory;
    repository: SelectedDeviceRepository;
  },
  signal?: AbortSignal,
): Promise<SelectedDevice> {
  const pairingCode = pairingCodeInput.replaceAll(" ", "");
  if (!/^[0-9]{8}$/u.test(pairingCode)) {
    throw new PairingError(
      "srp-start",
      "invalid_pairing_code_format",
      "Enter the exact eight-digit pairing code.",
    );
  }
  const origin = normalizeDeviceAddress(candidate.address);
  const client = dependencies.createClient({ address: origin });
  const [sessionRandom, nonceRandom, clientRandom] = await stage(
    "srp-start",
    "srp_start_failed",
    "The operating system could not create secure pairing randomness.",
    () => Promise.all([
      client.secureRandom(16),
      client.secureRandom(32),
      client.secureRandom(16),
    ]),
  );
  const sessionHandle = sessionRandom.hex;
  const clientNonce = nonceRandom.base64Url;
  const clientId = clientRandom.hex;

  try {
    const clientPublicKey = await stage(
      "srp-start",
      "srp_start_failed",
      "The native SRP client could not start.",
      () => client.srpStart(sessionHandle, pairingCode),
    );

    let started: Awaited<ReturnType<PairingDeviceClient["startSession"]>>;
    pairingLog("connection", "start", { operation: "session-start-request" });
    try {
      started = await client.startSession(
        { clientName: "Philcoino mobile", clientNonce, clientPublicKey },
        { signal },
      );
      pairingLog("connection", "success", { operation: "session-start-request" });
    } catch (error) {
      pairingLog("connection", "failure", {
        operation: "session-start-request",
        ...safePairingErrorDetails(error),
      });
      if (isConnectionFailure(error)) {
        throw new PairingError(
          "connection",
          "connection_failed",
          "The app could not open the pairing connection.",
          { cause: error },
        );
      }
      throw new PairingError(
        "srp-start",
        "srp_start_failed",
        "The device rejected the SRP session start.",
        { cause: error },
      );
    }

    const expectedDeviceId = candidate.identitySource === "manual"
      ? null
      : candidate.deviceId;
    if (
      expectedDeviceId !== null &&
      started.session.device.deviceId !== expectedDeviceId
    ) {
      throw new PairingError(
        "srp-start",
        "identity_changed",
        "The address now belongs to a different Philcoino device.",
      );
    }

    const clientProof = await stage(
      "client-proof",
      "client_proof_failed",
      "The client proof could not be generated.",
      () => client.srpProcessChallenge(
        sessionHandle,
        started.session.salt,
        started.session.serverPublicKey,
      ),
    );

    let proofResult: Awaited<ReturnType<PairingDeviceClient["submitProof"]>>;
    pairingLog("client-proof", "start", { operation: "proof-request" });
    try {
      proofResult = await client.submitProof(
        started.session.sessionId,
        { clientProof },
        { signal },
      );
      pairingLog("client-proof", "success", { operation: "proof-request" });
    } catch (error) {
      pairingLog("client-proof", "failure", {
        operation: "proof-request",
        ...safePairingErrorDetails(error),
      });
      if (
        error instanceof ApiClientError &&
        (error.status === 401 ||
          error.response?.error.code === "invalid_pairing_code")
      ) {
        throw new PairingError(
          "client-proof",
          "invalid_pairing_code",
          "The pairing code is incorrect.",
          { cause: error },
        );
      }
      throw new PairingError(
        "client-proof",
        "client_proof_failed",
        "The device rejected the client proof.",
        { cause: error },
      );
    }

    await stage(
      "server-proof",
      "invalid_server_proof",
      "The device SRP proof is invalid.",
      () => client.srpVerifyServer(
        sessionHandle,
        proofResult.proof.serverProof,
        proofResult.proof.deviceNonce,
      ),
    );

    const bindingText = await stage(
      "certificate-binding",
      "invalid_certificate_binding",
      "The authenticated certificate binding could not be decrypted.",
      () => client.srpDecrypt(
        sessionHandle,
        proofResult.proof.encryptedDeviceBinding,
      ),
    );
    let binding: ReturnType<typeof PairingDeviceBindingSchema.parse>;
    try {
      binding = PairingDeviceBindingSchema.parse(JSON.parse(bindingText) as unknown);
    } catch (error) {
      throw new PairingError(
        "certificate-binding",
        "invalid_certificate_binding",
        "The authenticated certificate binding is malformed.",
        { cause: error },
      );
    }
    if (
      binding.sessionId !== started.session.sessionId ||
      binding.clientNonce !== clientNonce ||
      binding.deviceId !== started.session.device.deviceId ||
      binding.certificateSpkiSha256 !== proofResult.presentedPin
    ) {
      throw new PairingError(
        "certificate-binding",
        binding.certificateSpkiSha256 !== proofResult.presentedPin
          ? "certificate_changed"
          : "invalid_certificate_binding",
        "The authenticated binding does not match this TLS connection.",
      );
    }

    const clientBinding = PairingClientBindingSchema.parse({
      certificateSpkiSha256: binding.certificateSpkiSha256,
      clientId,
      clientNonce,
      deviceId: binding.deviceId,
      domain: "philcoino:v4:client-binding",
      sessionId: binding.sessionId,
    });
    const encryptedClientBinding = await stage(
      "token-issue",
      "token_issue_failed",
      "The client confirmation could not be encrypted.",
      () => client.srpEncrypt(sessionHandle, JSON.stringify(clientBinding)),
    );
    const completed = await stage(
      "token-issue",
      "token_issue_failed",
      "The device did not issue an access token.",
      () => client.completeSession(
        binding.sessionId,
        { clientId, encryptedClientBinding },
        binding.certificateSpkiSha256,
        { signal },
      ),
    );
    const acknowledged = PairingCompleteResponseSchema.parse(completed);
    if (
      acknowledged.device.deviceId !== binding.deviceId ||
      acknowledged.certificateSpkiSha256 !== binding.certificateSpkiSha256 ||
      acknowledged.clientId !== clientId
    ) {
      throw new PairingError(
        "token-issue",
        "identity_changed",
        "Token issuance acknowledged a different identity.",
      );
    }

    const state = await stage(
      "authenticated-state",
      "authenticated_state_failed",
      "The new credential could not load authenticated state.",
      () => client.getState(
        {
          accessToken: acknowledged.accessToken,
          certificatePin: acknowledged.certificateSpkiSha256,
        },
        { signal },
      ),
    );
    if (state.device.deviceId !== binding.deviceId) {
      throw new PairingError(
        "authenticated-state",
        "identity_changed",
        "The authenticated state belongs to another device.",
      );
    }

    const selected: SelectedDevice = {
      accessToken: acknowledged.accessToken,
      certificateSpkiSha256: acknowledged.certificateSpkiSha256,
      clientId,
      deviceId: state.device.deviceId,
      httpsOrigin: origin,
    };
    await stage(
      "secure-save",
      "secure_store_failed",
      "The reconnect credential could not be saved securely.",
      () => dependencies.repository.save(selected),
    );
    Object.assign(candidate, state.device, { identitySource: "authenticated" });
    pairingLog("secure-save", "success", { operation: "pairing-complete" });
    return selected;
  } finally {
    // Cleanup must never replace the first, actionable pairing failure. This
    // also lets an outdated development client report the SRP-start stage
    // instead of throwing again because it lacks the new destroy operation.
    try {
      client.srpDestroy(sessionHandle);
    } catch (error) {
      pairingLog("srp-start", "failure", {
        operation: "native-session-cleanup",
        ...safePairingErrorDetails(error),
      });
      // Native contexts are bounded and also cleared when the module unloads.
    }
  }
}

export type RestoreSelectedDeviceResult =
  | { status: "empty" }
  | { status: "not-found"; selected: SelectedDevice }
  | {
      candidate: PairingCandidate;
      selected: SelectedDevice;
      status: "pairing-required";
    }
  | {
      candidate: PairingCandidate;
      recoveredAddress: boolean;
      selected: SelectedDevice;
      status: "connected";
    };

export async function restoreSelectedDevice(
  dependencies: {
    createClient: PairingClientFactory;
    findDeviceById: FindDeviceById;
    repository: SelectedDeviceRepository;
  },
  options: {
    onDevice?: (device: DiscoveredDevice) => void;
    signal?: AbortSignal;
  } = {},
): Promise<RestoreSelectedDeviceResult> {
  const selected = await dependencies.repository.load();
  if (selected === null) return { status: "empty" };

  const connect = async (origin: string) => {
    const state = await dependencies.createClient({ address: origin }).getState(
      {
        accessToken: selected.accessToken,
        certificatePin: selected.certificateSpkiSha256,
      },
      { signal: options.signal },
    );
    if (state.device.deviceId !== selected.deviceId) {
      throw new PairingError(
        "authenticated-state",
        "identity_changed",
        "The pinned device identity changed.",
      );
    }
    return state;
  };

  try {
    const state = await connect(selected.httpsOrigin);
    return {
      candidate: {
        ...state.device,
        address: selected.httpsOrigin,
        identitySource: "authenticated",
      },
      recoveredAddress: false,
      selected,
      status: "connected",
    };
  } catch (error) {
    if (isRepairableAuthenticationFailure(error)) {
      return {
        candidate: rememberedCandidate(selected),
        selected,
        status: "pairing-required",
      };
    }
  }

  const discovered = await dependencies.findDeviceById(selected.deviceId, {
    onDevice: options.onDevice,
    signal: options.signal,
  });
  if (discovered === null || discovered.deviceId !== selected.deviceId) {
    return { selected, status: "not-found" };
  }
  const recoveredOrigin = normalizeDeviceAddress(discovered.address);
  let state: MachineStateV4;
  try {
    state = await connect(recoveredOrigin);
  } catch (error) {
    if (isRepairableAuthenticationFailure(error)) {
      return {
        candidate: {
          ...discovered,
          address: recoveredOrigin,
          identitySource: "remembered",
        },
        selected: { ...selected, httpsOrigin: recoveredOrigin },
        status: "pairing-required",
      };
    }
    throw error;
  }
  const updated: SelectedDevice = { ...selected, httpsOrigin: recoveredOrigin };
  await dependencies.repository.save(updated);
  return {
    candidate: {
      ...state.device,
      address: recoveredOrigin,
      identitySource: "authenticated",
    },
    recoveredAddress: recoveredOrigin !== selected.httpsOrigin,
    selected: updated,
    status: "connected",
  };
}

async function stage<T>(
  pairingStage: PairingStage,
  code: PairingErrorCode,
  message: string,
  operation: () => Promise<T>,
): Promise<T> {
  pairingLog(pairingStage, "start", { operation: code });
  try {
    const result = await operation();
    pairingLog(pairingStage, "success", { operation: code });
    return result;
  } catch (error) {
    pairingLog(pairingStage, "failure", {
      operation: code,
      ...safePairingErrorDetails(error),
    });
    if (error instanceof PairingError) throw error;
    throw new PairingError(pairingStage, code, message, { cause: error });
  }
}

function rememberedCandidate(selected: SelectedDevice): PairingCandidate {
  return {
    address: selected.httpsOrigin,
    apiVersion: "4",
    deviceId: selected.deviceId,
    firmwareVersion: "unknown",
    identitySource: "remembered",
    model: "espresso-machine",
    name: selected.deviceId,
  };
}

function isConnectionFailure(error: unknown): boolean {
  return error instanceof ApiClientError &&
    (error.kind === "offline" || error.kind === "timeout");
}

function isRepairableAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
      (error.kind === "unauthorized" || error.kind === "certificate-changed")
  ) || (
    error instanceof PairingError && error.code === "certificate_changed"
  );
}
