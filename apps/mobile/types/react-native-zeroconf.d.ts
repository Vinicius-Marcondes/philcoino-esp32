declare module "react-native-zeroconf" {
  export interface ZeroconfService {
    addresses?: string[];
    fullName?: string;
    host?: string;
    name?: string;
    port?: number;
    txt?: Record<string, string>;
  }

  export default class Zeroconf {
    on(event: "resolved", listener: (service: ZeroconfService) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    scan(type?: string, protocol?: string, domain?: string): void;
    stop(): void;
    removeDeviceListeners(): void;
  }
}
