import Zeroconf, { type ZeroconfService } from "react-native-zeroconf";
import { Platform } from "react-native";

import {
  DiscoveryError,
  parseResolvedService,
  type DeviceDiscovery,
} from "./device-discovery";
import { cleanupZeroconfScan } from "./zeroconf-scan-cleanup";

const ANDROID_DISCOVERY_IMPLEMENTATION = "DNSSD";

class NativeDeviceDiscovery implements DeviceDiscovery {
  private stopActiveScan: (() => void) | null = null;

  scan(handlers: Parameters<DeviceDiscovery["scan"]>[0]): () => void {
    this.stopActiveScan?.();

    const zeroconf = new Zeroconf();
    let active = true;
    let scanStarted = false;

    zeroconf.on("resolved", (service: ZeroconfService) => {
      if (!active) {
        return;
      }
      const device = parseResolvedService(service);
      if (device !== null) {
        handlers.onDevice(device);
      }
    });
    zeroconf.on("error", (error: Error) => {
      if (active) {
        handlers.onError(
          new DiscoveryError(
            error.message || "Local-network discovery could not start.",
          ),
        );
      }
    });

    const stop = () => {
      if (!active) {
        return;
      }
      active = false;
      cleanupZeroconfScan(zeroconf, {
        android: Platform.OS === "android",
        scanStarted,
      });
      if (this.stopActiveScan === stop) {
        this.stopActiveScan = null;
      }
    };
    this.stopActiveScan = stop;

    try {
      if (Platform.OS === "android") {
        zeroconf.scan(
          "philcoino",
          "tcp",
          "local.",
          ANDROID_DISCOVERY_IMPLEMENTATION,
        );
      } else {
        zeroconf.scan("philcoino", "tcp", "local.");
      }
      scanStarted = true;
    } catch (error) {
      stop();
      handlers.onError(
        new DiscoveryError(
          error instanceof Error
            ? error.message
            : "Local-network discovery could not start.",
        ),
      );
    }

    return stop;
  }
}

export const nativeDeviceDiscovery: DeviceDiscovery = new NativeDeviceDiscovery();
