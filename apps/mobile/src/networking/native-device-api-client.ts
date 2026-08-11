import {
  DeviceApiClient,
  type DeviceApiClientOptions,
} from "./device-api-client";
import { nativeDeviceFetch } from "./native-device-fetch";

export type NativeDeviceApiClientOptions = Omit<DeviceApiClientOptions, "fetch">;

export function createNativeDeviceApiClient(
  options: NativeDeviceApiClientOptions,
): DeviceApiClient {
  return new DeviceApiClient({ ...options, fetch: nativeDeviceFetch });
}
