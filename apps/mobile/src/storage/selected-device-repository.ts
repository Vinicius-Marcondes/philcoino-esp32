import { DeviceResponseSchema } from "@philcoino/protocol";

import { normalizeDeviceAddress } from "../networking/device-address";

const SELECTED_DEVICE_KEY = "philcoino.selected-device.v3";

export interface SelectedDevice {
  deviceId: string;
  httpsOrigin: string;
  certificateSpkiSha256: string;
  clientId: string;
  accessToken: string;
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
    keys.length !== 5 ||
    !keys.every((key) =>
      [
        "deviceId",
        "httpsOrigin",
        "certificateSpkiSha256",
        "clientId",
        "accessToken",
      ].includes(key),
    )
  ) {
    throw new Error("The selected device contains unexpected fields.");
  }

  const deviceId = DeviceResponseSchema.shape.deviceId.safeParse(value.deviceId);
  if (!deviceId.success) {
    throw new Error("The selected device ID is invalid.");
  }
  if (typeof value.httpsOrigin !== "string") {
    throw new Error("The selected device address is invalid.");
  }
  const base64Url256 = /^[A-Za-z0-9_-]{43}$/u;
  if (
    typeof value.certificateSpkiSha256 !== "string" ||
    !base64Url256.test(value.certificateSpkiSha256)
  ) {
    throw new Error("The selected device certificate pin is invalid.");
  }
  if (
    typeof value.clientId !== "string" ||
    !/^[0-9a-f]{32}$/u.test(value.clientId)
  ) {
    throw new Error("The selected client ID is invalid.");
  }
  if (
    typeof value.accessToken !== "string" ||
    !base64Url256.test(value.accessToken)
  ) {
    throw new Error("The selected device access token is invalid.");
  }

  return {
    deviceId: deviceId.data,
    httpsOrigin: normalizeDeviceAddress(value.httpsOrigin),
    certificateSpkiSha256: value.certificateSpkiSha256,
    clientId: value.clientId,
    accessToken: value.accessToken,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
