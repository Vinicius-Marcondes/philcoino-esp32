import {
  DiscoveryError,
  type DeviceDiscovery,
} from "./device-discovery";

class UnsupportedDeviceDiscovery implements DeviceDiscovery {
  scan(handlers: Parameters<DeviceDiscovery["scan"]>[0]): () => void {
    const timeout = setTimeout(() => {
      handlers.onError(
        new DiscoveryError(
          "Automatic discovery requires the iOS or Android development build. Enter the device address manually on this platform.",
        ),
      );
    }, 0);

    return () => clearTimeout(timeout);
  }
}

export const nativeDeviceDiscovery: DeviceDiscovery =
  new UnsupportedDeviceDiscovery();
