import { DeviceResponseSchema } from "@philcoino/protocol";

import { normalizeDeviceAddress } from "../networking/device-address";

const SELECTED_DEVICE_KEY = "philcoino.selected-device.v1";

export interface SelectedDevice {
  deviceId: string;
  lastSuccessfulAddress: string;
  token: string;
}

export interface SecureKeyValueStore {
  deleteItemAsync(key: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
}

export class SelectedDeviceRepository {
  constructor(private readonly store: SecureKeyValueStore) {}

  async load(): Promise<SelectedDevice | null> {
    const stored = await this.store.getItemAsync(SELECTED_DEVICE_KEY);
    if (stored === null) {
      return null;
    }

    let value: unknown;
    try {
      value = JSON.parse(stored);
    } catch {
      throw new Error("The securely stored device selection is invalid.");
    }

    return parseSelectedDevice(value);
  }

  async save(device: SelectedDevice): Promise<void> {
    const validated = parseSelectedDevice(device);
    await this.store.setItemAsync(
      SELECTED_DEVICE_KEY,
      JSON.stringify(validated),
    );
  }

  clear(): Promise<void> {
    return this.store.deleteItemAsync(SELECTED_DEVICE_KEY);
  }
}

function parseSelectedDevice(value: unknown): SelectedDevice {
  if (!isRecord(value)) {
    throw new Error("The selected device must be an object.");
  }

  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.every((key) =>
      ["deviceId", "lastSuccessfulAddress", "token"].includes(key),
    )
  ) {
    throw new Error("The selected device contains unexpected fields.");
  }

  const deviceId = DeviceResponseSchema.shape.deviceId.safeParse(value.deviceId);
  if (!deviceId.success) {
    throw new Error("The selected device ID is invalid.");
  }
  if (typeof value.lastSuccessfulAddress !== "string") {
    throw new Error("The selected device address is invalid.");
  }
  if (typeof value.token !== "string" || value.token.length === 0) {
    throw new Error("The selected device token is invalid.");
  }

  return {
    deviceId: deviceId.data,
    lastSuccessfulAddress: normalizeDeviceAddress(
      value.lastSuccessfulAddress,
    ),
    token: value.token,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
