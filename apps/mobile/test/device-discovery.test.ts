import { describe, expect, test } from "bun:test";

import {
  findDiscoveredDevice,
  parseResolvedService,
  type DeviceDiscovery,
  type DiscoveredDevice,
} from "../src/discovery/device-discovery";

const discoveredDevice: DiscoveredDevice = {
  address: "http://192.168.1.20",
  apiVersion: "1",
  deviceId: "philcoino-c3-a1b2c3",
  firmwareVersion: "1.0.0",
  model: "espresso-c3",
  name: "Kitchen Philcoino",
};

describe("device discovery", () => {
  test("parses firmware TXT identity and prefers its resolved IPv4 address", () => {
    expect(
      parseResolvedService({
        addresses: ["fe80::1234", "192.168.1.20"],
        host: "philcoino-c3-a1b2c3.local.",
        port: 80,
        txt: {
          apiVersion: "1",
          deviceId: "philcoino-c3-a1b2c3",
          firmwareVersion: "1.0.0",
          model: "espresso-c3",
          name: "Kitchen Philcoino",
        },
      }),
    ).toEqual(discoveredDevice);
  });

  test("rejects incomplete or incompatible discovery metadata", () => {
    expect(
      parseResolvedService({
        addresses: ["192.168.1.20"],
        port: 80,
        txt: { ...discoveredDevice, address: undefined, apiVersion: "2" },
      }),
    ).toBeNull();
    expect(
      parseResolvedService({
        addresses: [],
        port: 80,
        txt: {
          apiVersion: "1",
          deviceId: "philcoino-c3-a1b2c3",
          firmwareVersion: "1.0.0",
          model: "espresso-c3",
          name: "Kitchen Philcoino",
        },
      }),
    ).toBeNull();
  });

  test("finds only the requested stable ID and cleans up the scan", async () => {
    let stopped = false;
    const discovery: DeviceDiscovery = {
      scan: (handlers) => {
        const timeout = setTimeout(() => {
          handlers.onDevice({ ...discoveredDevice, deviceId: "philcoino-other" });
          handlers.onDevice(discoveredDevice);
        }, 0);
        return () => {
          clearTimeout(timeout);
          stopped = true;
        };
      },
    };

    await expect(
      findDiscoveredDevice(discovery, discoveredDevice.deviceId, { timeoutMs: 50 }),
    ).resolves.toEqual(discoveredDevice);
    expect(stopped).toBe(true);
  });

  test("returns no device after a bounded discovery window", async () => {
    let stopped = false;
    const discovery: DeviceDiscovery = {
      scan: () => () => {
        stopped = true;
      },
    };

    await expect(
      findDiscoveredDevice(discovery, discoveredDevice.deviceId, { timeoutMs: 5 }),
    ).resolves.toBeNull();
    expect(stopped).toBe(true);
  });
});
