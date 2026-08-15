import { describe, expect, it } from "bun:test";

import { parseResolvedService } from "../src/discovery/device-discovery";

const identity = {
  apiVersion: "4",
  deviceId: "philcoino-c3-01",
  firmwareVersion: "3.0.0",
  model: "espresso-c3",
  name: "Philcoino",
} as const;

describe("API v4 discovery", () => {
  it("constructs HTTPS origins and omits the default TLS port", () => {
    expect(parseResolvedService({
      addresses: ["192.168.4.20"],
      port: 443,
      txt: identity,
    })?.address).toBe("https://192.168.4.20");
    expect(parseResolvedService({
      host: "machine.local.",
      port: 8443,
      txt: identity,
    })?.address).toBe("https://machine.local:8443");
  });
});
