import {
  DeviceResponseSchema,
  type DeviceResponse,
} from "@philcoino/protocol";

import { normalizeDeviceAddress } from "../networking/device-address";

export interface DiscoveredDevice extends DeviceResponse {
  address: string;
}

export interface ResolvedNetworkService {
  addresses?: unknown;
  host?: unknown;
  port?: unknown;
  txt?: unknown;
}

export interface DiscoveryHandlers {
  onDevice(device: DiscoveredDevice): void;
  onError(error: Error): void;
}

export interface DeviceDiscovery {
  scan(handlers: DiscoveryHandlers): () => void;
}

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryError";
  }
}

export function parseResolvedService(
  service: ResolvedNetworkService,
): DiscoveredDevice | null {
  if (!isRecord(service.txt)) {
    return null;
  }

  const identity = DeviceResponseSchema.safeParse(service.txt);
  if (!identity.success) {
    return null;
  }

  const port = service.port;
  if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65_535) {
    return null;
  }

  const hosts = addressCandidates(service);
  for (const host of hosts) {
    const address = originForHost(host, port as number);
    if (address !== null) {
      return { ...identity.data, address };
    }
  }

  return null;
}

export function findDiscoveredDevice(
  discovery: DeviceDiscovery,
  deviceId: string,
  options: {
    onDevice?: (device: DiscoveredDevice) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<DiscoveredDevice | null> {
  const timeoutMs = options.timeoutMs ?? 8_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new RangeError("Discovery timeout must be between 1 and 30000 milliseconds.");
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let stop = () => {};

    const finish = (result: DiscoveredDevice | null, error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
      stop();
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };

    const cancel = () => finish(null, new DiscoveryError("Discovery was cancelled."));
    const timeout = setTimeout(() => finish(null), timeoutMs);

    if (options.signal?.aborted) {
      cancel();
      return;
    }
    options.signal?.addEventListener("abort", cancel, { once: true });

    stop = discovery.scan({
      onDevice: (device) => {
        options.onDevice?.(device);
        if (device.deviceId === deviceId) {
          finish(device);
        }
      },
      onError: (error) => finish(null, error),
    });
    if (settled) {
      stop();
    }
  });
}

function addressCandidates(service: ResolvedNetworkService): string[] {
  const addresses = Array.isArray(service.addresses)
    ? service.addresses.filter((value): value is string => typeof value === "string")
    : [];
  const ipv4 = addresses.filter((address) => !address.includes(":"));
  const ipv6 = addresses.filter((address) => address.includes(":"));
  const host = typeof service.host === "string" ? [service.host] : [];
  return [...ipv4, ...host, ...ipv6];
}

function originForHost(host: string, port: number): string | null {
  const normalizedHost = host.trim().replace(/\.$/, "");
  if (normalizedHost.length === 0) {
    return null;
  }

  const urlHost = normalizedHost.includes(":")
    ? `[${normalizedHost.replace("%", "%25")}]`
    : normalizedHost;
  const portSuffix = port === 80 ? "" : `:${port}`;

  try {
    return normalizeDeviceAddress(`http://${urlHost}${portSuffix}`);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
