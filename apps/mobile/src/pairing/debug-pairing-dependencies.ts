import type { DeviceDiscovery, DiscoveredDevice } from "../discovery/device-discovery";
import { ApiClientError } from "../networking/api-client-error";
import {
  createDebugDeviceApiClient,
  debugDeviceIdentity,
} from "../networking/debug-device-api-client";
import { SelectedDeviceRepository } from "../storage/selected-device-repository";
import type { PairingClientFactory } from "./pairing-service";

export const DEBUG_PAIRING_TOKEN = "debug-token";
export const DEBUG_DISCOVERY_DELAY_MS = 350;
export const DEBUG_DISCOVERY_TIMEOUT_MS = 1_000;

export const debugDiscoveredDevice: DiscoveredDevice = {
  ...debugDeviceIdentity,
  address: "http://debug.local",
};

export const debugDeviceDiscovery: DeviceDiscovery = {
  scan(handlers) {
    const timer = setTimeout(() => {
      handlers.onDevice(debugDiscoveredDevice);
    }, DEBUG_DISCOVERY_DELAY_MS);

    return () => clearTimeout(timer);
  },
};

export const createDebugPairingClient: PairingClientFactory = ({ token }) => {
  const client = createDebugDeviceApiClient();

  return {
    getDevice: (options) => client.getDevice(options),
    getState: (options) => {
      if (token !== DEBUG_PAIRING_TOKEN) {
        throw new ApiClientError(
          "unauthorized",
          "The debug bearer token was rejected.",
          { status: 401 },
        );
      }
      return client.getState(options);
    },
  };
};

export const debugSelectedDeviceRepository = new SelectedDeviceRepository({
  async deleteItemAsync() {},
  async getItemAsync() {
    return null;
  },
  async setItemAsync() {},
});
