import type { DeviceResponse, MachineState } from "@philcoino/protocol";

import type { DiscoveredDevice } from "../discovery/device-discovery";
import { normalizeDeviceAddress } from "../networking/device-address";
import type { RequestOptions } from "../networking/device-api-client";
import type {
  SelectedDevice,
  SelectedDeviceRepository,
} from "../storage/selected-device-repository";

export interface PairingDeviceClient {
  getDevice(options?: RequestOptions): Promise<DeviceResponse>;
  getState(options?: RequestOptions): Promise<MachineState>;
}

export type PairingClientFactory = (options: {
  address: string;
  token?: string;
}) => PairingDeviceClient;

export interface PairingCandidate extends DeviceResponse {
  address: string;
}

export type FindDeviceById = (
  deviceId: string,
  options: {
    onDevice?: (device: DiscoveredDevice) => void;
    signal?: AbortSignal;
  },
) => Promise<DiscoveredDevice | null>;

export class PairingError extends Error {
  readonly kind: "empty-token" | "identity-changed";

  constructor(kind: PairingError["kind"], message: string) {
    super(message);
    this.name = "PairingError";
    this.kind = kind;
  }
}

export async function inspectDevice(
  address: string,
  createClient: PairingClientFactory,
  signal?: AbortSignal,
): Promise<PairingCandidate> {
  const normalizedAddress = normalizeDeviceAddress(address);
  const identity = await createClient({ address: normalizedAddress }).getDevice({
    signal,
  });
  return { ...identity, address: normalizedAddress };
}

export async function authenticateAndSave(
  candidate: PairingCandidate,
  tokenInput: string,
  dependencies: {
    createClient: PairingClientFactory;
    repository: SelectedDeviceRepository;
  },
  signal?: AbortSignal,
): Promise<SelectedDevice> {
  const token = tokenInput.trim();
  if (token.length === 0) {
    throw new PairingError("empty-token", "Enter the device bearer token.");
  }

  const current = await inspectDevice(candidate.address, dependencies.createClient, signal);
  if (current.deviceId !== candidate.deviceId) {
    throw new PairingError(
      "identity-changed",
      "The address now belongs to a different Philcoino device.",
    );
  }

  await dependencies
    .createClient({ address: candidate.address, token })
    .getState({ signal });

  const selected: SelectedDevice = {
    deviceId: current.deviceId,
    lastSuccessfulAddress: current.address,
    token,
  };
  await dependencies.repository.save(selected);
  return selected;
}

export type RestoreSelectedDeviceResult =
  | { status: "empty" }
  | { status: "not-found"; selected: SelectedDevice }
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
  if (selected === null) {
    return { status: "empty" };
  }

  try {
    const candidate = await inspectDevice(
      selected.lastSuccessfulAddress,
      dependencies.createClient,
      options.signal,
    );
    if (candidate.deviceId === selected.deviceId) {
      await dependencies
        .createClient({
          address: selected.lastSuccessfulAddress,
          token: selected.token,
        })
        .getState({ signal: options.signal });
      return {
        candidate,
        recoveredAddress: false,
        selected,
        status: "connected",
      };
    }
  } catch (error) {
    if (isAuthenticationFailure(error)) {
      throw error;
    }
  }

  const discovered = await dependencies.findDeviceById(selected.deviceId, {
    onDevice: options.onDevice,
    signal: options.signal,
  });
  if (discovered === null) {
    return { selected, status: "not-found" };
  }
  if (discovered.deviceId !== selected.deviceId) {
    return { selected, status: "not-found" };
  }

  const verified = await inspectDevice(
    discovered.address,
    dependencies.createClient,
    options.signal,
  );
  if (verified.deviceId !== selected.deviceId) {
    return { selected, status: "not-found" };
  }

  await dependencies
    .createClient({ address: verified.address, token: selected.token })
    .getState({ signal: options.signal });

  const updated: SelectedDevice = {
    ...selected,
    lastSuccessfulAddress: verified.address,
  };
  await dependencies.repository.save(updated);
  return {
    candidate: verified,
    recoveredAddress: verified.address !== selected.lastSuccessfulAddress,
    selected: updated,
    status: "connected",
  };
}

function isAuthenticationFailure(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    error.kind === "unauthorized"
  );
}
