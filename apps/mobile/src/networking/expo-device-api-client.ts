import { fetch as expoFetch } from "expo/fetch";

import {
  DeviceApiClient,
  type DeviceApiClientOptions,
} from "./device-api-client";

export type ExpoDeviceApiClientOptions = Omit<DeviceApiClientOptions, "fetch">;

export function createDeviceApiClient(
  options: ExpoDeviceApiClientOptions,
): DeviceApiClient {
  return new DeviceApiClient({
    ...options,
    fetch: (url, init) => expoFetch(url, init),
  });
}
