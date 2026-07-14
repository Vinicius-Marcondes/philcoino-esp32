export interface ZeroconfScanCleanupTarget {
  stop(implementation?: "DNSSD"): void;
  removeDeviceListeners(): void;
}

export function cleanupZeroconfScan(
  zeroconf: ZeroconfScanCleanupTarget,
  options: { android: boolean; scanStarted: boolean },
): void {
  if (options.scanStarted) {
    try {
      if (options.android) {
        zeroconf.stop("DNSSD");
      } else {
        zeroconf.stop();
      }
    } catch {
      // Cleanup must not replace the discovery error or crash an unmount.
    }
  }

  try {
    zeroconf.removeDeviceListeners();
  } catch {
    // A missing/unavailable native module is reported by the scan boundary.
  }
}
