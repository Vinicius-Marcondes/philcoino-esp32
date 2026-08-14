import type { DeviceDiscovery, DiscoveredDevice } from "../discovery/device-discovery";
import { ApiClientError } from "../networking/api-client-error";
import {
  createDebugDeviceApiClient,
  debugDeviceIdentity,
  debugSelectedDevice,
} from "../networking/debug-device-api-client";
import { SelectedDeviceRepository } from "../storage/selected-device-repository";
import type { PairingClientFactory } from "./pairing-service";

export const DEBUG_PAIRING_CODE = "12345678";
export const DEBUG_DISCOVERY_DELAY_MS = 350;
export const DEBUG_DISCOVERY_TIMEOUT_MS = 1_000;

const SESSION_ID = "00000000000000000000000000000002";
const CLIENT_PROOF = "D".repeat(86);
const SERVER_PROOF = "E".repeat(86);
const DEVICE_NONCE = "F".repeat(16);

export const debugDiscoveredDevice: DiscoveredDevice = {
  ...debugDeviceIdentity,
  address: debugSelectedDevice.httpsOrigin,
};

export const debugDeviceDiscovery: DeviceDiscovery = {
  scan(handlers) {
    const timer = setTimeout(
      () => handlers.onDevice(debugDiscoveredDevice),
      DEBUG_DISCOVERY_DELAY_MS,
    );
    return () => clearTimeout(timer);
  },
};

export const createDebugPairingClient: PairingClientFactory = () => {
  const client = createDebugDeviceApiClient();
  let clientNonce = "";
  let validCode = false;

  return {
    async secureRandom(byteLength) {
      return {
        base64Url: "A".repeat(Math.ceil(byteLength * 4 / 3)),
        hex: "0".repeat(byteLength * 2),
      };
    },
    async srpStart(_sessionHandle, pairingCode) {
      validCode = pairingCode === DEBUG_PAIRING_CODE;
      return "A".repeat(512);
    },
    async startSession(request, options = {}) {
      if (options.signal?.aborted) throw cancelled();
      clientNonce = request.clientNonce;
      return {
        presentedPin: debugSelectedDevice.certificateSpkiSha256,
        session: {
          device: debugDeviceIdentity,
          expiresAtUptimeMs: 90_000,
          salt: "B".repeat(22),
          serverPublicKey: "C".repeat(512),
          sessionId: SESSION_ID,
        },
      };
    },
    async srpProcessChallenge() {
      return CLIENT_PROOF;
    },
    async submitProof(_sessionId, _request, options = {}) {
      if (options.signal?.aborted) throw cancelled();
      if (!validCode) {
        throw new ApiClientError("unauthorized", "The pairing code is incorrect.", {
          response: {
            error: {
              code: "invalid_pairing_code",
              message: "The pairing code is incorrect.",
            },
          },
          status: 401,
        });
      }
      return {
        presentedPin: debugSelectedDevice.certificateSpkiSha256,
        proof: {
          deviceNonce: DEVICE_NONCE,
          encryptedDeviceBinding: "G".repeat(64),
          serverProof: SERVER_PROOF,
        },
      };
    },
    async srpVerifyServer() {},
    async srpDecrypt() {
      return JSON.stringify({
        certificateSpkiSha256: debugSelectedDevice.certificateSpkiSha256,
        clientNonce,
        deviceId: debugDeviceIdentity.deviceId,
        domain: "philcoino:v3:device-binding",
        sessionId: SESSION_ID,
      });
    },
    async srpEncrypt() {
      return "H".repeat(64);
    },
    srpDestroy() {
      validCode = false;
      clientNonce = "";
    },
    async completeSession(_sessionId, request, _certificatePin, options = {}) {
      if (options.signal?.aborted) throw cancelled();
      return {
        accessToken: debugSelectedDevice.accessToken,
        certificateSpkiSha256: debugSelectedDevice.certificateSpkiSha256,
        clientId: request.clientId,
        device: debugDeviceIdentity,
      };
    },
    async getState(credentials, options = {}) {
      if (options.signal?.aborted) throw cancelled();
      if (
        credentials.accessToken !== debugSelectedDevice.accessToken ||
        credentials.certificatePin !== debugSelectedDevice.certificateSpkiSha256
      ) {
        throw new ApiClientError("unauthorized", "The debug credential was rejected.", {
          status: 401,
        });
      }
      return client.getState(options);
    },
  };
};

export const debugSelectedDeviceRepository = new SelectedDeviceRepository({
  async deleteItemAsync() {},
  async getItemAsync() { return null; },
  async setItemAsync() {},
});

function cancelled(): ApiClientError {
  return new ApiClientError("cancelled", "The debug request was cancelled.");
}
